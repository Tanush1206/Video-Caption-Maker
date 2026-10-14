# Design system

The UI's visual language as of v1.0.4. Values are taken from
`frontend/tailwind.config.ts`, `frontend/src/app/globals.css` and
`frontend/src/components/ui/*`. When these docs and those files disagree, the
files win: fix the doc.

## 1. Direction

From the v1.0.4 redesign (PROGRESS.md, "v1.0.4 redesign log"):

- **Source:** the Stitch design in `design/stitch/` stays **private**
  (gitignored, never committed), including its DESIGN.md. **This document is
  the public source of truth** for the design; everything it says is taken
  from the code. When the private design was used (v1.0.4), only the folders
  listed in PROGRESS.md counted, and where a `screen.png` and its `code.html`
  disagreed, `code.html` won.
- **Look:** a cold slate base, **one indigo accent**, and emerald only for
  "local engine healthy". It is a dense tool UI: the 8 px radius everywhere,
  fixed-px type, and tonal elevation.
- **Restyle, never re-logic.** The redesign changed no behaviour, and **no
  mock data**: every figure on screen comes from the API. Design elements
  with no data behind them were left out rather than faked: app version
  chip, live transcript, cancel, memory figures, cache clearing,
  inference-speed tiles, term highlighting.
- **Two themes**, light and dark, chosen by a `.dark` class on `<html>`, and
  **three choices** in Settings → Interface theme: Light, Dark and **System**
  (the default, added in v1.0.5):
  - Light or Dark is stored in `localStorage["vcm-theme"]`;
  - System stores **nothing**, so the OS preference applies, and the theme
    follows an OS change live (`ThemeProvider` listens to
    `prefers-color-scheme`);
  - an inline script in `app/layout.tsx` applies the stored choice, or the OS
    preference, before first paint, so the wrong theme never flashes;
  - the header's theme button flips to an explicit Light or Dark.
- **Contrast beats the source palette.** Where DESIGN.md's colours fail WCAG
  AA, the tokens are adjusted (§2), and axe-core must stay at 0 violations.

## 2. Colour tokens

Tokens are **bare HSL channels** (`243 75% 59%`), and Tailwind wraps them as
`hsl(var(--x) / <alpha-value>)`. This is what makes opacity modifiers like
`bg-primary/10` work.

**Never** store a full `hsl(...)` string in a token: every `/alpha` utility
would silently emit nothing.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--background` | `210 40% 98%` | `230 25% 5%` (#090a0f) | page |
| `--foreground` | `222 47% 11%` | `210 40% 98%` (#f8fafc) | body text |
| `--card` / `--card-foreground` | `0 0% 100%` / `222 47% 11%` | `225 22% 11%` (#151821) / `210 40% 98%` | raised surfaces |
| `--surface-1` | `0 0% 100%` | `227 24% 7%` (#0e1017) | elevation 1 |
| `--surface-2` | `210 40% 96%` | `225 22% 14%` (#1c202c) | elevation 2 (secondary buttons, hovers) |
| `--surface-3` | `214 32% 91%` | `225 21% 18%` (#252a39) | elevation 3 (active nav item) |
| `--subtle` | `210 40% 96%` | `220 23% 3%` (#050608) | wells and inset areas (darker than the page in dark) |
| `--muted` | `210 40% 96%` | `225 22% 14%` | muted fills |
| `--muted-foreground` | `215 19% 35%` (slate-600) | `215 20% 65%` (#94a3b8) | secondary text |
| `--primary` | `243 75% 59%` (#4F46E5) | `239 83% 65%` (#5b5ef0) | **fills**: primary buttons, active step |
| `--primary-foreground` | `0 0% 100%` | `0 0% 100%` | text on primary |
| `--primary-text` | `243 75% 59%` | `234 89% 74%` (#818cf8) | **indigo text** (`text-primary`) |
| `--primary-muted` | `226 100% 97%` | `235 33% 19%` | tinted primary backgrounds |
| `--accent` | `243 75% 59%` | `239 84% 67%` (#6366f1) | progress fills (`.bar-fill`) |
| `--success` | `163 94% 24%` (#047857) | `160 84% 39%` (#10b981) | done states, local-engine health |
| `--warning` | `26 90% 37%` (#b45309) | `38 92% 50%` (#f59e0b) | notices |
| `--destructive` / `-foreground` | `345 83% 41%` (#be123c, rose-700) / white | `0 91% 71%` (#f87171) / `228 17% 6%` | delete, errors, failed badges |
| `--border` | `214 32% 91%` | `227 21% 17%` (#222634) | hairlines |
| `--input` | `213 27% 84%` | `226 19% 27%` (#373d51) | input borders |
| `--ring` | `239 84% 67%` | `239 84% 67%` | focus ring |

**Deliberate departures from DESIGN.md**, all for AA (comment in
`globals.css`):
- White on DESIGN.md's `#6366F1` is only 4.47:1, so filled buttons use
  `#5B5EF0` (dark) and `#4F46E5` (light).
