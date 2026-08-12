"use client";

import { ChevronDown, Loader2, RotateCcw } from "lucide-react";

import { Range } from "@/components/ui/range";
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

/**
 * The on/off text properties, each previewing itself in its own button.
 *
 * `Aa` for uppercase rather than the word: the label has to show the effect,
 * and the word "uppercase" set in uppercase is a riddle.
 */
const EMPHASIS = [
  { key: "bold", label: "Bold", className: "font-bold" },
  { key: "italic", label: "Italic", className: "italic" },
  { key: "underline", label: "Underline", className: "underline" },
  { key: "strikeout", label: "Strike", className: "line-through" },
  { key: "uppercase", label: "AA", className: "tracking-wide" },
] as const satisfies readonly { key: keyof CaptionStyle; label: string; className: string }[];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * A collapsible group of controls.
 *
 * Native `<details>` rather than a useState toggle: it is keyboard accessible
 * and findable by the browser's own in-page search without any of that being
 * written here. Open by default, because a control you cannot see is a control
 * you do not know exists — collapsing is for tidying, not for discovery.
 */
function Group({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-border pt-3 first:border-t-0 first:pt-0">
      <summary className="label-caps flex cursor-pointer list-none items-center justify-between transition-colors hover:text-foreground">
        {title}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

/** A row of on/off pills — bold, italic, underline and the rest. */
function Toggles<T extends string>({
  options,
  isOn,
  onToggle,
}: {
  options: readonly { key: T; label: string; className?: string }[];
  isOn: (key: T) => boolean;
  onToggle: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ key, label, className }) => (
        <button
          key={key}
          type="button"
          onClick={() => onToggle(key)}
          aria-pressed={isOn(key)}
          className={cn(
            "flex-1 rounded-md border px-2 py-1.5 text-xs transition",
            className,
            isOn(key)
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          )}
        >
          {label}
        </button>
      ))}
    </div>
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
      <Range
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
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
        <Group title="Text">
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

          <Toggles
            options={EMPHASIS}
            isOn={(key) => style[key]}
            onToggle={(key) => set({ [key]: !style[key] } as Partial<CaptionStyle>)}
          />

          <Slider
            label="Letter spacing"
            value={style.letter_spacing}
            min={-10}
            max={50}
            suffix="px"
            onChange={(letter_spacing) => set({ letter_spacing })}
          />
        </Group>

        <Group title="Fill and edge">
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
            label="Shadow"
            value={style.shadow}
            min={0}
            max={20}
            suffix="px"
            onChange={(shadow) => set({ shadow })}
          />
          {style.shadow > 0 && style.box_opacity === 0 && (
            <Swatch
              label="Shadow colour"
              value={style.shadow_color}
              onChange={(shadow_color) => set({ shadow_color })}
            />
          )}
        </Group>

        <Group title="Box">
          <Slider
            label="Opacity"
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
              <Slider
                label="Padding"
                value={style.box_padding}
                min={0}
                max={60}
                suffix="px"
                onChange={(box_padding) => set({ box_padding })}
              />
              {/* An opaque box replaces both the outline and the shadow in ASS,
                  so saying so beats leaving two controls that do nothing. */}
              <p className="text-[11px] text-muted-foreground">
                A box replaces the outline and shadow — that&apos;s how it renders
                on export.
              </p>
            </>
          )}
        </Group>

        <Group title="Placement">
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
        </Group>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Sizes are for a {style.reference_height}p frame and scale with the video,
        so one style looks the same on a 360p clip and a 4K one.
      </p>
    </section>
  );
}
