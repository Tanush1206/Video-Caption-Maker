"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useReplaceInCaptions, useRestoreCaptionTexts } from "@/hooks/use-captions";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CaptionMatch, CaptionReplaceResult } from "@/types/caption";

/** How long Undo stays offered after a replace, as after a style Reset. */
const UNDO_MS = 10_000;
/** How long typing pauses before the matches are looked up again. */
const PREVIEW_DELAY_MS = 250;

/** `text` with each span marked, for the list of matches. */
function Marked({ text, spans }: { text: string; spans: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  spans.forEach(([start, end], i) => {
    parts.push(text.slice(last, start), <mark key={i} className="rounded-sm bg-warning/30 text-foreground">{text.slice(start, end)}</mark>);
    last = end;
  });
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/**
 * Find a word or phrase in every caption of the video, see each match and
 * what it would become, and replace one or all, with Undo (v1.3.0). The same
 * misheard name is usually wrong everywhere it occurs. The server matches,
 * for the preview and the change alike; an export made afterwards (burn,
 * SRT, VTT) has the new text, as it reads the captions when it is made.
 */
export function FindReplace({ videoId, open, onClose }: { videoId: number; open: boolean; onClose: () => void }) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState<CaptionReplaceResult | null>(null);
  const [undo, setUndo] = useState<{ items: { id: number; text: string }[]; count: number } | null>(null);
  const preview = useReplaceInCaptions(videoId);
  const apply = useReplaceInCaptions(videoId);
  const restore = useRestoreCaptionTexts(videoId);
  // The latest preview wins: an answer to an earlier keystroke is dropped.
  const asked = useRef(0);

  const request = { find, replace, match_case: matchCase, whole_word: wholeWord };

  const refresh = () => {
    if (!find) return setResult(null);
    const ticket = ++asked.current;
    preview.mutate({ ...request, apply: false }, { onSuccess: (data) => ticket === asked.current && setResult(data) });
  };

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(refresh, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refresh` reads these.
  }, [open, find, replace, matchCase, wholeWord]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  function run(ids: number[] | null) {
    apply.mutate(
      { ...request, caption_ids: ids, apply: true },
      {
        onSuccess: (data) => {
          const changed = data.matches.filter((m) => m.applied);
          setUndo({ items: changed.map((m) => ({ id: m.id, text: m.before })), count: changed.reduce((n, m) => n + m.spans.length, 0) });
          refresh();
        },
      }
    );
  }

  const matches = result?.matches ?? [];
  const usable = matches.filter((m) => !m.empty);
  const busy = apply.isPending || restore.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Find and replace"
      description="In every caption of this video. Exports made afterwards have the new text."
      className="max-w-2xl"
      bodyClassName="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6 pt-2"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => run(null)} disabled={busy || usable.length === 0} loading={apply.isPending}>
            Replace all
          </Button>
        </div>
      }
    >
      <div className="group-inset dark:bg-surface-3">
        <div className="group-row flex-wrap gap-y-2">
          <label htmlFor="find-text" className="text-[15px]">Find</label>
          <input id="find-text" autoFocus value={find} onChange={(e) => setFind(e.target.value)} maxLength={200}
            spellCheck={false} className={cn(inputClasses, "w-full sm:w-80")} />
        </div>
        <div className="group-row flex-wrap gap-y-2">
          <label htmlFor="replace-text" className="text-[15px]">Replace with</label>
          <input id="replace-text" value={replace} onChange={(e) => setReplace(e.target.value)} maxLength={200}
            spellCheck={false} className={cn(inputClasses, "w-full sm:w-80")} />
        </div>
        <div className="group-row justify-start gap-6">
          <label className="flex min-h-11 items-center gap-2 text-[15px] sm:min-h-8">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} className="size-4 accent-primary" />
            Match case
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[15px] sm:min-h-8">
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} className="size-4 accent-primary" />
            Whole word
          </label>
        </div>
      </div>

      {undo && (
        <Notice className="dark:bg-surface-3" title={`Replaced ${undo.count} ${undo.count === 1 ? "match" : "matches"}.`}>
          <Button
            variant="plain"
            size="sm"
            className="-ml-2.5"
            disabled={busy}
            onClick={() => restore.mutate(undo.items, { onSuccess: () => { setUndo(null); refresh(); } })}
          >
            Undo
          </Button>
        </Notice>
      )}

      <p className="px-4 text-[13px] text-muted-foreground" role="status" aria-live="polite">
        {!find
          ? "Type what to find."
          : result
            ? `${result.occurrences} ${result.occurrences === 1 ? "match" : "matches"} in ${matches.length} ${matches.length === 1 ? "caption" : "captions"}.`
            : "Looking…"}
      </p>

      {matches.length > 0 && (
        <ul className={cn("group-inset min-h-0 flex-1 overflow-y-auto dark:bg-surface-3")} aria-label="Matches">
          {matches.map((match: CaptionMatch) => (
            <li key={match.id} className="group-row items-start gap-3">
              <span className="mt-0.5 shrink-0 text-[13px] tabular-nums text-muted-foreground">{formatTimecode(match.start_ms)}</span>
              <span className="min-w-0 flex-1 text-[15px]">
                <span className="block break-words"><Marked text={match.before} spans={match.spans} /></span>
                <span className="block break-words text-[13px] text-muted-foreground">
                  {match.empty ? "Would leave this caption empty: delete it in the list instead." : `→ ${match.after}`}
                </span>
              </span>
              <Button
                variant="plain"
                size="sm"
                disabled={busy || match.empty}
                onClick={() => run([match.id])}
                aria-label={`Replace in the caption at ${formatTimecode(match.start_ms)}`}
              >
                Replace
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
