"use client";

import Link from "next/link";
import { AlertCircle, Film, PlayCircle, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
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

/** Every result links into the editor at the moment it came from. */
function ResultRow({ result, showVideo }: { result: SearchResult; showVideo: boolean }) {
  const percent = Math.round(result.score * 100);

  return (
    <Link
      href={`/editor/${result.video_id}?t=${result.start_ms}`}
      className="group relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-4 transition-colors hover:bg-surface-2"
    >
      {/* A rail that fills in on hover, rather than a border that changes
          colour. It marks the row being read without shifting any layout. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-0.5 bg-primary opacity-0 transition-opacity group-hover:opacity-100"
      />

      <div className="flex items-start justify-between gap-4">
        <span className="flex items-center gap-1.5 font-mono text-mono-data tabular-nums text-primary">
          <PlayCircle className="size-4 text-muted-foreground" />
          {formatTimecode(result.start_ms)}
        </span>

        {/* A bar as well as a number: relative strength across a result list is
            far easier to read as length than as digits on every row. */}
        <span
          title="How closely this matches, by meaning"
          className="flex shrink-0 flex-col items-end gap-1"
        >
          <span className="label-caps">Relevance {percent}%</span>
          <span className="block h-1 w-20 overflow-hidden rounded-full bg-surface-3">
            <span className="bar-fill block h-full rounded-full" style={{ width: `${percent}%` }} />
          </span>
        </span>
      </div>

      <p className="text-body-md leading-relaxed text-foreground">{result.text}</p>

      {/* Only when the video isn't already implied by the page. */}
      {showVideo && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Film className="size-3.5 shrink-0" />
          <span className="truncate text-body-sm">{result.video_title}</span>
        </div>
      )}
    </Link>
  );
}

export function SearchWorkspace({ videoId, heading, subheading }: SearchWorkspaceProps) {
  const { data: system } = useSystem();
  const canAsk = Boolean(system?.gemini_configured);
  const [chosenMode, setMode] = useState<Mode>("search");
  // A key removed in Settings mid-session drops back to plain search.
  const mode: Mode = canAsk ? chosenMode : "search";
  const [query, setQuery] = useState("");

  const search = useSemanticSearch(videoId);
  const ask = useAsk(videoId);

  const active = mode === "search" ? search : ask;
  const results = mode === "search" ? search.data?.results : ask.data?.results;

  // Across the library, a quote with no source is barely usable. Within one
  // video, repeating its title on every row is noise.
  const showVideo = videoId === null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    // The API rejects anything shorter; catching it here avoids a round-trip
    // to be told so.
    if (trimmed.length < 2) return;
    (mode === "search" ? search : ask).mutate(trimmed);
  }

  return (
    <>
      <h1 className="text-h1">{heading}</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted-foreground">{subheading}</p>

      {/* Asking needs Gemini to write the answer; finding passages runs
          entirely on this machine. Without a key there is only one mode, so
          there is no toggle — just a pointer to where the other one lives. */}
      {!canAsk ? (
        <p className="mb-3 text-body-sm text-muted-foreground">
          <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
            Add a Gemini key
          </Link>{" "}
          to also ask questions and get written answers.
        </p>
      ) : (
      <div className="mb-3 inline-flex rounded-lg bg-muted p-1">
        {(["search", "ask"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            aria-pressed={mode === option}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:text-sm",
              mode === option
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option === "search" ? (
              <Search className="size-3.5 shrink-0" />
            ) : (
              <Sparkles className="size-3.5 shrink-0" />
            )}
            {option === "search" ? "Find passages" : "Ask a question"}
          </button>
        ))}
      </div>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
            className={cn(inputClasses, "h-10 pl-9")}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          loading={active.isPending}
          disabled={query.trim().length < 2}
        >
          {mode === "search" ? "Search" : "Ask"}
        </Button>
      </form>

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
        <Card
          className={cn(
            "relative mt-5 animate-fade-up overflow-hidden p-4 sm:p-5",
            ask.data.grounded ? "border-primary bg-surface-1" : "border-warning/50 bg-surface-1"
          )}
        >
          {/* An oversized, very faint glyph in the corner. It reads as a
              watermark on the panel rather than as an icon competing with the
              answer, so the text stays the loudest thing here. */}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -right-3 -top-3 opacity-[0.07]",
              ask.data.grounded ? "text-primary" : "text-warning"
            )}
          >
            {ask.data.grounded ? (
              <Sparkles className="size-24" />
            ) : (
              <AlertCircle className="size-24" />
            )}
          </span>

          <div
            className={cn(
              "relative flex items-center gap-2",
              ask.data.grounded ? "text-primary" : "text-warning"
            )}
          >
            {ask.data.grounded ? (
              <Sparkles className="size-4" />
            ) : (
              <AlertCircle className="size-4" />
            )}
            <h2 className="text-h2">{ask.data.grounded ? "Answer" : "No answer"}</h2>
          </div>

          <p className="relative mt-3 text-body-md leading-relaxed">{ask.data.answer}</p>

          {ask.data.citations.length > 0 && (
            <div className="relative mt-4 border-t border-border pt-3">
              <p className="label-caps mb-1.5">Sources</p>
              {ask.data.citations.map((citation) => (
                <Link
                  key={citation.caption_id}
                  href={`/editor/${citation.video_id}?t=${citation.start_ms}`}
                  className="flex gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-muted"
                >
                  <span className="shrink-0 rounded-sm bg-primary/10 px-1 font-mono text-mono-data-sm font-medium text-primary">
                    [{citation.index}]
                  </span>
                  <span className="shrink-0 font-mono text-mono-data-sm tabular-nums text-muted-foreground">
                    {formatTimecode(citation.start_ms)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-sm">
                    {showVideo && (
                      <span className="text-muted-foreground">{citation.video_title} · </span>
                    )}
                    {citation.text}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Said plainly rather than dressed up: a wrong answer that looks
              confident is the failure mode this whole feature guards against. */}
          {!ask.data.grounded && (
            <p className="relative mt-3 border-t border-border pt-3 text-body-sm text-muted-foreground">
              Nothing in {showVideo ? "your videos" : "this transcript"} answers that, so
              no answer was invented.
            </p>
          )}
        </Card>
      )}

      {results && (
        <section className="mt-6 animate-fade-in">
          <h2 className="label-caps mb-2">
            {results.length === 0
              ? "No passages matched closely enough"
              : `Results (${results.length})`}
          </h2>
          {/* Spaced cards rather than divided rows: each result is its own
              object with a timecode, a quote and a source, and stacking them
              flush makes a long transcript excerpt hard to tell apart from
              the next one. */}
          <div className="flex flex-col gap-2">
            {results.map((result) => (
              <ResultRow key={result.caption_id} result={result} showVideo={showVideo} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