- `#6366F1` as text on the dark card is 3.97:1, so indigo **text** in dark
  uses `#818CF8` through `--primary-text`.
- Light muted text is slate-600, not slate-500, because 500 falls under 4.5:1
  on `surface-2`.
- Light success and warning are emerald-700 (5.5:1) and amber-700 (5:1).
- Light destructive is rose-700 (v1.0.5). Rose-600 was 3.82:1 on its own 10 %
  tint, so the "Failed" badge failed AA. Now 5.1–5.3:1 on the tint and 6.3:1
  under white text.

**`text-primary` ≠ `bg-primary`.** `tailwind.config.ts` defines `textColor` as
a function over the whole palette, so `text-primary` reads `--primary-text`
while `bg-primary` reads `--primary`. Use `text-primary` for indigo text and
links, and `bg-primary` for fills.

**Rules:**
- **Never** hard-code a colour (`#…`, `text-indigo-500`) in a component. Use a
  token utility.
- **In dark, elevation is lightness, not shadow.** To lift a surface, step up
  `surface-1 → card → surface-2 → surface-3`.
- **Emerald (`success`) is for "done" and "local engine OK" only.** Never use
  it as a second accent.
- **Caption colours are user data**, not theme tokens. They are stored as
  `#RRGGBB` on `caption_styles`, and the video frame stays neutral in both
  themes.

## 3. Typography

| Role | Font | Loaded by |
|---|---|---|
| UI (`font-sans`, `--font-sans`) | **Geist** variable (100–900), OFL | `next/font/local` from `src/app/fonts/Geist-Variable.woff2` |
| Numbers and timecodes (`font-mono`, `--font-mono`) | **JetBrains Mono** | `next/font/google`, self-hosted at build time |
| Caption faces | Poppins, Lato, Barlow Condensed, Anton, Bebas Neue (+ system Liberation/DejaVu, + Google Fonts on demand) | `@font-face` from `public/fonts/` |

- **Geist must not go in `public/fonts/`.** That folder holds the *caption*
  fonts and is copied into the backend image for burn-in.
- **Adding a caption face** takes two edits that must agree: the `.ttf`
  (+ licence) in `frontend/public/fonts/` with an `@font-face` in
  `globals.css`, and the `FONTS` entry in
  `backend/app/services/caption_style.py`.
  - Single-weight display faces are declared at weight 400 only, so the
    browser and libass both synthesise bold the same way.

**Type scale** (`theme.extend.fontSize`). These are **fixed px, not rem**, on
purpose: a dense tool's 11 px label must stay 11 px.

| Class | Size / line height | Tracking | Weight |
|---|---|---|---|
| `text-h1` | 24 / 32 px | −0.02em | 600 |
| `text-h2` | 20 / 28 px | −0.01em | 600 |
| `text-body-md` | 14 / 20 px | | |
| `text-body-sm` | 12 / 16 px | | |
| `text-label-caps` | 11 / 16 px | 0.05em | 700 |
| `text-mono-data` | 13 / 16 px | | 500 |
| `text-mono-data-sm` | 11 / 14 px | | |

- `.label-caps` (in `globals.css`) is the recurring 11 px uppercase label.
- `.tabular-nums` must be used on any number that changes in place
  (timecodes, progress, counters), so the digits don't shift.
