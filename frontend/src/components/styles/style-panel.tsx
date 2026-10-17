"use client";

import { Loader2, Move, Paintbrush, RotateCcw, Type } from "lucide-react";
import { useState } from "react";

import { RailTabs } from "@/components/layout/editor-panel";
import { FontPicker } from "@/components/styles/font-picker";
import { Range } from "@/components/ui/range";
import {
  useApplyPreset,
  useCaptionStyle,
  useResetStyle,
  useStyleOptions,
} from "@/hooks/use-caption-style";
import { cn } from "@/lib/utils";
import { MAX_BOX_WIDTH, MIN_BOX_WIDTH, PLACEMENT_Y, defaultWidth } from "@/lib/caption-layout";
import type { Alignment, CaptionStyle } from "@/types/style";

const PRESET_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  minimal: "Minimal",
};

const PLACEMENTS = [
  { key: "top", label: "Top" },
  { key: "middle", label: "Middle" },
  { key: "bottom", label: "Bottom" },
] as const;
const ALIGNMENTS = [
  { key: "left", label: "Left" },
  { key: "center", label: "Centre" },
  { key: "right", label: "Right" },
] as const satisfies readonly { key: Alignment; label: string }[];
const LINE_LIMITS = [1, 2, 3] as const;

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

/** One tab's controls: two columns where there is room. */
function Pane({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return (
    // A class, not the `hidden` attribute: `grid` would override the
    // attribute's display:none.
    <div className={cn(hidden ? "hidden" : "grid", "items-start gap-x-6 gap-y-4 sm:grid-cols-2")}>
      {children}
    </div>
  );
}

const TABS = [
  { id: "typography", label: "Typography", icon: Type },
  { id: "appearance", label: "Appearance", icon: Paintbrush },
  { id: "position", label: "Position", icon: Move },
];

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
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  /** Shown but inert while it would have no effect, so nothing reflows. */
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  // The thumb's value, owned here rather than read back from the style.
  //
  // `value` reaches this component through the query cache, and a cache write
  // re-renders on react-query's schedule, not inside the input event. React
  // restores a controlled input to its current prop as soon as the event
  // returns, so every click and arrow key snapped the thumb (and the number)
  // back to the old value for a render or two, and a drag fought its own
  // previous position. Local state updates inside the event, so the input is
  // never reset to a value the user has already left.
  const [shown, setShown] = useState(value);
  // Follow the style whenever it changes underneath: a preset, a reset, or
  // the server clamping a value. Compared during render, not in an effect, so
  // the thumb never paints one frame at the stale value.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setShown(value);
  }

  return (
    <Field label={`${label} — ${shown}${suffix ?? ""}`}>
      <Range
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          setShown(next);
          onChange(next);
        }}
      />
    </Field>
  );
}

function Swatch({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  /** Shown but inert while it would have no effect, so nothing reflows. */
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className={cn("flex items-center gap-2", disabled && "opacity-40")}>
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent disabled:cursor-not-allowed"
        />
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
    </Field>
  );
}

/**
 * A row of mutually exclusive choices — alignment, line limit, placement.
 *
 * `selected` may match none of them: a dragged caption is at no preset
 * height, and lighting one up would claim otherwise.
 */
