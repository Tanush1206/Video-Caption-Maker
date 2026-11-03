"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { useCaptionCheck, useStartCaptionCheck, useUndoCaptionFix } from "@/hooks/use-captions";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CaptionCheck, CaptionFix, WordRun } from "@/types/caption";

export function isChecking(check: CaptionCheck | null | undefined): boolean {
  return check?.status === "queued" || check?.status === "running";
}

function timeLeft(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 60) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} min left`;
}

/** A caption's words with the changed ones marked: struck out before, highlighted after. */
function Words({ runs, changedAs }: { runs: WordRun[]; changedAs: "del" | "ins" }) {
  return (
    <>
      {runs.map((run, i) => {
        const space = i > 0 ? " " : "";
        if (!run.changed) return <span key={i}>{space}{run.text}</span>;
        return changedAs === "del" ? (
          <span key={i}>
            {space}
            <del className="rounded-sm bg-destructive/15 px-0.5 text-foreground decoration-destructive-text">{run.text}</del>
          </span>
        ) : (
          <span key={i}>
            {space}
            <ins className="rounded-sm bg-success/25 px-0.5 font-medium text-foreground no-underline">{run.text}</ins>
          </span>
        );
      })}
    </>
  );
}

function Summary({ check }: { check: CaptionCheck }) {
  const fixed = check.fixes.length;
  const dropped = check.dropped
    ? ` ${check.dropped} ${check.dropped === 1 ? "suggestion was" : "suggestions were"} left out by the safety checks.`
    : "";
  if (fixed === 0) return <>Gemini found nothing it was sure needed fixing.{dropped}</>;
  return <>Fixed {fixed} {fixed === 1 ? "caption" : "captions"}.{dropped} Changed words are highlighted.</>;
}

function FixRow({ fix, busy, onUndo }: { fix: CaptionFix; busy: boolean; onUndo: () => void }) {
  const at = formatTimecode(fix.start_ms);
  return (
    <li className="group-row items-start gap-3">
      <span className="mt-0.5 shrink-0 text-[13px] tabular-nums text-muted-foreground">{at}</span>
      <span className="min-w-0 flex-1 text-[15px]">
        <span className="block break-words text-[13px] text-muted-foreground">
          <span className="sr-only">Before: </span>
          <Words runs={fix.before_words} changedAs="del" />
        </span>
        <span className="block break-words">
          <span className="sr-only">After: </span>
          <Words runs={fix.after_words} changedAs="ins" />
        </span>
      </span>
      {fix.undone ? (
        <span className="mt-0.5 shrink-0 text-[13px] text-muted-foreground">Undone</span>
      ) : fix.edited ? (
        <span className="mt-0.5 max-w-24 shrink-0 text-right text-[13px] text-muted-foreground">Edited since, kept</span>
      ) : (
        <Button variant="plain" size="sm" disabled={busy} onClick={onUndo} aria-label={`Undo the change at ${at}`}>
          Undo
        </Button>
      )}
    </li>
  );
}

/**
 * "Improve captions with Gemini" (v1.3.0): Gemini reads the caption text,
 * never the video or the timings, and fixes words that were clearly
 * misheard; safety checks on the server keep only respellings and
 * sound-alike swaps (services/caption_fix.py). Started only from here, runs
 * in the background (the dialog can be closed), and lists every change with
 * its own Undo and an Undo all.
 */
export function ImproveCaptions({ videoId, open, onClose }: { videoId: number; open: boolean; onClose: () => void }) {
  const { data: check } = useCaptionCheck(videoId);
  const start = useStartCaptionCheck(videoId);
  const undo = useUndoCaptionFix(videoId);
  const checking = isChecking(check);
  const undoable = check?.fixes.filter((f) => !f.undone && !f.edited) ?? [];
  const busy = undo.isPending || checking;
  const percent = check && check.batches_total ? Math.round((check.batches_done / check.batches_total) * 100) : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Improve captions with Gemini"
      description="Gemini reads the caption text, never the video or the timings, and fixes words that were clearly misheard. Every change is listed with its own Undo."
      className="max-w-2xl"
      bodyClassName="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6 pt-2"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {undoable.length > 0 && (
            <Button variant="secondary" disabled={busy} loading={undo.isPending && undo.variables === null} onClick={() => undo.mutate(null)}>
              Undo all
            </Button>
          )}
          {/* A new check replaces this list, and with it the Undo of each
              change: offered once nothing here is left to undo. */}
          {undoable.length === 0 && !checking && (
            <Button onClick={() => start.mutate()} disabled={checking} loading={start.isPending}>
              {check ? "Check again" : "Check captions"}
            </Button>
          )}
        </div>
      }
    >
      <div role="status" aria-live="polite" className="flex flex-col gap-2 px-4">
        {checking && check ? (
          <>
            <p className="text-[15px]">
              {check.status === "queued"
                ? `Starting, ${timeLeft(check.seconds_left)}.`
                : `Checking part ${Math.min(check.batches_done + 1, check.batches_total)} of ${check.batches_total}, ${timeLeft(check.seconds_left)}.`}
            </p>
            <div
              className="h-1 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-label="Checking captions"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="bar-fill h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(2, percent)}%` }} />
            </div>
            <p className="text-[13px] text-muted-foreground">You can close this; the check carries on.</p>
          </>
        ) : check?.status === "completed" ? (
          <p className="text-[13px] text-muted-foreground"><Summary check={check} /></p>
        ) : !check ? (
          <p className="text-[13px] text-muted-foreground">
            These captions haven&rsquo;t been checked. Nothing is sent until you choose Check captions.
          </p>
        ) : null}
      </div>

      {check?.error_message && !checking && (
        <Notice tone={check.status === "failed" ? "error" : "warning"} className="dark:bg-surface-3" title={check.error_message} />
      )}
      {start.error && (
        <Notice role="alert" tone="error" className="dark:bg-surface-3" title={(start.error as Error).message} />
      )}
      {undo.error && (
        <Notice role="alert" tone="error" className="dark:bg-surface-3" title={(undo.error as Error).message} />
      )}

      {check && check.fixes.length > 0 && (
        <ul className="group-inset min-h-0 flex-1 overflow-y-auto dark:bg-surface-3" aria-label="Changes">
          {check.fixes.map((fix) => (
            <FixRow key={fix.id} fix={fix} busy={busy} onUndo={() => undo.mutate(fix.id)} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
