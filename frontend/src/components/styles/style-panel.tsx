"use client";

import { Loader2, RotateCcw } from "lucide-react";

import {
  useApplyPreset,
  useCaptionStyle,
  useResetStyle,
  useStyleOptions,
  useUpdateCaptionStyle,
} from "@/hooks/use-caption-style";
import { cn } from "@/lib/utils";
import type { Alignment, CaptionStyle, VerticalPosition } from "@/types/style";

const PRESET_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  minimal: "Minimal",
};

const POSITIONS: VerticalPosition[] = ["top", "middle", "bottom"];
const ALIGNMENTS: Alignment[] = ["left", "center", "right"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={`${label} — ${value}${suffix ?? ""}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </Field>
  );
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
        />
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
    </Field>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex rounded-md border border-border p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs capitalize transition",
              value === option
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function StylePanel({ videoId }: { videoId: number }) {
  const { data: style, isLoading } = useCaptionStyle(videoId);
  const { data: options } = useStyleOptions();

  const { update, isSaving } = useUpdateCaptionStyle(videoId);
  const applyPreset = useApplyPreset(videoId);
  const resetStyle = useResetStyle(videoId);

  if (isLoading || !style) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  const set = (patch: Partial<CaptionStyle>) => update(patch);

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="label-caps">
          Caption style
        </h2>
        <div className="flex items-center gap-2">
          {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={() => resetStyle.mutate("")}
            title="Back to defaults"
            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </header>

      <div className="mb-3 flex gap-1.5">
        {(options?.presets ?? []).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => applyPreset.mutate(preset)}
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs transition hover:border-primary hover:bg-primary/10"
          >
            {PRESET_LABELS[preset] ?? preset}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <Field label="Font">
          <select
            value={style.font_key}
            onChange={(event) => set({ font_key: event.target.value })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {(options?.fonts ?? []).map((font) => (
              <option key={font.key} value={font.key}>
                {font.label}
              </option>
            ))}
          </select>
        </Field>

        <Slider
          label="Size"
          value={style.font_size}
          min={12}
          max={200}
          suffix="px"
          onChange={(font_size) => set({ font_size })}
        />

        <div className="flex gap-2">
          {(["bold", "italic"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => set({ [key]: !style[key] } as Partial<CaptionStyle>)}
              aria-pressed={style[key]}
              className={cn(
                "flex-1 rounded-md border px-2 py-1.5 text-xs capitalize transition",
                key === "bold" && "font-bold",
                key === "italic" && "italic",
                style[key]
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {key}
            </button>
          ))}
        </div>

        <Swatch
          label="Text colour"
          value={style.text_color}
          onChange={(text_color) => set({ text_color })}
        />

        <Slider
          label="Outline"
          value={style.outline_width}
          min={0}
          max={20}
          suffix="px"
          onChange={(outline_width) => set({ outline_width })}
        />
        {style.outline_width > 0 && style.box_opacity === 0 && (
          <Swatch
            label="Outline colour"
            value={style.outline_color}
            onChange={(outline_color) => set({ outline_color })}
          />
        )}

        <Slider
          label="Box"
          value={Math.round(style.box_opacity * 100)}
          min={0}
          max={100}
          suffix="%"
          onChange={(percent) => set({ box_opacity: percent / 100 })}
        />
        {style.box_opacity > 0 && (
          <>
            <Swatch
              label="Box colour"
              value={style.box_color}
              onChange={(box_color) => set({ box_color })}
            />
            {/* An opaque box replaces the outline in ASS, so saying so beats
                leaving a control that visibly does nothing. */}
            <p className="text-[11px] text-muted-foreground">
              A box replaces the outline — that&apos;s how it renders on export.
            </p>
          </>
        )}

        <Segmented
          label="Position"
          options={POSITIONS}
          value={style.position}
          onChange={(position) => set({ position })}
        />
        <Segmented
          label="Alignment"
          options={ALIGNMENTS}
          value={style.alignment}
          onChange={(alignment) => set({ alignment })}
        />

        <Slider
          label="Edge margin"
          value={style.margin_v}
          min={0}
          max={300}
          suffix="px"
          onChange={(margin_v) => set({ margin_v })}
        />
        <Slider
          label="Side margin"
          value={style.margin_h}
          min={0}
          max={300}
          suffix="px"
          onChange={(margin_h) => set({ margin_h })}
        />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Sizes are for a {style.reference_height}p frame and scale with the video,
        so one style looks the same on a 360p clip and a 4K one.
      </p>
    </section>
  );
}
