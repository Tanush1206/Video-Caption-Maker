"use client";

import Link from "next/link";
import { AlertCircle, ChevronRight, Film, Play, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { AuthedImage } from "@/components/videos/authed-image";
import { useAsk, useSemanticSearch } from "@/hooks/use-search";
import { useSystem } from "@/hooks/use-system";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types/search";

type Mode = "search" | "ask";

const MODES = [
  { value: "search", label: "Find passages", icon: Search },
  { value: "ask", label: "Ask a question", icon: Sparkles },
] as const;

interface SearchWorkspaceProps {
  /** null searches the whole library. */
  videoId: number | null;
  heading: string;
  subheading: string;
}

/** "01:24" for a button label; the chips carry the full timecode. */
function shortTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Results in rank order, gathered under the video each came from. */
function byVideo(results: SearchResult[]) {
  const groups = new Map<number, { videoId: number; title: string; results: SearchResult[] }>();
  for (const result of results) {
    const group = groups.get(result.video_id) ?? { videoId: result.video_id, title: result.video_title, results: [] };
    group.results.push(result);
    groups.set(result.video_id, group);
  }
  return [...groups.values()];
}

/** A small rounded thumbnail of a result's video. */
function Thumb({ videoId, className }: { videoId: number; className?: string }) {
  return (
    <span className={cn("relative block aspect-video shrink-0 overflow-hidden rounded-lg bg-black", className)}>
      <AuthedImage
        path={`/api/videos/${videoId}/thumbnail`}
        alt=""
        className="size-full object-cover"
        fallback={<Film className="m-auto size-4 text-zinc-500" />}
      />
    </span>
  );
}

/** One passage: a hairline row with the thumbnail, the timestamp and the text. */
function Passage({
  result,
  selected,
  onSelect,
}: {
  result: SearchResult;
  selected: boolean;
  onSelect: () => void;
}) {
  const percent = Math.round(result.score * 100);
  return (
    <li
      className={cn(
        "flex items-start gap-4 px-3 py-3 transition-colors duration-200 ease-out",
        // The chosen one sits on the grouped tone, as the current caption does.
        selected ? "bg-card" : "hover:bg-card/60"
      )}
    >
      <Thumb videoId={result.video_id} className="mt-0.5 hidden w-24 sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`Preview the passage at ${formatTimecode(result.start_ms)}`}
            className={cn(
              "rounded-sm font-mono text-xs tabular-nums",
              selected ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {formatTimecode(result.start_ms)}
          </button>
          <span title="How closely this matches, by meaning" className="hidden items-center gap-2 sm:flex">
            <span className="block h-1 w-10 overflow-hidden rounded-full bg-surface-3">
              <span className="bar-fill block h-full rounded-full" style={{ width: `${percent}%` }} />
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
          </span>
        </div>
        <button type="button" onClick={onSelect} className="mt-0.5 block w-full rounded-sm text-left text-[15px]">
          &ldquo;{result.text}&rdquo;
        </button>
      </div>
      <Link
        href={`/editor/${result.video_id}?t=${result.start_ms}`}
        className={cn(buttonVariants({ variant: "plain", size: "sm" }), "shrink-0")}
      >
        <Play aria-hidden="true" />
        <span className="max-sm:sr-only">Play from {shortTime(result.start_ms)}</span>
        <span className="sm:hidden">{shortTime(result.start_ms)}</span>
      </Link>
    </li>
  );
}

/** The selected passage: its video, the line, and the way into the editor. */
function Preview({ result }: { result: SearchResult | null }) {
  return (
    <aside className="lg:sticky lg:top-[5.5rem]">
      <p className="label-caps mb-1.5 px-4">Preview</p>
      {result ? (
        <>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <AuthedImage
              path={`/api/videos/${result.video_id}/thumbnail`}
              alt=""
              className="size-full object-cover opacity-70"
              fallback={<Film className="m-auto size-6 text-zinc-500" />}
            />
            <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/75 px-3 py-2 text-center text-[13px] text-white">
              &ldquo;{result.text}&rdquo;
            </p>
          </div>
          <dl className="group-inset mt-4">
            <div className="group-row">
              <dt className="text-[15px]">Video</dt>
              <dd className="min-w-0 truncate text-[15px] text-muted-foreground">{result.video_title}</dd>
            </div>
            <div className="group-row">
              <dt className="text-[15px]">Passage</dt>
              <dd className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatTimecode(result.start_ms)} → {formatTimecode(result.end_ms)}
              </dd>
            </div>
            <div className="group-row">
              <dt className="text-[15px]">Length</dt>
              <dd className="text-[15px] tabular-nums text-muted-foreground">
                {((result.end_ms - result.start_ms) / 1000).toFixed(1)} seconds
              </dd>
            </div>
          </dl>
          <Link
            href={`/editor/${result.video_id}?t=${result.start_ms}`}
            className={cn(buttonVariants({ variant: "secondary" }), "mt-4 w-full")}
          >
            Open in the caption editor
          </Link>
        </>
      ) : (
        <p className="px-4 text-[13px] text-muted-foreground">Pick a passage to preview it here.</p>
      )}
    </aside>
  );
}

export function SearchWorkspace({ videoId, heading, subheading }: SearchWorkspaceProps) {
  const { data: system } = useSystem();
  const canAsk = Boolean(system?.gemini_configured);
  const [chosenMode, setMode] = useState<Mode>("search");
  // A key removed in Settings mid-session drops back to plain search.
  const mode: Mode = canAsk ? chosenMode : "search";
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const search = useSemanticSearch(videoId);
  const ask = useAsk(videoId);

  const active = mode === "search" ? search : ask;
  const results = mode === "search" ? search.data?.results : ask.data?.results;
  const groups = useMemo(() => byVideo(results ?? []), [results]);
  const selected =
    results?.find((result) => result.caption_id === selectedId) ?? results?.[0] ?? null;

  // Across the library, a quote with no source is barely usable. Within one
  // video, repeating its title on every group is noise.
  const showVideo = videoId === null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    // The API rejects anything shorter; catching it here avoids a round-trip
    // to be told so.
    if (trimmed.length < 2) return;
    setSelectedId(null);
    (mode === "search" ? search : ask).mutate(trimmed);
  }

  function clear() {
    setQuery("");
    search.reset();
    ask.reset();
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">{heading}</h1>

      <div className="mt-6">
        {/* Asking needs Gemini to write the answer; finding passages runs
            entirely on this machine. Without a key there is only one mode. */}
        {canAsk && (
          <Segmented
            label="Search mode"
            segments={MODES}
            value={mode}
            onChange={setMode}
            className="mb-3 inline-flex"
            segmentClassName="flex-none"
          />
        )}

        {/* One large field on the grouped tone; the search is its one action. */}
        <form onSubmit={submit} className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === "search"
                  ? "What are you looking for?"
                  : showVideo
                    ? "What do you want to know?"
                    : "What do you want to know about this video?"
              }
              aria-label={mode === "search" ? "Search query" : "Question"}
              className={cn(
                "h-12 w-full rounded-xl border border-transparent bg-card pl-12 text-[17px] placeholder:text-muted-foreground",
                "transition-colors duration-200 ease-out focus-visible:border-ring",
                results ? "pr-12" : "pr-4"
              )}
            />
            {results && (
              <button
                type="button"
                onClick={clear}
                aria-label="Clear the search"
                className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground sm:size-10"
              >
                <X className="size-[18px]" />
              </button>
            )}
          </div>
          <Button type="submit" size="lg" className="h-12" loading={active.isPending} disabled={query.trim().length < 2}>
            {mode === "search" ? "Search" : "Ask"}
          </Button>
        </form>

        <p className="mt-2 px-1 text-[13px] text-muted-foreground">
          {subheading}
          {!canAsk && (
            <>
              {" "}
              <Link href="/settings" className="text-primary hover:underline">
                Add a Gemini key
              </Link>{" "}
              to also ask questions and get written answers.
            </>
          )}
        </p>
      </div>

      {active.isError && (
        <Notice role="alert" tone="error" className="mt-6" title={(active.error as Error).message} />
      )}

      {mode === "ask" && ask.data && (
        <section className="mt-8 animate-fade-up rounded-xl bg-card p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            {ask.data.grounded ? (
              <Sparkles className="size-5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <AlertCircle className="size-5 text-warning" aria-hidden="true" />
            )}
            {ask.data.grounded ? "Answer" : "No answer"}
          </h2>
          <p className="mt-2 text-[15px]">{ask.data.answer}</p>

          {ask.data.citations.length > 0 && (
            <div className="mt-5">
              <p className="label-caps mb-1">Sources</p>
              <ul className="divide-y divide-border">
                {ask.data.citations.map((citation) => (
                  <li key={citation.caption_id}>
                    <Link
                      href={`/editor/${citation.video_id}?t=${citation.start_ms}`}
                      className="flex items-baseline gap-3 py-2 transition-colors duration-200 ease-out hover:text-primary"
                    >
                      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                        [{citation.index}]
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatTimecode(citation.start_ms)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px]">
                        {showVideo && <span className="text-muted-foreground">{citation.video_title} · </span>}
                        {citation.text}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Said plainly rather than dressed up: a wrong answer that looks
              confident is the failure mode this whole feature guards against. */}
          {!ask.data.grounded && (
            <p className="mt-3 text-[13px] text-muted-foreground">
              Nothing in {showVideo ? "your videos" : "this transcript"} answers that, so no answer was
              invented.
            </p>
          )}
        </section>
      )}

      {results && (
        <div className="mt-8 grid animate-fade-in items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <section aria-label="Results" className="flex min-w-0 flex-col gap-8">
            {results.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-[17px] font-semibold">No passages matched closely enough</p>
                <p className="mt-1 text-[15px] text-muted-foreground">
                  Try describing it differently; the words don&apos;t have to appear in the video.
                </p>
              </div>
            ) : (
              <>
                <p className="-mb-6 px-3 text-[13px] text-muted-foreground">
                  {results.length} match{results.length === 1 ? "" : "es"}
                  {showVideo && ` in ${groups.length} video${groups.length === 1 ? "" : "s"}`}
                </p>
                {groups.map((group) => (
                  <article key={group.videoId}>
                    <header className="flex items-baseline gap-3 border-b border-border px-3 pb-2">
                      <h2 className="min-w-0 truncate text-[17px] font-semibold">{showVideo ? group.title : heading}</h2>
                      <span className="shrink-0 text-[13px] text-muted-foreground">
                        {group.results.length} passage{group.results.length === 1 ? "" : "s"}
                      </span>
                      <span className="flex-1" />
                      <Link
                        href={`/editor/${group.videoId}`}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-[13px] text-primary hover:underline"
                      >
                        Open in editor
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </Link>
                    </header>
                    <ul className="divide-y divide-border">
                      {group.results.map((result) => (
                        <Passage
                          key={result.caption_id}
                          result={result}
                          selected={selected?.caption_id === result.caption_id}
                          onSelect={() => setSelectedId(result.caption_id)}
                        />
                      ))}
                    </ul>
                  </article>
                ))}
              </>
            )}
          </section>

          {results.length > 0 && <Preview result={selected} />}
        </div>
      )}
    </>
  );
}
