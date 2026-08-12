"use client";

import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fontFileUrl, useFontSearch } from "@/hooks/use-fonts";
import { cn } from "@/lib/utils";
import type { Font, FontLibraryEntry } from "@/types/style";

interface FontPickerProps {
  /** The nine faces that ship with the app and always work offline. */
  builtins: Font[];
  value: string;
  onChange: (key: string) => void;
}

/**
 * A searchable font picker over 1301 families.
 *
 * A `<select>` was fine for nine and is unusable for thirteen hundred: no
 * search, no preview, and a dropdown taller than the screen. This is a search
 * box over a list, and every row is set in its own face so you are choosing a
 * typeface by looking at it rather than by reading its name.
 *
 * Previewing a row downloads that font, which is the one real cost here. It is
 * bounded by only rendering the sixty the server returns, and each file is
 * cached by the backend forever after the first request from anyone.
 */
export function FontPicker({ builtins, value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef<HTMLDivElement>(null);

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

  const builtinMatches = builtins.filter((f) =>
    f.label.toLowerCase().includes(query.trim().toLowerCase())
  );
  const selectedBuiltin = builtins.find((f) => f.key === value);
  const selectedLabel =
    selectedBuiltin?.label ??
    data?.fonts.find((f) => f.key === value)?.family ??
    value;

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
          </div>

          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {builtinMatches.length > 0 && (
              <Section label="Built in — always available offline">
                {builtinMatches.map((font) => (
                  <Row
                    key={font.key}
                    selected={font.key === value}
                    label={font.label}
                    // The built-ins already have a face the browser can use, so
                    // the row previews itself without downloading anything.
                    fontFamily={font.css_stack}
                    onSelect={() => {
                      onChange(font.key);
                      setOpen(false);
                    }}
                  />
                ))}
              </Section>
            )}

            {data && data.fonts.length > 0 && (
              <Section
                // The count has to describe *this list*, not the catalogue.
                // It used to always print the 1301 total, so searching "lob"
                // showed two rows under the heading "1301 families" — which
                // reads as a broken picker rather than a precise search.
                label={
                  data.returned < data.matched
                    ? `Google Fonts — first ${data.returned} of ${data.matched}`
                    : `Google Fonts — ${data.matched}`
                }
              >
                {data.fonts.map((font) => (
                  <LibraryRow
                    key={font.key}
                    font={font}
                    selected={font.key === value}
                    onSelect={() => {
                      onChange(font.key);
                      setOpen(false);
                    }}
                  />
                ))}
                {data.returned < data.matched && (
                  <li className="px-3 pb-2 pt-1.5 text-xs text-muted-foreground">
                    {data.matched - data.returned} more — keep typing to narrow.
                  </li>
                )}
              </Section>
            )}

            {!isFetching && builtinMatches.length === 0 && (data?.fonts.length ?? 0) === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing matches “{query}”.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <li className="label-caps px-3 pb-1 pt-2">{label}</li>
      {children}
    </>
  );
}

function Row({
  label,
  fontFamily,
  selected,
  onSelect,
}: {
  label: string;
  fontFamily: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors",
          selected ? "bg-primary/10 text-primary" : "hover:bg-muted"
        )}
      >
        {/* 15px rather than inherited: some display faces are tiny at 13px and
            the point of the row is to show you what the font looks like. */}
        <span className="truncate text-[15px]" style={{ fontFamily }}>
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
 * The `@font-face` is added here rather than through the shared hook because a
 * row is transient — it exists while a search matches it. Writing one rule per
 * visible row and letting the browser deduplicate by URL is simpler than
 * tracking which of sixty rows still needs one.
 */
function LibraryRow({
  font,
  selected,
  onSelect,
}: {
  font: FontLibraryEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  useEffect(() => {
    const id = `font-preview-${font.key}`;
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `@font-face{font-family:"${font.family}";src:url("${fontFileUrl(font.key)}") format("truetype");font-weight:400;font-style:normal;font-display:swap}`;
    document.head.append(style);
  }, [font.key, font.family]);

  return (
    <Row
      label={font.family}
      fontFamily={font.css_stack}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