- **`cn()` knows these sizes.** `src/lib/utils.ts` registers them with
  `extendTailwindMerge`. Without that, tailwind-merge reads `text-body-md` as
  a colour and drops `text-primary-foreground`. That was a real bug: primary
  buttons got dark labels. **Any new `fontSize` key must be added there too.**
- Headings `h1–h3` get `tracking-tight` globally.

## 4. Spacing, radius, shadows

- **Spacing:** Tailwind's default 4 px scale. The one named token is
  `spacing.header = 56px` (the top bar), which layouts subtract in `calc()`.
- **Container:** centred, `2rem` padding, max `1400px` at `2xl`.
- **Radius:** `--radius: 0.5rem` (8 px) is the one radius for buttons, inputs,
  rows and panels.

| Class | Value |
|---|---|
| `rounded-sm` | 4 px (`--radius / 2`): micro elements (kbd, status chips) |
| `rounded-md`, `rounded-lg` | 8 px (`--radius`) |
| `rounded-xl` | 10 px |
| `rounded-full` | dots, the scrub thumb, badges |

- **Shadows** are named by intent and defined per theme. In dark they are
  nearly invisible, by design.

| Class | Token | Use |
|---|---|---|
| `shadow-sm` | `--shadow-sm` | buttons, cards at rest |
| `shadow-card` | `--shadow-md` | hovered or raised cards |
| `shadow-overlay` | `--shadow-lg` | dialogs, dropdowns |

## 5. Icons

- **lucide-react** only (`lucide-react@^0.408.0`), imported per icon:
  `import { Search } from "lucide-react"`.
- Inside a `Button`, icons are sized by the button (`[&_svg]:size-4`;
  `size="icon-sm"` → `size-3.5`) and never shrink. Elsewhere, set `size-*`
  explicitly (usually `size-4` or `size-5`).
- Decorative icons get `aria-hidden="true"`. An icon-only button **must**
  have an `aria-label` (for example the dialog's close button,
  `aria-label="Close"`).

## 6. Components

All primitives live in `frontend/src/components/ui/`. **Use them; don't
hand-roll** a button, input or card with raw classes.

### Button (`button.tsx`, styles in `button-variants.ts`)

`buttonVariants` is in its own module with **no `"use client"`**, so server
components can style links as buttons:
`<Link className={buttonVariants({ variant: "secondary" })}>`.

**Never** import `buttonVariants` from `button.tsx`. A `"use client"` module
exports client references, not functions, and prerendering fails with
`TypeError: (0, o.d) is not a function`. That error shows up only in
`next build`, never in `next dev`.

| Variant | Look | Use |
|---|---|---|
| `primary` (default) | indigo fill, white text, `hover:bg-primary/90` | the one main action per view |
| `secondary` | `surface-2` + border, `hover:surface-3` | other actions |
| `ghost` | text only, `hover:bg-muted` | toolbar and inline actions |
| `destructive` | red fill | the **confirm** step of a destructive action |
| `danger` | red outline, quiet | the **way into** a destructive flow |
| `link` | indigo text, underline on hover | inline navigation |

| Size | Box |
|---|---|
| `sm` | h-8, px-3, `text-body-sm` |
| `md` (default) | h-9, px-4, `text-body-md` |
| `lg` | h-11, px-6 |
| `icon` | 36×36 (the minimum touch target) |
| `icon-sm` | 32×32 |

**States:**
- `disabled`: 50 % opacity, `pointer-events: none`.
- `loading`: shows a spinner, sets `disabled` and `aria-busy`.
- `:focus-visible`: the global ring (§8).

### Inputs

- `inputClasses` (`field.tsx`):
  - h-9, `rounded-md`, `border-input`, `bg-background`, `text-sm`;
  - the placeholder is `muted-foreground/70`;
  - hover strengthens the border; disabled is 50 % opacity with a
    not-allowed cursor.
- `Field`:
  - a label, an input, and a hint **or** an error;
  - the error sets `aria-invalid`, a red border and `role="alert"`;
  - the message is linked through `aria-describedby`.
