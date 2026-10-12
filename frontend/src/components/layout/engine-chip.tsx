"use client";

import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";

import { useSystem } from "@/hooks/use-system";
import { cn } from "@/lib/utils";
import type { SystemInfo } from "@/types/system";

/**
 * What this install runs on, in one line: "NVIDIA GeForce RTX 5080 · 15.9 GB
 * VRAM" or "CPU · 32 threads · 30 GB RAM". Null until the worker has started
 * once and reported its hardware; nothing is guessed before that.
 */
export function hardwareSummary(system: SystemInfo | undefined): string | null {
  const hardware = system?.hardware;
  if (!hardware) return null;
  if (hardware.cuda && hardware.gpu_name) {
    return hardware.vram_gb
      ? `${hardware.gpu_name} · ${hardware.vram_gb} GB VRAM`
      : hardware.gpu_name;
  }
  return `CPU · ${hardware.cpu_count} threads · ${hardware.ram_gb} GB RAM`;
}

/** The address the app was opened at, e.g. "localhost:3000". Client-only. */
export function useHost(): string | null {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => setHost(window.location.host), []);
  return host;
}

/**
 * The header's hardware readout (DESIGN.md "Hardware Pill"). Mono, because it
 * is telemetry; the dot is emerald only once the worker has reported in.
 */
export function EngineChip({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { data: system } = useSystem();
  const summary = hardwareSummary(system);
  const model = system?.whisper?.model;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground",
        className
      )}
      title={summary ? `${summary}${model ? ` · Whisper ${model}` : ""}` : undefined}
    >
      {summary ? (
        <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
      ) : (
        <Cpu className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">
        {summary ?? "Waiting for the worker"}
        {!compact && model && <span className="hidden 2xl:inline"> · faster-whisper {model}</span>}
      </span>
    </span>
  );
}

/** "localhost:3000", as a quiet chip beside the wordmark. */
export function HostChip({ className }: { className?: string }) {
  const host = useHost();
  if (!host) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground",
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
      {host}
    </span>
  );
}
