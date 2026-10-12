"use client";

import Link from "next/link";
import { AlertCircle, ArrowUpRight, Clapperboard, Film, Play, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AuthedImage } from "@/components/videos/authed-image";
import { useAsk, useSemanticSearch } from "@/hooks/use-search";
import { useSystem } from "@/hooks/use-system";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types/search";

type Mode = "search" | "ask";

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
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        selected ? "border-primary/50 bg-primary/10" : "border-border bg-surface-1 hover:bg-surface-2"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Preview the passage at ${formatTimecode(result.start_ms)}`}
          className="rounded-sm border border-border bg-background px-2 py-0.5 font-mono text-xs tabular-nums text-primary"
        >
          {formatTimecode(result.start_ms)}
        </button>
        <span className="ml-auto flex items-center gap-3">
          <span title="How closely this matches, by meaning" className="hidden items-center gap-2 sm:flex">
            <span className="font-mono text-[11px] text-muted-foreground">{percent}%</span>
            <span className="block h-1 w-14 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </span>
          </span>
          <Link
            href={`/editor/${result.video_id}?t=${result.start_ms}`}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
              selected
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border bg-surface-2 hover:bg-surface-3"
            )}
          >
            <Play className="size-3.5" aria-hidden="true" />
            Play from {shortTime(result.start_ms)}
          </Link>
        </span>
      </div>
      <button type="button" onClick={onSelect} className="mt-3 block w-full text-left text-[15px] leading-relaxed">
        &ldquo;{result.text}&rdquo;
      </button>
    </div>
  );
}

/** The selected passage: its video, the line, and the way into the editor. */
function Preview({ result }: { result: SearchResult | null }) {
  return (
    <aside className="rounded-lg border border-border bg-card p-5 lg:sticky lg:top-[5.5rem]">
      <p className="label-caps border-b border-border pb-3">Preview</p>
      {result ? (
        <>
          <div className="relative mt-4 aspect-video overflow-hidden rounded-lg border border-border bg-black">
            <AuthedImage
              path={`/api/videos/${result.video_id}/thumbnail`}
              alt=""
              className="size-full object-cover opacity-70"
              fallback={<Film className="m-auto size-6 text-zinc-500" />}
            />
            <p className="absolute inset-x-3 bottom-3 rounded-md bg-black/75 px-3 py-2 text-center text-[13px] text-white">
              &ldquo;{result.text}&rdquo;
            </p>
          </div>
          <dl className="mt-4 space-y-2 rounded-lg border border-border bg-surface-1 p-4 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Video</dt>
              <dd className="truncate font-medium">{result.video_title}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Passage</dt>
              <dd className="font-mono tabular-nums">
                {formatTimecode(result.start_ms)} → {formatTimecode(result.end_ms)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Length</dt>
              <dd className="font-mono tabular-nums">
                {((result.end_ms - result.start_ms) / 1000).toFixed(1)} seconds
              </dd>
            </div>
          </dl>
          <Link
            href={`/editor/${result.video_id}?t=${result.start_ms}`}
            className="mt-4 flex h-10 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Clapperboard className="size-4" aria-hidden="true" />
            Open in the caption editor
          </Link>
        </>
      ) : (
        <p className="mt-4 text-[13px] text-muted-foreground">Pick a passage to preview it here.</p>
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
      <h1 className={cn(showVideo ? "sr-only" : "mb-1 text-h1")}>{heading}</h1>

      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        {/* Asking needs Gemini to write the answer; finding passages runs
            entirely on this machine. Without a key there is only one mode. */}
        {canAsk && (
          <div className="mb-3 inline-flex rounded-lg border border-border bg-surface-1 p-1">
            {(["search", "ask"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                aria-pressed={mode === option}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  mode === option
                    ? "bg-surface-3 text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option === "search" ? <Search className="size-3.5 shrink-0" /> : <Sparkles className="size-3.5 shrink-0" />}
                {option === "search" ? "Find passages" : "Ask a question"}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="flex items-center gap-3">
          <Search className="hidden size-6 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
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
            className="h-12 min-w-0 flex-1 rounded-md border border-input bg-background px-4 text-base placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
          {results && results.length > 0 && (
            <span className="hidden shrink-0 rounded-md border border-border bg-surface-1 px-3 py-1.5 font-mono text-xs text-primary md:inline">
              {results.length} match{results.length === 1 ? "" : "es"}
              {showVideo && ` in ${groups.length} video${groups.length === 1 ? "" : "s"}`}
            </span>
          )}
          <Button type="submit" size="lg" loading={active.isPending} disabled={query.trim().length < 2}>
            {mode === "search" ? "Search" : "Ask"}
          </Button>
          {results && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear the search"
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          )}
        </form>

        <p className="mt-3 text-[13px] text-muted-foreground">
          {subheading}
          {!canAsk && (
            <>
              {" "}
              <Link href="/settings" className="text-primary underline underline-offset-4">
                Add a Gemini key
              </Link>{" "}
              to also ask questions and get written answers.
            </>
          )}
        </p>
      </div>

      {active.isError && (
        <div
          role="alert"
          className="mt-4 flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          <span>{(active.error as Error).message}</span>
        </div>
      )}

      {mode === "ask" && ask.data && (
        <section
          className={cn(
            "mt-6 animate-fade-up rounded-lg border bg-card p-5",
            ask.data.grounded ? "border-primary/50" : "border-warning/50"
          )}
        >
          <h2
            className={cn(
              "flex items-center gap-2 text-lg font-semibold",
              ask.data.grounded ? "text-primary" : "text-warning"
            )}
          >
            {ask.data.grounded ? <Sparkles className="size-4" /> : <AlertCircle className="size-4" />}
            {ask.data.grounded ? "Answer" : "No answer"}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed">{ask.data.answer}</p>

          {ask.data.citations.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="label-caps mb-1.5">Sources</p>
              {ask.data.citations.map((citation) => (
                <Link
                  key={citation.caption_id}
                  href={`/editor/${citation.video_id}?t=${citation.start_ms}`}
                  className="flex gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <span className="shrink-0 rounded-sm bg-primary/15 px-1 font-mono text-mono-data-sm font-medium text-primary">
                    [{citation.index}]
                  </span>
                  <span className="shrink-0 font-mono text-mono-data-sm tabular-nums text-muted-foreground">
                    {formatTimecode(citation.start_ms)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-sm">
                    {showVideo && <span className="text-muted-foreground">{citation.video_title} · </span>}
                    {citation.text}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Said plainly rather than dressed up: a wrong answer that looks
              confident is the failure mode this whole feature guards against. */}
          {!ask.data.grounded && (
            <p className="mt-3 border-t border-border pt-3 text-body-sm text-muted-foreground">
              Nothing in {showVideo ? "your videos" : "this transcript"} answers that, so no answer was
              invented.
            </p>
          )}
        </section>
      )}

      {results && (
        <div className="mt-6 grid animate-fade-in items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_480px]">
          <section aria-label="Results" className="flex min-w-0 flex-col gap-5">
            {results.length === 0 ? (
              <div className="rounded-lg border border-border bg-card px-5 py-12 text-center">
                <p className="text-base font-semibold">No passages matched closely enough</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Try describing it differently; the words don&apos;t have to appear in the video.
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <article key={group.videoId} className="overflow-hidden rounded-lg border border-border bg-card">
                  <header className="flex items-center gap-3 border-b border-border px-5 py-4">
                    <span className="relative h-9 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-black">
                      <AuthedImage
                        path={`/api/videos/${group.videoId}/thumbnail`}
                        alt=""
                        className="size-full object-cover"
                        fallback={<Film className="m-auto size-4 text-zinc-500" />}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold">{showVideo ? group.title : heading}</h2>
                      <p className="font-mono text-xs text-muted-foreground">
                        {group.results.length} passage{group.results.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Link
                      href={`/editor/${group.videoId}`}
                      className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Open in editor
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                    </Link>
                  </header>
                  <div className="flex flex-col gap-3 p-4 sm:p-5">
                    {group.results.map((result) => (
                      <Passage
                        key={result.caption_id}
                        result={result}
                        selected={selected?.caption_id === result.caption_id}
                        onSelect={() => setSelectedId(result.caption_id)}
                      />
                    ))}
                  </div>
                </article>
              ))
            )}
          </section>

          {results.length > 0 && <Preview result={selected} />}
        </div>
      )}
    </>
  );
}