- `Select` (`select.tsx`): a **native** `<select>` in the input skin
  (`size` `sm`/`md`), with a chevron icon and an optional label and hint.
  Native on purpose: it's keyboard- and screen-reader-complete, and opens the
  system picker on phones.
- `Range` (`range.tsx` + `range.module.css`): a themed range input. The fill
  is passed as `--fill` (0–1), clamped.

### Card (`card.tsx`)

- `Card`: `rounded-lg border bg-card shadow-sm`.
  - `interactive` adds a lift on hover and focus-within (`-translate-y-0.5`,
    `bg-surface-2`, `shadow-card`).
- `CardHeader` (`p-4 sm:p-5`), `CardTitle` (`text-sm font-semibold`),
  `CardDescription` (muted), `CardContent` (no top padding).

### Badge (`badge.tsx`)

- A pill (`rounded-full px-2 py-0.5 text-xs font-medium`).
- **Tinted background + solid text**: `tone` is `neutral` (default),
  `primary`, `success`, `warning` or `destructive`, each `bg-<tone>/10
  text-<tone>`.
- `dot` adds a `currentColor` dot; `pulse` animates it (for live states).

### Stepper (`flow/stepper.tsx`)

- Upload → Language → Export (`FLOW_STEPS`), with `current` from 1 to 4
  (4 = all done).
- An ordered list with `aria-label="Progress"`, and
  `aria-current="step"` on the active step.

| State | Marker | Label |
|---|---|---|
| done | `bg-success/15 text-success` + check icon, "(done)" for screen readers | muted |
| active | `bg-primary text-primary-foreground` + number | `font-semibold text-foreground` |
| ahead | `border bg-surface-2` + number | muted |

The connectors are `bg-success/60` up to the active step and `bg-border`
after it.

### Dialog (`dialog.tsx`)

- The **native `<dialog>` with `showModal()`**. That gives the focus trap,
  Escape, the inert background and the top layer for free; don't rebuild
  them.
- The parent owns `open`. Escape and backdrop clicks report through
  `onClose`.
- Layout: a header (optional icon tile, title as `h2#dialog-title`, optional
  description, close button), a scrolling body, and an optional sticky
  footer.
- `bodyClassName` replaces the body's padding and scrolling, for content that
  scrolls itself (the Export dialog).
- Max `max-w-4xl`, `calc(100vw-2rem)` wide; `shadow-overlay`; the backdrop is
  `black/60` + blur.

### Other shared pieces

| Component | Purpose |
|---|---|
| `Skeleton` (`ui/skeleton.tsx`) | a loading placeholder shaped like the content, with a **shimmer sweep** (not a pulse); `aria-hidden` |
| `layout/engine-chip.tsx` (`EngineChip`, `HostChip`) | worker hardware and host readout in the header |
| `layout/dashboard-header.tsx` | segmented nav (md+), `MobileTabBar` (below md, bottom-fixed, hidden in the editor) |
| `layout/app-footer.tsx`, `layout/brand.tsx` | shell |
| `.glass-surface`, `.glass-panel`, `.rail-tabs` (`globals.css`) | the glass treatment (auth screens and editor panels), with a fallback for engines without `backdrop-filter` |
| `.bar-fill` | solid accent progress fill |

## 7. Empty, loading and error states

Every screen has all three (PROGRESS.md U7). Errors are sentences, never raw
dumps.

