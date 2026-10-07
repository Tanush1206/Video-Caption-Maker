"use client";

import { ChevronDown, Loader2, RotateCcw } from "lucide-react";

import { FontPicker } from "@/components/styles/font-picker";
import { Range } from "@/components/ui/range";
import {
  useApplyPreset,
  useCaptionStyle,
  useResetStyle,
  useStyleOptions,
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

/**
 * The nine places a caption can sit, as a picture of the frame.
 *
 * This was two segmented controls reading "top / middle / bottom" and "left /
 * center / right" — six words to express one point in a rectangle, and you had
 * to build the combination in your head before you could click it.
 *
 * Nine cells is what the underlying format actually offers. ASS positions text
 * with an alignment anchor plus margins, so these are not a convenience over
 * free coordinates; they *are* the coordinate system, and a control shaped
 * like the thing it sets beats two lists of adverbs.
 *
 * The dot inside each cell sits where the caption would sit, so the control is
 * a small map rather than a grid of identical squares.
 */
function AnchorGrid({
  position,
  alignment,
  placed,
  aspect,
  onChange,
}: {
  position: VerticalPosition;
  alignment: Alignment;
  /** Whether the caption has been dragged, and so is not on an anchor at all. */
  placed: boolean;
  /** The video's real shape. A portrait clip must not get a 16:9 map. */
  aspect: number;
  onChange: (next: Partial<CaptionStyle>) => void;
}) {
  return (
    <Field label="Placement">
      <div
        role="radiogroup"
        aria-label="Caption placement"
        // The aspect comes from the loaded video rather than being assumed,
        // because the whole idea is that this is a picture of the frame. A
        // 16:9 control over a vertical video would put the dots somewhere the
        // caption will not be.
        style={{ aspectRatio: aspect }}
        className="mx-auto grid w-full max-w-full grid-cols-3 grid-rows-3 gap-0.5 rounded-md border border-border bg-background/40 p-0.5"
      >
        {POSITIONS.map((row) =>
          ALIGNMENTS.map((column) => {
            // Nothing is selected once the caption has been dragged: it is at
            // some x/y that is almost certainly not any of these nine, and
            // lighting one up would claim otherwise.
            const selected = !placed && position === row && alignment === column;
            return (
              <button
                key={`${row}-${column}`}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${row} ${column}`}
                title={`${row} ${column}`}
                // Nulls, not omissions. Choosing an anchor is also how you undo
                // a hand-drag, and clearing the free position is the only thing
                // that puts the caption back under this control — the PATCH is
                // applied with `exclude_unset`, so an explicit null really does
                // clear the column while leaving it out would change nothing.
                onClick={() =>
                  onChange({ position: row, alignment: column, pos_x: null, pos_y: null })
                }
                className={cn(
                  "flex rounded-sm transition-colors",
                  // The dot goes where the caption goes. items-*/justify-* are
                  // the same two axes the anchor itself names, so the cell is
                  // laid out by the value it sets.
                  row === "top" ? "items-start" : row === "middle" ? "items-center" : "items-end",
                  column === "left"
                    ? "justify-start"
                    : column === "center"
                      ? "justify-center"
                      : "justify-end",
                  "p-1",
                  selected ? "bg-primary/15" : "hover:bg-muted"
                )}
              >
                <span
                  className={cn(
                    "h-0.5 rounded-full transition-all",
                    selected ? "w-4 bg-primary" : "w-2.5 bg-muted-foreground/40"
                  )}
                />
              </button>
            );
          })
        )}
      </div>
    </Field>
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
  /** The video's aspect ratio, so the placement map matches the frame. */
  aspect?: number;
}) {
  const { data: style, isLoading } = useCaptionStyle(videoId);
  const { data: options } = useStyleOptions();

  const applyPreset = useApplyPreset(videoId);
  const resetStyle = useResetStyle(videoId);

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
    // No border or fill of its own: this sits inside the rail's glass pane,
    // and a card inside a pane is a box in a box. It has no heading either —
    // the rail tab above it is the heading, and printing "Caption style" under
    // a tab reading "Style" is the same word twice in two type sizes.
    <section>
      <header className="mb-3 flex items-center justify-end">
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
          <AnchorGrid
            position={style.position}
            alignment={style.alignment}
            placed={style.pos_x != null && style.pos_y != null}
            aspect={aspect}
            onChange={set}
          />

          {/* Only while the caption is on an anchor. A hand-placed caption sits
              at an explicit y, so there is no edge for this to be a gap from —
              and libass ignores MarginV outright once `\pos` is in play. A
              slider that moves nothing is worse than no slider. */}
          {style.pos_y == null && (
            <Slider
              label="Edge margin"
              value={style.margin_v}
              min={0}
              // 500, matching the column bound. It was 300, so a margin set by
              // dragging the caption could exceed what this track could show
              // and the thumb sat pinned at the end while the number climbed.
              max={500}
              suffix="px"
              onChange={(margin_v) => set({ margin_v })}
            />
          )}
          {/* This one survives free placement, and is the reason `margin_h` is
              not simply ignored alongside `margin_v`: ASS takes the line-wrap
              width from MarginL/MarginR in both modes. */}
          <Slider
            label={style.pos_x == null ? "Side margin" : "Side margin — line width"}
            value={style.margin_h}
            min={0}
            max={500}
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
