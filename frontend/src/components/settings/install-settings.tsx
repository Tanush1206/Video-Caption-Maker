"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useStats } from "@/hooks/use-stats";
import { useSystem, useUpdateSystemSettings } from "@/hooks/use-system";
import { useLanguageOptions } from "@/hooks/use-videos";
import { formatDurationLong, formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SystemInfo } from "@/types/system";

/**
 * One settings group (System Settings): a small grey heading, the inset
 * rounded group of rows, and a footnote under it.
 */
export function SettingsSection({
  title,
  footnote,
  children,
}: {
  title: string;
  footnote?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="label-caps mb-1.5 px-4">{title}</h2>
      <div className="group-inset">{children}</div>
      {footnote && <div className="mt-1.5 px-4 text-[13px] text-muted-foreground">{footnote}</div>}
    </section>
  );
}

/** A row: the label on the left, its value (grey) or control on the right. */
function Row({ label, sub, children }: { label: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="group-row">
      <div className="min-w-0">
        <div className="whitespace-nowrap text-[15px]">{label}</div>
        {sub && <div className="text-[13px] text-muted-foreground">{sub}</div>}
      </div>
      {children !== undefined && (
        <div className="min-w-0 text-right text-[15px] text-muted-foreground">{children}</div>
      )}
    </div>
  );
}

function Saved() {
  return (
    <span className="flex animate-fade-in items-center gap-1.5 text-[13px] text-muted-foreground" role="status">
      <Check className="size-4 text-success" aria-hidden="true" />
      Saved
    </span>
  );
}