function Choice<T extends string | number>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly { key: T; label: string }[];
  selected: T | null;
  onSelect: (key: T) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1.5">
        {options.map(({ key, label: text }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected === key}
            onClick={() => onSelect(key)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1.5 text-xs transition",
              selected === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * `update` is passed in rather than created here, and that is not tidiness.
 *
 * The hook holds a debounce timer, a `pending` patch and a sequence counter
 * for discarding superseded replies — all in refs, all per instance. Two
 * instances means two independent `latest` counters, so a reply from one
 * cannot be recognised as stale by the other: drag the caption on the video,
 * move a slider before the drag saves, and the slider's reply lands carrying a
 * server copy from before the drag and quietly reverts it.
 *
 * The video and this panel are siblings, so the one instance lives on the page
 * above both. Same failure the hook was fixed for once already, arriving by a
 * different door.
 */
export function StylePanel({
  videoId,
  update,
  isSaving,
  aspect = 16 / 9,
}: {
  videoId: number;
  update: (patch: Partial<CaptionStyle>) => void;
  isSaving: boolean;
  /** The video's aspect ratio, for the default width of its shape. */
  aspect?: number;
}) {
  const { data: style, isLoading } = useCaptionStyle(videoId);
  const { data: options } = useStyleOptions();

  const applyPreset = useApplyPreset(videoId);
  const resetStyle = useResetStyle(videoId);
  // All three stay mounted and are only hidden, so a colour picker mid-edit
  // or a scrolled font list survives a look at another tab.
  const [tab, setTab] = useState("typography");

  if (isLoading || !style) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  const set = (patch: Partial<CaptionStyle>) => update(patch);

  return (
    // No border or fill of its own: this sits inside the studio panel, which
    // carries the heading.
    <section>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-auto sm:min-w-[22rem]">
          <RailTabs tabs={TABS} value={tab} onChange={setTab} />
        </div>
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

      <div className="mb-4 flex items-center gap-1.5">
        <span className="label-caps mr-2 hidden sm:inline">Preset</span>
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

      <div className="border-t border-border pt-4">
        <Pane hidden={tab !== "typography"}>
          <Field label="Font">
            <FontPicker
              builtins={options?.fonts ?? []}
              value={style.font_key}
              onChange={(font_key) => set({ font_key })}
            />
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
        </Pane>

        <Pane hidden={tab !== "appearance"}>
          <Swatch
            label="Text colour"
            value={style.text_color}
            onChange={(text_color) => set({ text_color })}
          />

          {/* Every control here stays mounted. They used to appear and vanish
              with the values they depend on — the outline colour only while
              there is an outline and no box, and so on — and in a two-column
              grid that moves every control after them. Dragging Opacity off 0
              removed the colour swatches above it, the slider jumped a row
              (or a column) away from the pointer still dragging it, the
              browser read the pointer's new offset as 0, the swatches came
              back, and the thumb flickered between the two. Disabled instead,
              so the layout never changes under a gesture. */}
          <Slider
            label="Outline"
            value={style.outline_width}
            min={0}
            max={20}
            suffix="px"
            onChange={(outline_width) => set({ outline_width })}
          />
          <Swatch
            label="Outline colour"
            value={style.outline_color}
            disabled={style.outline_width === 0 || style.box_opacity > 0}
            onChange={(outline_color) => set({ outline_color })}
          />

          <Slider
            label="Shadow"
            value={style.shadow}
            min={0}
            max={20}
            suffix="px"
            onChange={(shadow) => set({ shadow })}
          />
          <Swatch
            label="Shadow colour"
            value={style.shadow_color}
            disabled={style.shadow === 0 || style.box_opacity > 0}
            onChange={(shadow_color) => set({ shadow_color })}
          />
          <Slider
            label="Opacity"
            value={Math.round(style.box_opacity * 100)}
            min={0}
            max={100}
            suffix="%"
            onChange={(percent) => set({ box_opacity: percent / 100 })}
          />
          <Swatch
            label="Box colour"
            value={style.box_color}
            disabled={style.box_opacity === 0}
            onChange={(box_color) => set({ box_color })}
          />
          <Slider
            label="Padding"
            value={style.box_padding}
            min={0}
            max={60}
            suffix="px"
            disabled={style.box_opacity === 0}
            onChange={(box_padding) => set({ box_padding })}
          />
          {/* An opaque box replaces both the outline and the shadow in ASS,
              so saying so beats leaving two controls that do nothing. Always
              present, for the same reason as the controls above; it is what
              explains why some of them are greyed out. */}
          <p className="text-[11px] text-muted-foreground sm:col-span-2">
            {style.box_opacity > 0
              ? "A box replaces the outline and shadow — that's how it renders on export."
              : "Raise Opacity to put a box behind the caption."}
          </p>
        </Pane>

        <Pane hidden={tab !== "position"}>
          {/* Centred, at a height inside the safe area. Each caption is then
              slid inside it on its own, so a long one at the bottom still
              clears the edge. */}
          <Choice
            label="Placement"
            options={PLACEMENTS}
            selected={
              style.pos_x === 0.5
                ? (PLACEMENTS.find(({ key }) => PLACEMENT_Y[key] === style.pos_y)?.key ?? null)
                : null
            }
            onSelect={(key) => set({ pos_x: 0.5, pos_y: PLACEMENT_Y[key] })}
          />
          <Choice
            label="Alignment"
            options={ALIGNMENTS}
            selected={style.alignment}
            onSelect={(alignment) => set({ alignment })}
          />
          {/* The box's width: text wraps at it, wherever the box is. The same
              value the handles on the box's edges set. */}
          <Slider
            label="Max width"
            value={Math.round((style.box_width ?? defaultWidth({ width: aspect, height: 1 })) * 100)}
            min={MIN_BOX_WIDTH * 100}
            max={MAX_BOX_WIDTH * 100}
            suffix="%"
            onChange={(percent) => set({ box_width: percent / 100 })}
          />
          <Choice
            label="Max lines"
            options={LINE_LIMITS.map((n) => ({ key: n, label: String(n) }))}
            selected={style.max_lines}
            onSelect={(max_lines) => set({ max_lines })}
          />
          <p className="text-[11px] text-muted-foreground sm:col-span-2">
            A caption that needs more lines is drawn smaller, down to 70% of the size, then gets one
            more line. Drag the caption to move it, or the edges of its box to change the width.
          </p>
        </Pane>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Sizes are for a {style.reference_height}p frame and scale with the video,
        so one style looks the same on a 360p clip and a 4K one.
      </p>
    </section>
  );
}
