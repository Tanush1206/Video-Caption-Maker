"use client";

import { Check, Cpu, KeyRound, MemoryStick, Mic } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystem, useUpdateSystemSettings } from "@/hooks/use-system";
import type { SystemInfo } from "@/types/system";

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
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

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Cpu;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <dt className="w-24 shrink-0 text-sm text-muted-foreground sm:w-28">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

const DEVICE: Record<string, string> = { cuda: "GPU", cpu: "CPU" };

function MachineSection({ info }: { info: SystemInfo }) {
  const hw = info.hardware;
  return (
    <SettingsSection
      title="This computer"
      description="Everything runs here. Videos, captions and models stay on this machine unless you add a Gemini key below."
    >
      {!hw ? (
        <p className="text-sm text-muted-foreground" role="status">
          Waiting for the processing service to report in. It does so as soon as it has started.
        </p>
      ) : (
        <dl className="divide-y divide-border">
          <Row icon={Cpu} label="Processor">
            {hw.cuda ? (
              <>
                {hw.gpu_name ?? "NVIDIA GPU"}
                {hw.vram_gb ? ` · ${hw.vram_gb} GB` : ""}
              </>
            ) : (
              <>
                CPU only · {hw.cpu_count} cores
                <span className="block text-xs text-muted-foreground">
                  No NVIDIA GPU found. Everything still works; transcription just takes longer.
                </span>
              </>
            )}
          </Row>
          <Row icon={MemoryStick} label="Memory">
            {hw.ram_gb} GB available to the app
          </Row>
          {info.whisper && (
            <Row icon={Mic} label="Speech model">
              {info.whisper.model} on {DEVICE[info.whisper.device] ?? info.whisper.device}
              <span className="block text-xs text-muted-foreground">
                {info.whisper.source === "auto"
                  ? "Chosen automatically for this hardware."
                  : info.whisper.source === "user"
                    ? "Chosen by you below."
                    : "Set by the WHISPER_MODEL_SIZE environment variable."}
              </span>
            </Row>
          )}
        </dl>
      )}
    </SettingsSection>
  );
}

function ModelSection({ info }: { info: SystemInfo }) {
  const update = useUpdateSystemSettings();

  return (
    <SettingsSection
      title="Speech recognition"
      description="Larger models are more accurate and slower. Each one is downloaded once, the first time it's used."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-80">
          <Select
            label="Model"
            name="whisper_model"
            value={info.whisper_choice}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ whisper_model: event.target.value })}
          >
            {info.whisper_choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </div>
        {update.isSuccess && <Saved />}
        {update.isError && (
          <span role="alert" className="text-sm text-destructive">
            Couldn&apos;t save that. Try again.
          </span>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Applies to the next video you process. Videos that already have captions keep them.
      </p>
    </SettingsSection>
  );
}

function GeminiSection({ info }: { info: SystemInfo }) {
  const update = useUpdateSystemSettings();
  const [key, setKey] = useState("");

  function save(event: React.FormEvent) {
    event.preventDefault();
    update.mutate({ gemini_api_key: key.trim() }, { onSuccess: () => setKey("") });
  }

  return (
    <SettingsSection
      title="Gemini API key (optional)"
      description="Not needed: captions are translated on this computer by default. A key lets Google's Gemini translate instead, which often reads more naturally, and adds written answers to Search."
    >
      <p className="mb-4 flex items-start gap-2 text-sm">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {info.gemini_configured ? (
          <span>
            <span className="font-medium text-success">Key set.</span> If Gemini can&apos;t be
            reached, translation falls back to this computer automatically.
            {info.gemini_source === "env" && " (Set by the GEMINI_API_KEY environment variable.)"}
          </span>
        ) : (
          <span className="text-muted-foreground">No key. Translating locally with M2M100.</span>
        )}
      </p>

      <form onSubmit={save} className="space-y-3">
        <Field
          label={info.gemini_configured ? "Replace key" : "API key"}
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

/** The install's own settings: hardware, speech model, optional Gemini key. */
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
      <Card className="p-4 sm:p-5" role="alert">
        <p className="text-sm font-medium">Couldn&apos;t load settings.</p>
        <p className="mt-1 text-sm text-muted-foreground">The app&apos;s server didn&apos;t answer.</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => system.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <MachineSection info={system.data} />
      <ModelSection info={system.data} />
      <GeminiSection info={system.data} />
    </div>
  );
}
