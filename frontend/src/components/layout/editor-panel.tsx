"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One work surface in the editor, with a head that says what it is for.
 *
 * The editor used to be three unlabelled panes of glass around a video. Every
 * control in them was legible on its own and the *screen* was not: nothing said
 * which region did what, so learning the app meant clicking things to find out.
 *
 * So each panel states its name and, underneath, what you do with it — one line,
 * in the imperative. That line is the whole point of this component; a heading
 * alone ("Style") names a region without explaining it, and a region a user
 * cannot explain is a region they do not open.
 *
 * The head is sticky and the body scrolls under it, so the label survives a
 * long transcript or a long list of fonts.
 */
export function EditorPanel({
  icon: Icon,
  title,
  hint,
  action,
  children,
  className,
  bodyClassName,
}: {
  icon: LucideIcon;
  title: string;
  /** What this panel is for, in one line. Shown under the title. */
  hint: string;
  /** Status or a control belonging to the panel as a whole. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("glass-panel flex min-h-0 flex-col overflow-hidden", className)}>
      <header className="glass-panel-head flex shrink-0 items-start gap-2.5 px-3.5 py-2.5">
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Icon className="size-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold leading-tight">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
        </div>

        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </header>

      <div className={cn("min-h-0 flex-1 overflow-y-auto p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export interface RailTab {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The rail's two tools, as tabs rather than one long scroll.
 *
 * Style and Export were stacked in a single scrolling column, which had two
 * costs. Reaching Export meant scrolling past every style control, and — worse
 * — the two read as one undifferentiated list of settings, so "where do I get
 * my video out" had no answer you could see. Two tabs make the choice visible
 * and halve the scrolling in the panel you are actually using.
 *
 * Radio semantics rather than buttons: this is one setting with two values, and
 * arrow keys move between them for free.
 */
export function RailTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: RailTab[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Editor tools" className="rail-tabs flex gap-1 rounded-xl p-1">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              "rail-tab flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5",
              "text-[12px] font-medium transition-colors",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
