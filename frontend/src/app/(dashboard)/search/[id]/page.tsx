"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import { useAsk, useSemanticSearch } from "@/hooks/use-search";
import { useVideo } from "@/hooks/use-videos";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types/search";

type Mode = "search" | "ask";

export default function SearchPage({ params }: { params: { id: string } }) {
  const videoId = Number(params.id);

  if (Number.isNaN(videoId)) {
    return <p className="p-8 text-sm text-muted-foreground">Invalid video id.</p>;
  }

  return <SearchWorkspace videoId={videoId} />;
}

/** Every result links into the editor at the moment it came from. */
function ResultRow({ result }: { result: SearchResult }) {
  return (
    <Link
      href={`/editor/${result.video_id}?t=${result.start_ms}`}
      className="flex gap-3 rounded-md border border-transparent px-2 py-2 transition hover:border-border hover:bg-muted/40"
    >
      <span className="w-20 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatTimecode(result.start_ms)}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed">{result.text}</span>
      <span
        title="How closely this matches, by meaning"
        className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
      >
        {Math.round(result.score * 100)}%
      </span>
    </Link>
  );
}

function SearchWorkspace({ videoId }: { videoId: number }) {
  const { data: video } = useVideo(videoId);

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");

  const search = useSemanticSearch(videoId);
  const ask = useAsk(videoId);

  const active = mode === "search" ? search : ask;
  const results = mode === "search" ? search.data?.results : ask.data?.results;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    // The API rejects anything shorter; catching it here avoids a round-trip
    // to be told so.
    if (trimmed.length < 2) return;
    (mode === "search" ? search : ask).mutate(trimmed);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href={`/editor/${videoId}`}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to the editor
      </Link>

      <h1 className="text-xl font-semibold">{video?.title ?? "Search"}</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Searches by meaning, not by keyword — the words you type don&apos;t have to
        appear in the transcript.
      </p>

      <div className="mb-3 flex gap-1 rounded-md border border-border p-0.5">
        {(["search", "ask"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            aria-pressed={mode === option}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm transition",
              mode === option
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {option === "search" ? (
              <Search className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {option === "search" ? "Find passages" : "Ask a question"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            mode === "search"
              ? "What are you looking for?"
              : "What do you want to know about this video?"
          }
          aria-label={mode === "search" ? "Search query" : "Question"}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={active.isPending || query.trim().length < 2}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {active.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "search" ? (
            "Search"
          ) : (
            "Ask"
          )}
        </button>
      </form>

      {active.isError && (
        <p role="alert" className="mt-4 rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-500">
          {(active.error as Error).message}
        </p>
      )}

      {mode === "ask" && ask.data && (
        <section
          className={cn(
            "mt-5 rounded-lg border p-4",
            ask.data.grounded
              ? "border-primary/40 bg-primary/5"
              : "border-amber-500/40 bg-amber-500/5"
          )}
        >
          <p className="text-sm leading-relaxed">{ask.data.answer}</p>

          {ask.data.citations.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-border/50 pt-3">
              <p className="text-xs font-medium text-muted-foreground">Sources</p>
              {ask.data.citations.map((citation) => (
                <Link
                  key={citation.caption_id}
                  href={`/editor/${citation.video_id}?t=${citation.start_ms}`}
                  className="flex gap-2 rounded px-1 py-1 text-xs transition hover:bg-muted"
                >
                  <span className="shrink-0 font-mono text-primary">
                    [{citation.index}]
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    {formatTimecode(citation.start_ms)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{citation.text}</span>
                </Link>
              ))}
            </div>
          )}

          {/* Said plainly rather than dressed up: a wrong answer that looks
              confident is the failure mode this whole feature guards against. */}
          {!ask.data.grounded && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
              Nothing in this transcript answers that, so no answer was invented.
            </p>
          )}
        </section>
      )}

      {results && (
        <section className="mt-5">
          <p className="mb-2 text-xs text-muted-foreground">
            {results.length === 0
              ? "No passages matched closely enough."
              : `${results.length} passage${results.length === 1 ? "" : "s"}`}
          </p>
          <div className="divide-y divide-border/50">
            {results.map((result) => (
              <ResultRow key={result.caption_id} result={result} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
