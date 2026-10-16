"use client";

import { Check, Cpu, HardDrive, KeyRound, Languages, Monitor, Moon, Sparkles, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useStats } from "@/hooks/use-stats";
import { useSystem, useUpdateSystemSettings } from "@/hooks/use-system";
import { useLanguageOptions } from "@/hooks/use-videos";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SystemInfo } from "@/types/system";

/** One settings card: a small caps eyebrow, a title, and its controls. */
export function SettingsSection({
  eyebrow,
  title,
  description,
  icon: Icon,
  aside,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: typeof Cpu;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="label-caps">{eyebrow}</p>}
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Saved() {
  return (
    <span className="flex animate-fade-in items-center gap-1.5 text-sm text-success" role="status">
      <Check className="size-4" aria-hidden="true" />
      Saved
    </span>
  );
}

function Chip({ tone = "neutral", children }: { tone?: "neutral" | "success" | "primary"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[11px]",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "primary" && "border-primary/30 bg-primary/10 text-primary",
        tone === "neutral" && "border-border bg-surface-2 text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function MachineSection({ info }: { info: SystemInfo }) {
  const hw = info.hardware;
  return (
    <SettingsSection
      eyebrow="Hardware profile"
      title="Your computer"
      icon={Cpu}
      aside={hw && <Chip tone={hw.cuda ? "success" : "neutral"}>{hw.cuda ? "● CUDA active" : "CPU only"}</Chip>}
    >
      {!hw ? (
        <p className="text-sm text-muted-foreground" role="status">
          Waiting for the processing service to report in. It does so as soon as it has started.
        </p>
      ) : (
        <>
          <p className="font-mono text-sm text-primary">
            {hw.cuda ? `${hw.gpu_name ?? "NVIDIA GPU"}${hw.vram_gb ? ` · ${hw.vram_gb} GB VRAM` : ""}` : `CPU · ${hw.cpu_count} cores`}
            {` · ${hw.ram_gb} GB RAM`}
          </p>
          {!hw.cuda && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              No NVIDIA GPU found. Everything still works; transcription just takes longer.
            </p>
          )}
          <div className="mt-4 rounded-lg border border-border bg-surface-1 p-4">
            {info.whisper && (
              <p className="flex flex-wrap items-center gap-2 text-[13px]">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                <span className="font-semibold">Speech model in use:</span>
                <Chip tone="primary">{info.whisper.model}</Chip>
                <span className="text-muted-foreground">
                  on {info.whisper.device === "cuda" ? "the GPU" : "the CPU"},{" "}
                  {info.whisper.source === "auto"
                    ? "chosen automatically for this hardware."
                    : info.whisper.source === "user"
                      ? "chosen by you below."
                      : "set by the WHISPER_MODEL_SIZE environment variable."}
                </span>
              </p>
            )}
            {/* The rule the worker applies (backend/app/services/hardware.py). */}
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Automatic: GPU ≥ 6 GB VRAM → large-v3 · CPU ≥ 12 GB RAM → large-v3-turbo · otherwise → small
            </p>
          </div>
        </>
      )}
    </SettingsSection>
  );
}

function ModelSection({ info }: { info: SystemInfo }) {
  const update = useUpdateSystemSettings();
  const automatic = info.whisper?.source === "auto" ? info.whisper.model : null;

  return (
    <SettingsSection
      title="Speech model"
      description="Larger models are more accurate and slower. Each one is downloaded once, the first time it's used. Applies to the next video you process."
      aside={<Chip tone="primary">faster-whisper</Chip>}
    >
      <div role="radiogroup" aria-label="Speech model" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {info.whisper_choices.map((choice) => {
          // "Small · fastest, ~500 MB" → name and what it costs.
          const [name, detail] = choice.label.split(" · ");
          const active = info.whisper_choice === choice.value;
          return (
            <label
              key={choice.value}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                active ? "border-primary/60 bg-primary/10" : "border-border bg-surface-1 hover:bg-surface-2",
                update.isPending && "pointer-events-none opacity-60"
              )}
            >
              <input
                type="radio"
                name="whisper_model"
                value={choice.value}
                checked={active}
                disabled={update.isPending}
                onChange={() => update.mutate({ whisper_model: choice.value })}
                className="sr-only"
              />
              <span className="flex items-start justify-between gap-2">
                <span className="text-base font-semibold">{name}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    active ? "bg-primary text-primary-foreground" : "border border-border bg-card"
                  )}
                >
                  {active && <Check className="size-3" />}
                </span>
              </span>
              {detail && <span className="text-[13px] text-muted-foreground">{detail}</span>}
              {choice.value !== "auto" && choice.value === automatic && (
                <span className="self-start">
                  <Chip tone="primary">Picked for this computer</Chip>
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex min-h-5 items-center gap-3">
        {update.isSuccess && <Saved />}
        {update.isError && (
          <span role="alert" className="text-sm text-destructive">
            Couldn&apos;t save that. Try again.
          </span>
        )}
      </div>
    </SettingsSection>
  );
}

function TranslationSection({ info }: { info: SystemInfo }) {
  const update = useUpdateSystemSettings();
  const { data: languageOptions } = useLanguageOptions();
  const [key, setKey] = useState("");
  const gemini = info.translation_engine === "gemini";

  function save(event: React.FormEvent) {
    event.preventDefault();
    update.mutate({ gemini_api_key: key.trim() }, { onSuccess: () => setKey("") });
  }

  // Which engine translates is decided by whether a key is set, so these
  // say which one is in use rather than offering a switch.
  const engines = [
    {
      id: "local",
      name: `Local (${info.translator_model ?? "M2M100"})`,
      chips: ["Default", "Private"],
      body: "Runs on this computer with no network calls.",
      inUse: !gemini,
    },
    {
      id: "gemini",
      name: "Gemini",
      chips: ["Optional", "Online"],
      body: "Google's Gemini translates the caption text, which often reads more naturally, and adds written answers to Search. Falls back to local if it can't be reached.",
      inUse: gemini,
    },
  ];

  return (
    <SettingsSection eyebrow="Caption languages" title="Translation" icon={Languages}>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2">
        <span className="label-caps mr-1">Languages</span>
        {/* Served, not listed here: this used to be five names typed into
            the page, which the language list had already outgrown. */}
        {(languageOptions?.caption ?? [])
          .filter((option) => option.native)
          .map((option) => (
            <Chip key={option.code}>
              <span lang={option.code}>{option.native}</span>
              {option.native !== option.label && (
                <span className="ml-1 text-muted-foreground">{option.label}</span>
              )}
            </Chip>
          ))}
      </div>

      <div className="flex flex-col gap-3">
        {engines.map((engine) => (
          <div
            key={engine.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4",
              engine.inUse ? "border-primary/50 bg-primary/10" : "border-border bg-surface-1"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                engine.inUse ? "border-primary" : "border-border"
              )}
            >
              {engine.inUse && <span className="size-1.5 rounded-full bg-primary" />}
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                {engine.name}
                {engine.chips.map((chip) => (
                  <Chip key={chip}>{chip}</Chip>
                ))}
                {engine.inUse && <Chip tone="primary">In use</Chip>}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">{engine.body}</p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={save} className="mt-5 space-y-3">
        <p className="flex items-start gap-2 text-sm">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {info.gemini_configured ? (
            <span>
              <span className="font-medium text-success">Key set.</span>
              {info.gemini_source === "env" && " (Set by the GEMINI_API_KEY environment variable.)"}
            </span>
          ) : (
            <span className="text-muted-foreground">No key: translating locally.</span>
          )}
        </p>
        <Field
          label={info.gemini_configured ? "Replace Gemini API key" : "Gemini API key (optional)"}
          name="gemini_api_key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="AIza…"
          hint="Create one at aistudio.google.com/apikey. With a key, caption text (never the video or audio) is sent to Google."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!key.trim()} loading={update.isPending}>
            Save key
          </Button>
          {info.gemini_source === "settings" && (
            <Button
              type="button"
              variant="secondary"
              disabled={update.isPending}
              onClick={() => update.mutate({ gemini_api_key: "" })}
            >
              Remove key
            </Button>
          )}
          {update.isSuccess && <Saved />}
          {update.isError && (
            <span role="alert" className="text-sm text-destructive">
              Couldn&apos;t save the key. Try again.
            </span>
          )}
        </div>
      </form>
    </SettingsSection>
  );
}

function StorageSection() {
  const { data } = useStats();
  const { preference, setPreference } = useTheme();
  // The stored theme is only known after mount; see ThemeToggle.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const used = data ? data.disk_total_bytes - data.disk_free_bytes : 0;
  const percent = data && data.disk_total_bytes > 0 ? Math.round((used / data.disk_total_bytes) * 100) : 0;

  return (
    <SettingsSection eyebrow="Disk usage" title="Storage & theme" icon={HardDrive}>
      {data ? (
        <>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{formatFileSize(used)}</span>
            <span className="text-[13px] text-muted-foreground">used of {formatFileSize(data.disk_total_bytes)} on this disk</span>
          </p>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Disk usage"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <p className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2 text-[13px]">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                This app&apos;s videos and exports
              </span>
              <span className="font-mono tabular-nums">{formatFileSize(data.storage_bytes)}</span>
            </p>
            <p className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2 text-[13px]">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                Free
              </span>
              <span className="font-mono tabular-nums">{formatFileSize(data.disk_free_bytes)}</span>
            </p>
          </div>
        </>
      ) : (
        <Skeleton className="h-20 w-full" />
      )}

      <div className="mt-6 border-t border-border pt-5">
        <p className="label-caps">Appearance</p>
        <p className="mb-3 text-base font-semibold">Interface theme</p>
        <div role="radiogroup" aria-label="Interface theme" className="inline-flex gap-1 rounded-lg border border-border bg-surface-1 p-1">
          {(
            [
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
              { value: "system", label: "System", icon: Monitor },
            ] as const
          ).map((option) => {
            const active = mounted && preference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => !active && setPreference(option.value)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-5 py-1.5 text-[13px] transition-colors",
                  active ? "bg-surface-3 font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <option.icon className="size-4" aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
}

/** The install's own settings: hardware, speech model, translation, disk and theme. */
export function InstallSettings() {
  const system = useSystem();

  if (system.isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (system.isError || !system.data) {
    return (
      <section className="rounded-lg border border-border bg-card p-5" role="alert">
        <p className="text-sm font-medium">Couldn&apos;t load settings.</p>
        <p className="mt-1 text-sm text-muted-foreground">The app&apos;s server didn&apos;t answer.</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => system.refetch()}>
          Try again
        </Button>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <MachineSection info={system.data} />
      <ModelSection info={system.data} />
      <TranslationSection info={system.data} />
      <StorageSection />
    </div>
  );
}
