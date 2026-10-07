"use client";

import { Check, ChevronDown, Info, Loader2, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { fontFileUrl, useFontSearch } from "@/hooks/use-fonts";
import { cn } from "@/lib/utils";
import { visibleRange } from "@/lib/windowing";
import type { CatalogueMeta, Font, FontLibraryEntry } from "@/types/style";

interface FontPickerProps {
  /** The nine faces that ship with the app and always work offline. */
  builtins: Font[];
  value: string;
  onChange: (key: string) => void;
}

/**
 * A searchable font picker over the whole Google Fonts catalogue.
 *
 * A `<select>` was fine for nine and is unusable for thirteen hundred: no
 * search, no preview, and a dropdown taller than the screen. This is a search
 * box over a list, and every row is set in its own face so you are choosing a
 * typeface by looking at it rather than by reading its name.
 *
 * That preview is the reason the list is windowed rather than simply rendered.
 * A row draws text in its own family, so a rendered row *downloads a font* —
 * all 1301 at once is several hundred megabytes of requests to show a dropdown.
 * The first version dodged that by asking the server for sixty and printing
 * "1241 more", which reads as a broken picker. Windowing is the honest fix:
 * every family is in the list and scrollable, and only the dozen on screen
 * actually load.
 */

/** Fixed and explicit, because the windowing maths cannot measure what it has
 *  not rendered. Set on the elements themselves so nothing can drift. */
const ROW_H = 34;
const HEADER_H = 26;

type Item =
  | { kind: "header"; id: string; label: string }
  | { kind: "builtin"; id: string; font: Font }
  | { kind: "library"; id: string; font: FontLibraryEntry }
  | { kind: "note"; id: string; label: string };

const heightOf = (item: Item) =>
  item.kind === "header" || item.kind === "note" ? HEADER_H : ROW_H;

export function FontPicker({ builtins, value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(288);

  const { data, isFetching } = useFontSearch(query, open);

  // Close on an outside click or Escape. Pointerdown rather than click, so a
  // press that starts outside and releases inside does not reopen it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const builtinMatches = useMemo(
    () => builtins.filter((f) => f.label.toLowerCase().includes(needle)),
    [builtins, needle]
  );

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];

    if (builtinMatches.length > 0) {
      list.push({
        kind: "header",
        id: "h-builtin",
        label: "Built in — always available offline",
      });
      for (const font of builtinMatches) {
        list.push({ kind: "builtin", id: `b-${font.key}`, font });
      }
    }

    const fonts = data?.fonts ?? [];
    if (fonts.length > 0) {
      list.push({
        kind: "header",
        id: "h-google",
        label: `Google Fonts — ${data?.matched}`,
      });
      for (const font of fonts) {
        list.push({ kind: "library", id: `g-${font.key}`, font });
      }
      // Only reachable if the catalogue ever outgrows the server's own ceiling.
      // Kept rather than deleted: the day that happens, silently dropping
      // families is the failure this line exists to make visible.
      if (data && data.returned < data.matched) {
        list.push({
          kind: "note",
          id: "note-more",
          label: `${data.matched - data.returned} more — keep typing to narrow.`,
        });
      }
    }

    return list;
  }, [builtinMatches, data]);

  const tops = useMemo(() => {
    const offsets = new Array<number>(items.length + 1);
    let y = 0;
    for (let i = 0; i < items.length; i++) {
      offsets[i] = y;
      y += heightOf(items[i]);
    }
    offsets[items.length] = y;
    return offsets;
  }, [items]);

  const total = tops[items.length] ?? 0;

  /**
   * Back to the top, and re-measure.
   *
   * `open` is in here and not only `needle`, which is the bug this had. The
   * scroll container is inside the `{open && …}` branch, so closing the picker
   * destroys the DOM node while `scrollTop` — ordinary component state — keeps
   * whatever it last held. Reopening then paired a fresh element sitting at 0
   * with a state that said 4000, so every row was positioned below the visible
   * window: an empty list under a scrollbar that looked entirely correct.
   *
   * A new query needs the same reset for the ordinary reason — opening on the
   * middle of results nobody has seen the top of is disorienting.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = 0;
    setScrollTop(0);
    setViewport(node.clientHeight);
  }, [open, needle]);

  // Separately from the reset: the viewport is capped by max-height, so it is
  // shorter than that whenever the list is short, and the list changes length
  // as results arrive.
  useLayoutEffect(() => {
    if (open && scroller.current) setViewport(scroller.current.clientHeight);
  }, [open, total]);

  const { start, end } = visibleRange(tops, scrollTop, viewport, items.length);

  const selectedBuiltin = builtins.find((f) => f.key === value);
  const selectedLabel =
    selectedBuiltin?.label ??
    data?.fonts.find((f) => f.key === value)?.family ??
    value;

  function choose(key: string) {
    onChange(key);
    setOpen(false);
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm transition-colors hover:border-muted-foreground/40"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={data ? `Search ${data.total} fonts` : "Search fonts"}
              // The app-wide :focus-visible ring is suppressed here, the same
              // exception the search pill in globals.css makes. This input is
              // autofocused the instant the panel opens, so the ring drew a
              // violet rectangle round the top of the popup every single time
              // — marking as "focused" the only thing in the panel that could
              // possibly have been.
              className="w-full bg-transparent py-2 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/70"
            />
            {isFetching && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={() => setInfo((shown) => !shown)}
              aria-expanded={info}
              title="Where these fonts come from"
              aria-label="Where these fonts come from"
              className={cn(
                "shrink-0 rounded p-1 transition-colors",
                info ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Info className="size-3.5" />
            </button>
          </div>

          {info && data && <InfoPanel meta={data.meta} available={data.total} />}

          {/* No padding on the scroller: `tops` are measured from the top of
              the <ul>, and any padding above it would offset every row from
              the scrollTop the maths is done against. */}
          <div
            ref={scroller}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            className="max-h-72 overflow-y-auto"
          >
            {/* The full height is real, so the scrollbar reports the whole
                catalogue rather than the handful of rows that exist in the DOM. */}
            <ul role="listbox" className="relative" style={{ height: total }}>
              {items.slice(start, end).map((item, offset) => {
                const index = start + offset;
                const position = {
                  position: "absolute" as const,
                  top: tops[index],
                  left: 0,
                  right: 0,
                  height: heightOf(item),
                };

                if (item.kind === "header") {
                  return (
                    <li key={item.id} style={position} className="label-caps flex items-end px-3 pb-1">
                      {item.label}
                    </li>
                  );
                }

                if (item.kind === "note") {
                  return (
                    <li key={item.id} style={position} className="flex items-center px-3 text-xs text-muted-foreground">
                      {item.label}
                    </li>
                  );
                }

                if (item.kind === "builtin") {
                  return (
                    <Row
                      key={item.id}
                      style={position}
                      label={item.font.label}
                      // The built-ins already have a face the browser can use,
                      // so the row previews itself without downloading anything.
                      fontFamily={item.font.css_stack}
                      selected={item.font.key === value}
                      onSelect={() => choose(item.font.key)}
                    />
                  );
                }

                return (
                  <LibraryRow
                    key={item.id}
                    style={position}
                    font={item.font}
                    selected={item.font.key === value}
                    onSelect={() => choose(item.font.key)}
                  />
                );
              })}
            </ul>

            {!isFetching && items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing matches “{query}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Where these fonts come from, and what is missing.
 *
 * Every number is served rather than written here. "Some fonts are
 * unavailable" is not an explanation, and a hardcoded "110 missing" becomes a
 * lie the next time the catalogue is rebuilt — so the generator records what
 * it kept and skipped, and this reads it back.
 */
function InfoPanel({ meta, available }: { meta: CatalogueMeta; available: number }) {
  const missing = meta.google_families - available;

  return (
    <div className="space-y-2 border-b border-border bg-subtle px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
      <p>
        <span className="font-semibold text-foreground">
          {available.toLocaleString()} of Google&rsquo;s {meta.google_families.toLocaleString()}
        </span>{" "}
        families. A face downloads the first time anyone picks it and is cached from
        then on — your browser never talks to Google, the server fetches it.
      </p>
      <p>
        <span className="font-medium text-foreground">
          {meta.instanced.toLocaleString()} are variable-only
        </span>{" "}
        upstream, including Roboto and Inter. Those get pinned to a fixed weight on
        download, so the preview and the burned-in export read the same file rather
        than two different interpretations of one.
      </p>
      <p>
        <span className="font-medium text-foreground">{missing.toLocaleString()} are not here:</span>{" "}
        {meta.skipped_oversized} run past 6MB — mostly CJK families, none of them
        caption faces — and {meta.skipped_unusable} publish no file this can use.
      </p>
      <p>
        The list ships with the app rather than being fetched, so searching works
        offline. Families Google adds later appear after a catalogue rebuild.
      </p>
    </div>
  );
}

function Row({
  label,
  fontFamily,
  selected,
  onSelect,
  style,
}: {
  label: string;
  fontFamily: string;
  selected: boolean;
  onSelect: () => void;
  style: React.CSSProperties;
}) {
  return (
    <li style={style}>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={cn(
          "flex h-full w-full items-center justify-between gap-2 px-3 text-left transition-colors",
          selected ? "bg-primary/10 text-primary" : "hover:bg-muted"
        )}
      >
        {/* 15px rather than inherited: some display faces are tiny at 13px and
            the point of the row is to show you what the font looks like. */}
        <span className="truncate text-[15px] leading-none" style={{ fontFamily }}>
          {label}
        </span>
        {selected && <Check className="size-3.5 shrink-0" />}
      </button>
    </li>
  );
}

/**
 * A catalogue row, which has to load its own face before it can preview itself.
 *
 * The delay is the point. A row mounts when it scrolls into the window, so
 * flicking through the list would otherwise fire a request per family passed —
 * hundreds of downloads to look at a dozen. Waiting until a row has *stayed*
 * on screen means the browser fetches what you are actually reading. Scrolling
 * past cancels it, because the effect's cleanup runs on unmount.
 *
 * The rule is added to the document rather than tracked in React state: a face
 * already downloaded costs nothing to leave declared, and removing it when the
 * row scrolls away would re-request the file on the way back up.
 */
const PREVIEW_DELAY_MS = 120;

function LibraryRow({
  font,
  selected,
  onSelect,
  style,
}: {
  font: FontLibraryEntry;
  selected: boolean;
  onSelect: () => void;
  style: React.CSSProperties;
}) {
  useEffect(() => {
    const id = `font-preview-${font.key}`;
    if (document.getElementById(id)) return;

    const timer = window.setTimeout(() => {
      if (document.getElementById(id)) return;
      const element = document.createElement("style");
      element.id = id;
      element.textContent = `@font-face{font-family:"${font.family}";src:url("${fontFileUrl(font.key)}") format("truetype");font-weight:400;font-style:normal;font-display:swap}`;
      document.head.append(element);
    }, PREVIEW_DELAY_MS);

    return () => clearTimeout(timer);
  }, [font.key, font.family]);

  return (
    <Row
      style={style}
      label={font.family}
      fontFamily={font.css_stack}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
