"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";

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
import type { Alignment, CaptionStyle, LineStyle } from "@/types/style";

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
/** Max lines: 1-3 for Balanced and Auto, 1-6 for Stacked (the API allows 6). */
const LINE_LIMITS = [1, 2, 3] as const;
const STACKED_LINE_LIMITS = [1, 2, 3, 4, 5, 6] as const;
const STACKED_DEFAULT_LINES = 4;
const WORDS_PER_LINE = [1, 2, 3, 4] as const;
/** In the order they are offered; each with the sentence that says what it does. */
const LINE_STYLES = [
  { key: "balanced", label: "Balanced", description: "Wraps at the box width, with the lines evened out." },
  { key: "auto", label: "Auto", description: "Fills each line to the box width before starting the next." },
  { key: "stacked", label: "Stacked", description: "A set number of words on each line, whatever the width." },
] as const satisfies readonly { key: LineStyle; label: string; description: string }[];

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

/** A group of rows under a small grey heading (System Settings style). */
function Group({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section>
      <h3 className="label-caps mb-1.5 px-4">{title}</h3>
      <div className="group-inset">{children}</div>
      {note && <p className="mt-1.5 px-4 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

/** One row: the label on the left, its control on the right. */
function Row({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="group-row">
      <label htmlFor={htmlFor} className="shrink-0 text-[15px] sm:text-sm">
        {label}
      </label>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

/** The editor's tools that style the captions; the inspector picks one. */
export type StyleTab = "typography" | "appearance" | "position";

/** A row of on/off toggles — bold, italic, underline and the rest. */
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
    <div className="flex w-full rounded-md bg-surface-3 p-0.5">
      {options.map(({ key, label, className }) => (
        <button
          key={key}
          type="button"
          onClick={() => onToggle(key)}
          aria-pressed={isOn(key)}
          className={cn(
            "min-h-11 flex-1 rounded-[6px] px-2 text-sm text-foreground transition-colors duration-200 ease-out sm:min-h-7",
            className,
            isOn(key) ? "bg-segment font-semibold" : "hover:bg-background/40"
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
  const id = useId();

  // The row shows the label and the value apart; the input's own name keeps
  // them together ("Size — 52px"), as it always read.
  return (
    <div className={cn("group-row flex-col items-stretch gap-1.5", disabled && "opacity-40")}>
      <div className="flex items-center justify-between text-[15px] sm:text-sm">
        <label htmlFor={id} aria-hidden="true">
          {label}
        </label>
        <span className="tabular-nums text-muted-foreground" aria-hidden="true">
          {shown}
          {suffix}
        </span>
      </div>
      <Range
        id={id}
        aria-label={`${label} — ${shown}${suffix ?? ""}`}
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
    </div>
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
  const id = useId();
  return (
    <div className={cn(disabled && "opacity-40")}>
      <Row label={label} htmlFor={id}>
        <span className="mr-2.5 text-sm uppercase tabular-nums text-muted-foreground">{value}</span>
        <input
          id={id}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-7 w-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5 disabled:cursor-not-allowed"
        />
      </Row>
    </div>
  );
}

/**
 * A row of mutually exclusive choices — alignment, line limit, placement —
 * as a segmented control under its label.
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
  /** A `description` is shown under the row and read out with its option. */
  options: readonly { key: T; label: string; description?: string }[];
  selected: T | null;
  onSelect: (key: T) => void;
}) {
  const id = useId();
  const chosen = options.find((o) => o.key === selected);
  return (
    <div className="group-row flex-col items-stretch gap-2">
      <span className="text-[15px] sm:text-sm">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-md bg-surface-3 p-0.5">
        {options.map(({ key, label: text, description }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected === key}
            aria-describedby={description ? `${id}-${key}` : undefined}
            onClick={() => onSelect(key)}
            className={cn(
              "min-h-11 flex-1 rounded-[6px] px-2 text-sm text-foreground transition-colors duration-200 ease-out sm:min-h-7",
              selected === key ? "bg-segment font-medium" : "hover:bg-background/40"
            )}
          >
            {text}
          </button>
        ))}
      </div>
      {/* Each option's sentence, for its aria-describedby; the chosen one is
          the one shown. */}
      {options.map(({ key, description }) =>
        description ? (
          <p
            key={key}
            id={`${id}-${key}`}
            className={cn("text-xs text-muted-foreground", chosen?.key !== key && "sr-only")}
          >
            {description}
          </p>
        ) : null
      )}
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
 *
 * `tab` is chosen by the editor's inspector (v1.1.0); all three stay mounted
 * and are only hidden, so a colour picker mid-edit or a scrolled font list
 * survives a look at another tab.
 */
export function StylePanel({
  videoId,
  update,
  isSaving,
  tab,
  aspect = 16 / 9,
}: {
  videoId: number;
  update: (patch: Partial<CaptionStyle>) => void;
  isSaving: boolean;
  tab: StyleTab;
  /** The video's aspect ratio, for the default width of its shape. */
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
          <div key={i} className="h-11 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
    );
  }

  const set = (patch: Partial<CaptionStyle>) => update(patch);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-1.5 flex items-center justify-between px-4">
          <h3 className="label-caps">Preset</h3>
          <div className="flex items-center gap-2">
            {isSaving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
            <button
              type="button"
              onClick={() => resetStyle.mutate("")}
              title="Back to defaults"
              className="rounded-md px-1.5 py-0.5 text-sm text-primary transition-colors duration-200 ease-out hover:bg-surface-2"
            >
              Reset
            </button>
          </div>
        </div>
        <div className="flex rounded-md bg-surface-3 p-0.5">
          {(options?.presets ?? []).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset.mutate(preset)}
              className="min-h-11 flex-1 rounded-[6px] px-2 text-sm text-foreground transition-colors duration-200 ease-out hover:bg-segment sm:min-h-7"
            >
              {PRESET_LABELS[preset] ?? preset}
            </button>
          ))}
        </div>
      </section>

      <div className={cn(tab === "typography" ? "space-y-6" : "hidden")}>
        <Group title="Text">
          <div className="group-row flex-col items-stretch gap-2">
            <span className="text-[15px] sm:text-sm">Font</span>
            <FontPicker
              builtins={options?.fonts ?? []}
              value={style.font_key}
              onChange={(font_key) => set({ font_key })}
            />
          </div>
          <Slider
            label="Size"
            value={style.font_size}
            min={12}
            max={200}
            suffix="px"
            onChange={(font_size) => set({ font_size })}
          />
          <div className="group-row">
            <Toggles
              options={EMPHASIS}
              isOn={(key) => style[key]}
              onToggle={(key) => set({ [key]: !style[key] } as Partial<CaptionStyle>)}
            />
          </div>
          <Slider
            label="Letter spacing"
            value={style.letter_spacing}
            min={-10}
            max={50}
            suffix="px"
            onChange={(letter_spacing) => set({ letter_spacing })}
          />
        </Group>
      </div>

      <div className={cn(tab === "appearance" ? "space-y-6" : "hidden")}>
        <Group title="Text">
          <Swatch label="Colour" value={style.text_color} onChange={(text_color) => set({ text_color })} />
        </Group>

        {/* Every control here stays mounted. They used to appear and vanish
            with the values they depend on — the outline colour only while
            there is an outline and no box, and so on — and the controls after
            them moved under a gesture: dragging Opacity off 0 removed the
            colour swatches above it, the slider jumped away from the pointer
            still dragging it, and the thumb flickered. Disabled instead, so
            the layout never changes under a gesture. */}
        <Group title="Outline and shadow">
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
        </Group>

        {/* An opaque box replaces both the outline and the shadow in ASS,
            so saying so beats leaving two controls that do nothing. Always
            present, for the same reason as the controls above; it is what
            explains why some of them are greyed out. */}
        <Group
          title="Box"
          note={
            style.box_opacity > 0
              ? "A box replaces the outline and shadow — that's how it renders on export."
              : "Raise Opacity to put a box behind the caption."
          }
        >
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
        </Group>
      </div>

      <div className={cn(tab === "position" ? "space-y-6" : "hidden")}>
        <Group title="Position">
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
        </Group>

        <Group
          title="Lines"
          note={
            <>
              A caption that needs more lines is drawn smaller, down to 70% of the size, then gets more
              lines; one that would still be taller than the frame keeps shrinking until it fits.
              Shift+Enter in a caption&rsquo;s text starts a new line there. Drag the caption to move it, or
              the edges of its box to change the width.
            </>
          }
        >
          {/* How a caption is split into lines. Switching to Stacked starts it
              at four lines; leaving it brings a limit above three back to the
              default, since Balanced and Auto offer one to three. */}
          <Choice
            label="Line style"
            options={LINE_STYLES}
            selected={style.line_style ?? "balanced"}
            onSelect={(line_style) =>
              set(
                line_style === "stacked"
                  ? { line_style, max_lines: STACKED_DEFAULT_LINES }
                  : { line_style, ...(style.max_lines > 3 ? { max_lines: 2 } : {}) }
              )
            }
          />
          <Choice
            label="Max lines"
            options={(style.line_style === "stacked" ? STACKED_LINE_LIMITS : LINE_LIMITS).map((n) => ({
              key: n,
              label: String(n),
            }))}
            selected={style.max_lines}
            onSelect={(max_lines) => set({ max_lines })}
          />
          {style.line_style === "stacked" && (
            <Choice
              label="Words per line"
              options={WORDS_PER_LINE.map((n) => ({ key: n, label: String(n) }))}
              selected={style.words_per_line}
              onSelect={(words_per_line) => set({ words_per_line })}
            />
          )}
        </Group>
      </div>

      <p className="px-4 text-xs text-muted-foreground">
        Sizes are for a {style.reference_height}p frame and scale with the video, so one style looks the
        same on a 360p clip and a 4K one.
      </p>
    </div>
  );
}
