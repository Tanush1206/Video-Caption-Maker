"use client";

import Link from "next/link";
import { AlertCircle, ArrowUpRight, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { useAsk, useSemanticSearch } from "@/hooks/use-search";
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
  return (
    <Link
      href={`/editor/${result.video_id}?t=${result.start_ms}`}
      className="group flex flex-col gap-1.5 rounded-lg px-3 py-3 transition-colors hover:bg-muted/60 sm:flex-row sm:gap-4"
    >
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground sm:w-[4.5rem] sm:justify-end sm:pt-0.5">
        {formatTimecode(result.start_ms)}
        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100 sm:hidden" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-relaxed">{result.text}</span>
        {/* Only when the video isn't already implied by the page. */}
        {showVideo && (
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {result.video_title}
          </span>
        )}
      </span>

      <span
        title="How closely this matches, by meaning"
        className="flex shrink-0 items-center gap-2 sm:pt-1"
      >
        {/* A bar as well as a number: relative strength across a result list is
            far easier to read as length than as four digits per row. */}
        <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted sm:block">
          <span
            className="block h-full rounded-full bg-primary/70"
            style={{ width: `${Math.round(result.score * 100)}%` }}
          />
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {Math.round(result.score * 100)}%
        </span>
      </span>
    </Link>
  );
}

export function SearchWorkspace({ videoId, heading, subheading }: SearchWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("search");
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
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted-foreground">{subheading}</p>

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
            "mt-5 animate-fade-up p-4 sm:p-5",
            ask.data.grounded
              ? "border-primary/30 bg-primary/[0.04]"
              : "border-warning/40 bg-warning/[0.06]"
          )}
        >
          <div className="flex gap-3">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg",
                ask.data.grounded
                  ? "bg-primary/15 text-primary"
                  : "bg-warning/15 text-warning"
              )}
            >
              {ask.data.grounded ? (
                <Sparkles className="size-3.5" />
              ) : (
                <AlertCircle className="size-3.5" />
              )}
            </span>
            <p className="flex-1 text-sm leading-relaxed">{ask.data.answer}</p>
          </div>

          {ask.data.citations.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sources</p>
              {ask.data.citations.map((citation) => (
                <Link
                  key={citation.caption_id}
                  href={`/editor/${citation.video_id}?t=${citation.start_ms}`}
                  className="flex gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted"
                >
                  <span className="shrink-0 font-mono font-medium text-primary">
                    [{citation.index}]
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    {formatTimecode(citation.start_ms)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {showVideo && (
                      <span className="text-muted-foreground">
                        {citation.video_title} ·{" "}
                      </span>
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
            <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              Nothing in {showVideo ? "your videos" : "this transcript"} answers that, so
              no answer was invented.
            </p>
          )}
        </Card>
      )}

      {results && (
        <section className="mt-5 animate-fade-in">
          <p className="mb-1 px-3 text-xs text-muted-foreground">
            {results.length === 0
              ? "No passages matched closely enough."
              : `${results.length} passage${results.length === 1 ? "" : "s"}`}
          </p>
          <div className="divide-y divide-border/60">
            {results.map((result) => (
              <ResultRow key={result.caption_id} result={result} showVideo={showVideo} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