| State | Component | Behaviour |
|---|---|---|
| **First run** (no videos at all) | `FirstRun` in `videos/video-library.tsx` | the three steps instead of an empty grid |
| **Filtered empty** | `video-library.tsx` | "No videos are in this state right now." Kept separate from first run: "no videos" invites an upload, "none match" doesn't |
| **Loading** | `Skeleton` in the library, stats strip, editor, export panel, settings | content-shaped placeholders; previous page kept while paging (`keepPreviousData`) |
| **Processing** | `flow/video-status.tsx` | `role="status" aria-live="polite"`; the stage list (done/active/queued), % and ETA, plus a one-time model-download card only for a real download |
| **Failed job** | `video-status.tsx` `Failed` | `role="alert"`, the worker's sentence, **Try again**, **Retry with small model** (secondary; only when the model in use isn't `small`; a note says it changes the setting for every video) and **Open Settings** |
| **Notices** on finished jobs | `videos.notice` | shown on the video page (fallbacks, low confidence) |
| **Server unreachable / starting** | `layout/server-unavailable.tsx` | "Can't reach the app yet", retries every 3 s, **Try now**, points at `vcm start` |
| **Render error in a page** | `(dashboard)/error.tsx` | "Something went wrong", digest reference, **Try again** / **Back to your videos** |
| **`notFound()` in the dashboard** | `(dashboard)/not-found.tsx` | "Page not found" + back link |
| **Unknown URL outside it** | `app/not-found.tsx` (v1.0.5) | status 404, the wordmark, "Error 404 · Page not found", **Back to your videos** |
| **API errors** | `lib/api.ts` `extractError` | the server's `detail`; for 5xx (except 507) a fixed sentence |

## 8. Breakpoints and layout

Tailwind defaults: `sm` 640 px, `md` 768 px, `lg` 1024 px, `xl` 1280 px,
`2xl` 1536 px.

- **Design targets: 375 px (phone) and 1440 px (desktop).** Every screen was
  checked at both, in both themes.
- **Below `md`:**
  - navigation moves to `MobileTabBar`, a 3-column bottom bar that respects
    `safe-area-inset-bottom`, and the layout pads for it;
  - the editor has its own bottom bar instead.
- **`lg`:** the host chip appears in the header; the editor is two columns,
  with the transcript pinned right.
- **`sm`:** the engine chip appears.
- **Never** allow horizontal page scroll at 375 px. The editor once overflowed
  by 124 px and was fixed (PROGRESS.md U5).

## 9. Accessibility rules

Target: **WCAG 2 A/AA, 0 axe-core violations** on dashboard, editor, settings
and search, in both themes (PROGRESS.md U6, re-checked for v1.0.4).

- **Focus:** one global treatment, `:focus-visible { ring-2 ring-ring/60
  ring-offset-2 }`. Keyboard focus is always visible; mouse clicks leave no
  ring. Every keyboard stop must show it. **Never** remove it per component.
- **Contrast:** text must be at least 4.5:1, or 3:1 for large text and UI
  boundaries. Re-run axe after any token change.
- **Inline links are underlined.** Colour alone isn't enough (an axe fix in
  v1.0.4).
- **Labels:** every input has a visible `<label>`, or an `aria-label` when
  something else labels it. A placeholder is not a label.
- **Errors** use `role="alert"` and `aria-describedby`. Live progress uses
  `role="status"`/`aria-live="polite"`; progress bars have
  `role="progressbar"`.
- **Structure:** the stepper is an `<ol>` with `aria-current="step"`; nav
  links use `aria-current="page"`; landmark `nav`s have `aria-label`.
- **Native controls first** (`<dialog>`, `<select>`, `<input type=range>`),
  for keyboard and screen-reader support.
- **Hidden elements:** use a class toggle, not the `hidden` attribute, on an
  element with a display utility. `<div hidden className="grid">` stays
  visible.
- **Motion:** `prefers-reduced-motion: reduce` collapses every animation and
  transition globally (`@layer utilities` in `globals.css`), including
  delays.
- **Touch targets:** at least 32 px (`icon-sm`); 36 px (`icon`) for primary
  icon buttons.
- `color-scheme` follows the theme, so native scrollbars and pickers match.

## Animations kept for accounts mode

`marquee`, `drift-a`/`drift-b` and `fade-slide-in` (`tailwind.config.ts`), and
the `.glass-surface`/`.glass-sheen` rules, belong to the landing page and the
login/register screens. Local mode never shows those screens. They are kept
for the optional hosted (accounts) mode and must not be used in local-mode
UI.

## Decisions recorded

Answers from the maintainer (2026-10-14) to this document's former open
questions:

| Question | Answer |
|---|---|
| Commit the Stitch DESIGN.md? | No: it stays private, and this document is the public source. |
| Landing/auth animations | Kept, documented as accounts-mode only (above). |
| A "System" theme option | Added in v1.0.5 (§1). |
