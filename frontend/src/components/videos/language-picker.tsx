"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { LanguageOption } from "@/types/video";

/**
 * Lower-cased and stripped of accents, so "francais" finds Français and
 * "espanol" finds Español. Scripts without accents (বাংলা, Русский) are left
 * as they are and still match on their own letters.
 */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Whether `option` matches what was typed: native name, English name or code. */
export function matchesLanguage(option: LanguageOption, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [option.native ?? "", option.label, option.code].some((name) => fold(name).includes(q));
}

/**
 * Pick a language from a list long enough to need searching.
 *
 * A native `<select>` is the house default (docs/DESIGN_SYSTEM.md), and it was
 * fine for five languages. At fourteen it is a scroll, and its type-ahead only
 * matches the start of one label — nobody looking for বাংলা types "Bengali"
 * into it and gets there. So this is the font picker's pattern instead: a
 * button that opens a search box over a listbox, following the ARIA combobox
 * pattern so the keyboard and screen readers get what a select would give
 * them. Each option shows the language in its own name first, then in English.
 */
export function LanguagePicker({
  options,
  value,
  onChange,
  label,
  disabled = false,
  className,
}: {
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
  /** The accessible name of the control, e.g. "Caption language". */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-list`;

  const matches = useMemo(
    () => options.filter((option) => matchesLanguage(option, query)),
    [options, query]
  );
  const selected = options.find((option) => option.code === value);

  // Opening starts from the current choice, with an empty search.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((option) => option.code === value)));
    search.current?.focus();
  }, [open, options, value]);

  // A click anywhere else closes it, as a select would.
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function choose(code: string) {
    onChange(code);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => Math.min(matches.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(matches.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        if (matches[active]) choose(matches[active].code);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const optionId = (code: string) => `${id}-option-${code}`;

  return (
    <div ref={container} className={cn("relative", className)}>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected ? (selected.native ?? selected.label) : "none"}`}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm",
          "transition-colors hover:border-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <span className="min-w-0 truncate">
          {selected ? (
            <>
              <span lang={selected.native ? selected.code : undefined}>
                {selected.native ?? selected.label}
              </span>
              {selected.native && selected.native !== selected.label && (
                <span className="ml-1.5 text-muted-foreground">{selected.label}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Choose…</span>
          )}
        </span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-full min-w-[15rem] overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-2">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={search}
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}s`}
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={matches[active] ? optionId(matches[active].code) : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={`Search ${options.length} languages`}
              className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
            {matches.map((option, index) => {
              const isSelected = option.code === value;
              return (
                <li
                  key={option.code}
                  id={optionId(option.code)}
                  role="option"
                  aria-selected={isSelected}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.code)}
                  onPointerEnter={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm",
                    index === active ? "bg-muted" : undefined,
                    isSelected && "text-primary"
                  )}
                >
                  <span className="min-w-0 truncate">
                    <span lang={option.native ? option.code : undefined}>
                      {option.native ?? option.label}
                    </span>
                    {option.native && option.native !== option.label && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{option.label}</span>
                    )}
                  </span>
                  {isSelected && <Check aria-hidden="true" className="size-3.5 shrink-0" />}
                </li>
              );
            })}
            {matches.length === 0 && (
              <li role="presentation" className="px-3 py-4 text-center text-xs text-muted-foreground">
                No language matches “{query}”.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