function MachineSection({ info }: { info: SystemInfo }) {
  const hw = info.hardware;
  return (
    <SettingsSection
      title="Your computer"
      footnote={
        hw && (
          <>
            {!hw.cuda && <p>No NVIDIA GPU found. Everything still works; transcription just takes longer.</p>}
            {info.whisper && (
              <p>
                The speech model runs on {info.whisper.device === "cuda" ? "the GPU" : "the CPU"},{" "}
                {info.whisper.source === "auto"
                  ? "chosen automatically for this hardware."
                  : info.whisper.source === "user"
                    ? "chosen by you below."
                    : "set by the WHISPER_MODEL_SIZE environment variable."}
              </p>
            )}
            {/* The rule the worker applies (backend/app/services/hardware.py). */}
            <p className="mt-1">
              Automatic: GPU ≥ 6 GB VRAM → large-v3 · CPU ≥ 12 GB RAM → large-v3-turbo · otherwise → small
            </p>
          </>
        )
      }
    >
      {!hw ? (
        <p className="group-row text-[15px] text-muted-foreground" role="status">
          Waiting for the processing service to report in. It does so as soon as it has started.
        </p>
      ) : (
        <>
          <Row label="Acceleration">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", hw.cuda ? "bg-success" : "bg-muted-foreground")} aria-hidden="true" />
              {hw.cuda ? "CUDA active" : "CPU only"}
            </span>
          </Row>
          {hw.cuda && (
            <Row label="Graphics">
              {hw.gpu_name ?? "NVIDIA GPU"}
              {hw.vram_gb ? ` · ${hw.vram_gb} GB VRAM` : ""}
            </Row>
          )}
          {!hw.cuda && <Row label="Processor">{hw.cpu_count} cores</Row>}
          <Row label="Memory">{hw.ram_gb} GB RAM</Row>
          {info.whisper && <Row label="Speech model in use">{info.whisper.model}</Row>}
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
      footnote={
        <>
          <p>
            faster-whisper. Larger models are more accurate and slower. Each one is downloaded once, the first
            time it&apos;s used. Applies to the next video you process.
          </p>
          {(update.isSuccess || update.isError) && (
            <div className="mt-1 flex min-h-5 items-center gap-3">
              {update.isSuccess && <Saved />}
              {update.isError && (
                <span role="alert" className="text-destructive">
                  Couldn&apos;t save that. Try again.
                </span>
              )}
            </div>
          )}
        </>
      }
    >
      {/* A grouped list with a check on the chosen row. */}
      <div role="radiogroup" aria-label="Speech model">
        {info.whisper_choices.map((choice) => {
          // "Small · fastest, ~500 MB" → name and what it costs.
          const [name, detail] = choice.label.split(" · ");
          const active = info.whisper_choice === choice.value;
          return (
            <label
              key={choice.value}
              className={cn(
                "group-row cursor-pointer transition-colors duration-200 ease-out hover:bg-surface-3/50",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
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
              <span className="min-w-0">
                <span className="block text-[15px]">{name}</span>
                {detail && <span className="block text-[13px] text-muted-foreground">{detail}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {choice.value !== "auto" && choice.value === automatic && (
                  <span className="text-[13px] text-muted-foreground">Picked for this computer</span>
                )}
                <Check aria-hidden="true" className={cn("size-5 text-primary", !active && "invisible")} />
              </span>
            </label>
          );
        })}
      </div>
      {/* Not a choice: Hindi in Roman script always uses its own model. The
          hairline is drawn here because the row follows the radio group, not
          another row. */}
      <div className="group-row border-t border-border">
        <span className="min-w-0">
          <span className="block text-[15px]">Hinglish (Apex)</span>
          <span className="block text-[13px] text-muted-foreground">
            For Hindi in English letters, whatever the model above
          </span>
        </span>
        <span className="shrink-0 text-right text-[15px] text-muted-foreground">
          {info.hinglish_model.downloaded ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              Downloaded · {formatFileSize(info.hinglish_model.size_bytes)}
            </span>
          ) : (
            `Not downloaded · ${formatFileSize(info.hinglish_model.size_bytes)}`
          )}
        </span>
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
  // Served, not listed here: this used to be five names typed into the page,
  // which the language list had already outgrown.
  const languages = (languageOptions?.caption ?? []).filter((option) => option.native);

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title="Translation">
        {engines.map((engine) => (
          <Row
            key={engine.id}
            label={
              <>
                {engine.name}
                {engine.inUse && <span className="sr-only"> (in use)</span>}
              </>
            }
            sub={`${engine.chips.join(" · ")} — ${engine.body}`}
          >
            <Check aria-hidden="true" className={cn("size-5 text-primary", !engine.inUse && "invisible")} />
          </Row>
        ))}
        <Row label="Caption languages">
          <span className="block text-[13px]">
            {languages.map((option, index) => (
              <span key={option.code}>
                {index > 0 && " · "}
                <span lang={option.code}>{option.native}</span>
              </span>
            ))}
          </span>
        </Row>
      </SettingsSection>

      <SettingsSection
        title="Gemini"
        footnote={
          <>
            <p>
              Create one at aistudio.google.com/apikey. With a key, caption text (never the video or audio) is
              sent to Google.
            </p>
            <p className="mt-1">
              With a free key, Google may use that text to improve its products, and people at Google may read it:
              for anything private, use a paid key or none. Gemini requires you to be 18 or over, and in the EEA,
              Switzerland and the UK only paid keys may be used.
            </p>
            {(update.isSuccess || update.isError) && (
              <div className="mt-1 flex min-h-5 items-center gap-3">
                {update.isSuccess && <Saved />}
                {update.isError && (
                  <span role="alert" className="text-destructive">
                    Couldn&apos;t save the key. Try again.
                  </span>
                )}
              </div>
            )}
          </>
        }
      >
        <Row label="Key">
          <span className="inline-flex flex-wrap items-center justify-end gap-x-3">
            {info.gemini_configured ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                Set{info.gemini_source === "env" && " by the GEMINI_API_KEY environment variable"}
              </span>
            ) : (
              "No key: translating locally"
            )}
            {info.gemini_source === "settings" && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="-mr-3"
                disabled={update.isPending}
                onClick={() => update.mutate({ gemini_api_key: "" })}
              >
                Remove key
              </Button>
            )}
          </span>
        </Row>
        <form onSubmit={save} className="group-row flex-wrap gap-y-2">
          <label htmlFor="gemini_api_key" className="text-[15px]">
            {info.gemini_configured ? "Replace Gemini API key" : "Gemini API key (optional)"}
          </label>
          <span className="flex w-full items-center gap-2 sm:w-auto">
            <input
              id="gemini_api_key"
              name="gemini_api_key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="AIza…"
              className={cn(inputClasses, "min-w-0 flex-1 sm:w-56")}
            />
            <Button type="submit" disabled={!key.trim()} loading={update.isPending}>
              Save key
            </Button>
          </span>
        </form>
      </SettingsSection>
    </div>
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
    <>
      <SettingsSection title="Storage">
        {data ? (
          <>
            <div className="group-row flex-col items-stretch gap-2 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px]">This disk</span>
                <span className="text-[15px] tabular-nums text-muted-foreground">
                  {formatFileSize(used)} used of {formatFileSize(data.disk_total_bytes)}
                </span>
              </div>
              <div
                className="h-1 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label="Disk usage"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="bar-fill h-full rounded-full" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <Row label="This app's videos and exports">
              <span className="tabular-nums">{formatFileSize(data.storage_bytes)}</span>
            </Row>
            <Row label="Free">
              <span className="tabular-nums">{formatFileSize(data.disk_free_bytes)}</span>
            </Row>
            {/* The library's figures, moved here from the dashboard (v1.1.0),
                which keeps only the count and the size. */}
            <Row label="Footage">{formatDurationLong(data.duration_ms)}</Row>
            <Row label="Captions">
              <span className="tabular-nums">{data.captions.toLocaleString()}</span>
            </Row>
            <Row label="In the queue">
              <span className="tabular-nums">{data.by_status.pending + data.by_status.processing}</span>
            </Row>
          </>
        ) : (
          <Skeleton className="m-4 h-20" />
        )}
      </SettingsSection>

      <SettingsSection title="Appearance">
        <div className="group-row flex-wrap gap-y-2">
          <span className="text-[15px]">Interface theme</span>
          <Segmented
            kind="radio"
            label="Interface theme"
            segments={[
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
              { value: "system", label: "System", icon: Monitor },
            ]}
            value={mounted ? preference : null}
            onChange={(value) => value !== null && value !== preference && setPreference(value)}
            className="w-full sm:w-auto"
            segmentClassName="px-4"
          />
        </div>
      </SettingsSection>
    </>
  );
}

/** The install's own settings: hardware, speech model, translation, disk and theme. */
export function InstallSettings() {
  const system = useSystem();

  if (system.isPending) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (system.isError || !system.data) {
    return (
      <Notice role="alert" tone="error" title="Couldn't load settings.">
        The app&apos;s server didn&apos;t answer.
        <Button className="mt-3 flex" variant="secondary" size="sm" onClick={() => system.refetch()}>
          Try again
        </Button>
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <MachineSection info={system.data} />
      <ModelSection info={system.data} />
      <TranslationSection info={system.data} />
      <StorageSection />
    </div>
  );
}
