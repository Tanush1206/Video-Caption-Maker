# Design system

The UI's visual language as of **v1.1.0**, the minimal, Apple-like redesign.
Values are taken from `frontend/tailwind.config.ts`,
`frontend/src/app/globals.css` and `frontend/src/components/ui/*`. When this
document and those files disagree, the files win: fix the doc.

## 1. Direction

Think Photos, iMovie, Final Cut and macOS System Settings.

- **Content first.** The video is the hero; the chrome recedes.
- **Hierarchy from type, weight and spacing**, not from boxes and borders.
  Areas are separated by background tone and space; a border is only a
  hairline between list rows, or the edge of an input.
- **One accent**, used only for the screen's single primary action, the
  selected state and progress. Everything else is black, white and greys.
- **Calm.** Generous whitespace, nothing decorative: no gradients, no glows,
  no coloured shadows, no coloured badge pills.
- **Restyle, never re-logic.** A design change changes no behaviour, and
  **no mock data**: every figure on screen comes from the API.
- **Two themes**, light (default) and dark, by a `.dark` class on `<html>`,
  with three choices in Settings → Appearance: Light, Dark and **System**
  (the default):
  - Light or Dark is stored in `localStorage["vcm-theme"]`; System stores
    nothing and follows the OS, live;
  - an inline script in `app/layout.tsx` applies the choice before first
    paint, so the wrong theme never flashes.
- **AA beats the exact colour.** Where a colour from the brief fails WCAG AA
  as text, the fill keeps the brief's value and the text gets an AA twin
  (§2). axe-core must stay at 0 violations.
- `design/stitch/` (private, gitignored) is **no longer the reference**.

## 2. Colour

Tokens are **bare HSL channels** (`210 100% 44.5%`), wrapped by Tailwind as
`hsl(var(--x) / <alpha-value>)` so opacity modifiers (`bg-accent/20`) work.
**Never** store a full `hsl(...)` string in a token.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--background` | #FFFFFF | #000000 | the page |
| `--foreground` | #1D1D1F | #F5F5F7 | text |
| `--card` (= `--surface-2`) | #F5F5F7 | #1C1C1E | the **grouped** tone: inset groups, the stage, notices, the selected row |
| `--surface-3` | #E8E8ED | #2C2C2E | grey button fill, segmented track, a group inside a dialog (dark) |
| `--muted-foreground` | #6E6E73 | #98989D | secondary text, icons |
| `--border` / `--input` | #D2D2D7 | #38383A | hairlines, input edges |
| `--primary` | #0071E3 | #0071E3 | **fills**: the primary button |
| `--primary-hover` | #0062C4 | #0062C4 | the primary button hovered or pressed (darker, never lighter) |
| `--primary-text` | #0066CC | #409CFF | **accent text** (`text-primary`): plain buttons, links, the active timestamp |
| `--accent` | #0071E3 | #0A84FF | selection outlines, progress (`.bar-fill`), the playhead, focus |
| `--ring` | #0071E3 | #0A84FF | the focus ring |
| `--success` | #34C759 | #34C759 | **dots and icons only** |
| `--warning` / `--warning-text` | #FF9F0A / #C93400 | #FF9F0A / #FF9F0A | dot / text |
| `--destructive` / `--destructive-text` | #FF3B30 / #D70015 | #FF3B30 / #FF453A | dot / text |
| `--destructive-fill` | #D70015 | #D70015 | the one filled red button, in a confirm dialog |
| `--segment` | #FFFFFF | #636366 | the selected segment |

**Why the twins** (all measured; comments in `globals.css`):
- White on #0A84FF is 3.6:1, so the filled primary is #0071E3 in both
  themes; #0071E3 hovered at 90 % put white under 4.5:1, so hover and press
  darken to #0062C4 (5.9:1).
- #0071E3 as text on #F5F5F7 is under AA: accent text is #0066CC in light.
  #0A84FF as text on #2C2C2E is 3.8:1: accent text is #409CFF (the system
  blue's higher-contrast tone) in dark.
- Red and orange text are #D70015 / #C93400 in light; the brief's #FF3B30 /
  #FF9F0A stay for dots.
- On the segmented track, #6E6E73 is 4.15:1, so every segment label is in the
  main text colour; the selection is the lifted segment.

**`text-primary` ≠ `bg-primary`.** `tailwind.config.ts` maps `textColor` so
`text-primary`, `text-warning` and `text-destructive` read the AA text tones
while `bg-*` reads the fills.

**Rules:**
- **Never** hard-code a colour in a component. Use a token utility.
- **Status is a dot or words, never a pill.** `Badge` is a small dot beside
  ordinary text; the words carry the meaning.
- **In dark, elevation is lightness.** Page #000 → grouped #1C1C1E → #2C2C2E.
  A sheet or dialog in dark is the raised surface, not black.
- **Caption colours are user data**, not theme tokens; the video frame stays
  neutral in both themes.

## 3. Typography

| Role | Stack |
|---|---|
| UI (`font-sans`) | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", Inter, sans-serif` (no webfont) |
| Timestamps and timecodes **only** (`font-mono`) | `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace` |
| Caption faces | unchanged: the fonts in `public/fonts/` and Google Fonts on demand, the same files the burn uses |

**Monospace is only for timestamps and timecodes** (`00:12.300`). Sizes,
percentages, counts, file names and commands use the sans stack, with
`tabular-nums` where a number changes in place.

**Scale** (fixed px, on Tailwind's own names so every `text-sm` landed on the
new scale):

| Role | Class | Size / line | Weight |
|---|---|---|---|
| Page title | `text-2xl` | 28 / 34 | 600, −0.02em |
| Section title | `text-xl` | 20 / 25 | 600, −0.02em |
| Emphasised row, dialog list title | `text-lg` / `text-[17px]` | 17 / 22 | 400–600 |
| Body | `text-base` / `text-[15px]` | 15 / 22 | 400 |
| Secondary | `text-sm` / `text-[13px]` | 13 / 18 | 400 |
| Caption, timestamps | `text-xs` | 12 / 16 | 400 |

- `.label-caps` is the small grey heading above a group: 13/18, secondary,
  **sentence case** (the name is older than the look).
- Headings `h1–h3` get −0.02em globally.
- **Adding a `fontSize` key** means registering it in `src/lib/utils.ts`
  (`extendTailwindMerge`), or `cn()` reads it as a colour and drops the
  colour beside it.
- **Adding a caption face** takes two edits that agree: the `.ttf` (+
  licence) in `frontend/public/fonts/` with an `@font-face` in `globals.css`,
  and the `FONTS` entry in `backend/app/services/caption_style.py`.

## 4. Spacing, radius, surfaces

- **4 px grid:** 4, 8, 12, 16, 24, 32, 48, 64. Page side margins **32 px**
  from `sm`, **16 px** on a phone (`CONTAINER`, `WIDE_CONTAINER` in
  `layout/page-frame.tsx`). **48 px** between sections, **8–12 px** between
  related items.
- **Bars:** `spacing.header` = 52 px, the app bar and the editor bar.

| Radius | Class | Use |
|---|---|---|
| 6 px | `rounded-sm` | timestamp buttons, small focus targets |
| 8 px | `rounded-md` | segmented controls, menu items |
| 10 px | `rounded-lg` (`--radius`) | buttons, inputs |
| 12 px | `rounded-xl` | thumbnails, the video, inset groups, notices |
| 16 px | `rounded-2xl` | dialogs, the phone sheet |

- **Shadows only on floating layers** (dialogs, popovers, menus, the phone
  sheet): `shadow-overlay` = `0 8px 32px rgb(0 0 0 / .12)`, `/ .5` in dark.
  `shadow-sm` and `shadow-card` are deliberately none.
- **Translucency:** the top bar, the editor bar, the phone tab bar and the
  sheet use `.bar-translucent`: the background at 72 %, `blur(20px)
  saturate(180%)`, solid where `backdrop-filter` is unsupported.
- **Grouped lists** (`.group-inset`, `.group-row`): an inset rounded group on
  the grouped tone; each row at least 44 px, label left and value or control
  right, rows split by a hairline; a `.label-caps` heading above and a 13 px
  grey footnote below. Used by Settings, the inspector, the language step,
  the export dialog, the pipeline and the search preview.

## 5. Icons

- **lucide-react** only, imported per icon, at **1.5 stroke** (global
  `.lucide { stroke-width: 1.5 }`), 16–20 px, in the secondary text colour
  unless the icon carries state (a warning icon in `text-warning`).
- No icon in a tinted circle or tile.
- Decorative icons get `aria-hidden="true"`; an icon-only button **must**
  have an `aria-label`.

## 6. Components

All primitives live in `frontend/src/components/ui/`. **Use them; don't
hand-roll** a button, input or group with raw classes.

### Button (`button.tsx`, styles in `button-variants.ts`)

`buttonVariants` is in its own module with **no `"use client"`**, so server
components can style a `Link` as a button. **Never** import it from
`button.tsx`: prerendering fails with `TypeError: (0, o.d) is not a
function`, and only in `next build`.

| Variant | Look | Use |
|---|---|---|
| `primary` | filled accent, white text | **at most one per screen** |
| `secondary` | grey fill (#E8E8ED / #2C2C2E) | other actions with a shape (Cancel, Back) |
| `plain` | accent text, no fill | quiet actions (Search this video, Download, Redo) |
| `ghost` | grey icon or text | toolbars |
| `danger` | red text | the way **into** a destructive flow (Delete…, Remove key) |
| `destructive` | filled red | only the **confirm** button inside a confirm dialog |
| `link` | accent text, underline on hover | inline links |

Sizes are **44 px tall on a phone** (`h-11`), desktop sizes from `sm`: `sm`
32, `md` 36, `lg` 44; `icon` 44 / 36, `icon-sm` 44 / 32. `loading` shows a
spinner and disables; disabled is 40 % opacity.

### Inputs

- `inputClasses` / `Field` (`field.tsx`): 44 px on a phone, 36 px from `sm`,
  `rounded-lg`, a hairline `border-input`, 15 px text; focus turns the edge
  and ring accent. `Field` adds the label, a hint **or** an error
  (`aria-invalid`, `role="alert"`, `aria-describedby`).
- `Select` (`select.tsx`): a **native** `<select>` in the input skin.
- `Range` (`range.tsx` + `range.module.css`): a 4 px track in the hairline
  colour, the accent fill, a white 20 px knob with a hairline; no glow.
- **Searchable pickers** (`styles/font-picker.tsx`,
  `videos/language-picker.tsx`): a button over a search box and a listbox
  (ARIA combobox), because a native select can't search 1,301 fonts or
  languages named in their own scripts.
- **Dependent controls stay put:** a control with no effect in the current
  state is disabled, not removed, so nothing after it moves.

### Segmented (`segmented.tsx`)

One grey track (`surface-3`, 8 px), the chosen segment lifted on
`--segment`. `kind="pressed"` is a group of toggle buttons (the library
filters, search mode); `kind="radio"` is one setting with several values,
arrow keys between them (the inspector's tools, the theme, export
resolution). `iconOnly` keeps the label as the accessible name.

### Menu (`menu.tsx`) and Popover (`popover.tsx`)

- `Menu`: the "…" button and its list (`role="menu"`, arrow keys, Escape,
  click outside). The video actions live here, not as visible buttons.
- `Popover`: a button and a small floating panel (the volume slider, the
  speed list); Escape and a click outside close it, focus returns. The
  panel is kept 16 px inside the window (v1.2.1). With `panelLabel` it is a
  dialog of that name, described by its text, and takes the focus, for a
  panel that only says something.
- `AccuracyInfo` (`captions/accuracy-info.tsx`, v1.2.1): the (i) beside the
  caption count and beside "Spoken audio", named "About caption accuracy".
  It opens the note on what AI captions get wrong, only on click, tap or
  keyboard; never a banner.

### Dialog (`dialog.tsx`)

The **native `<dialog>` with `showModal()`** (focus trap, Escape, inert
background for free). Centred, 16 px radius, `shadow-overlay`, white (dark:
#1C1C1E), over a 40 % black backdrop with a blur. Title 20 px, the
description in grey, no rules inside: space separates the header, body and
footer. `bodyClassName` hands the body to content that scrolls itself (the
export dialog). Inside a dialog, groups use `surface-3` in dark.

### Notice (`notice.tsx`)

What the app has to say about a video: on the grouped tone, no border, no
tint; a small icon in the AA text tone (`info` grey, `warning`, `error`), a
15 px title and 13 px grey detail. Used for "No speech was found in this
video", unsupported speech, translation fallbacks, upload and load errors.

### Badge (`badge.tsx`), Stepper (`flow/stepper.tsx`), Skeleton

- `Badge`: a status as an 8 px dot beside grey text (`tone`, optional
  `pulse`).
- `Stepper`: Upload → Language → Export as an `<ol>` (`aria-current="step"`):
  a check for done, an accent dot and semibold for the active step, a grey
  dot ahead; hairline connectors. No box around it.
- `Skeleton`: a pulse on the grouped tone, shaped like the content.

### Hints (`lib/hints.ts`)

`useOnceHint(name)`: a small dark tooltip shown the first time something is
hovered, then never again (`localStorage["vcm-hint-<name>"]`). Replaces
helper lines that used to sit under the timeline and the video.

## 7. Screens

- **Header:** the app name left; Videos, Search, Settings as plain text tabs
  centred; translucent bar, hairline under it. Nothing else (hardware is in
  Settings). On a phone the tabs are a translucent bottom tab bar
  (`MobileTabBar`), hidden in the editor.
- **Dashboard:** a calm upload area (dashed hairline, ~140 px, a small icon,
  one line, one primary "Choose video"), then "Videos" with one grey line
  ("6 videos · 1.2 GB"), the filters as a segmented control, and the grid:
  a rounded 16:9 thumbnail, the title at 15 semibold, one grey line ("Hindi
  · 3:48 · Ready"). Processing is a thin accent bar on the thumbnail;
  failed is a red dot and "Failed". Actions on hover and in "…". Footer:
  "VideoCaptionMaker v1.x.x", small and grey (`version` from `/api/system`).
- **Language step:** "Spoken audio" as a grouped row ("Hindi · heard at
  62%"); the unsupported-speech `Notice` with the spoken-language picker
  and "Try anyway (low quality)"; the Hindi script as a grouped list with a
  check; "Caption into" as borderless tiles outlined in the accent when
  chosen, with search; the file, "Local and offline · faster-whisper
  large-v3" with a dot, Back (grey) and Start (primary).
- **Processing:** the pipeline as one grouped list (check, spinner or dot;
  Done, the percentage or Queued), a thin bar on the running stage only;
  the one-time model download as a grouped block above it.
- **Failed:** "Processing stopped" with a small red icon, the reason in
  grey, Try again (primary), Retry with small model (grey), Open Settings
  (plain); the model in use as a grouped row. The editor bar's Export is
  grey until the video has captions.
- **Editor:** the video large and centred on the grouped tone; one quiet
  player row (time; previous, play, next; volume and "1×" popovers); the
  inspector on the right, a segmented control (Captions · Typography ·
  Appearance · Position) over grouped lists; the dense caption list (12 px
  mono time over 15 px text, hairlines, the current row on the grouped tone
  with an accent time); the timeline across the bottom (a 2 px accent
  playhead with a head; caption handles 3 px, shown only near the caption,
  focused or dragged). Export is the one primary button, top right.
  - **Phone:** no app header (the editor bar has back, title and Export);
    one player row; the inspector is a bottom sheet that, lowered, fills the
    rest of the screen and **peeks** at the current caption (its time, and
    its text, editable in place), and rises to 72 vh for a tool.
- **Export dialog:** the formats as a grouped list with a check; file name
  and resolution (segmented) as rows; earlier exports as hairline rows with
  the language and, in the warning's text tone, "From earlier captions";
  Download as plain text; Cancel (grey) and Export (primary).
- **Search:** the page title, one large field on the grouped tone with
  Search as its action (the modes as a segmented control when Gemini is
  set); results as hairline rows (thumbnail, timestamp, match, text, "Play
  from"), a plain heading per video, the preview as a grouped list beside.
- **Settings:** one 720 px column of grouped lists: Your computer, Speech
  model, Translation, Gemini, Storage, Appearance.
- **Error pages** (404, Something went wrong, Can't reach the app yet,
  Couldn't load this video): a plain grey icon, the page title, the reason
  in grey, one primary action.

## 8. Motion

150–250 ms `ease-out` for hover, press and sheet transitions (`duration-200`
is the default). No bouncing and nothing decorative. `prefers-reduced-motion:
reduce` collapses every animation and transition globally (`@layer
utilities` in `globals.css`).

## 9. Breakpoints and layout

Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280.

- **Design targets: 375 px and 1440 px**, light and dark, for every screen.
- **Below `md`:** the bottom tab bar (pages pad for it), and in the editor no
  app header. **Below `lg`:** everything stacks, single column; the
  inspector is the bottom sheet.
- **Never** allow horizontal page scroll at 375 px.

## 10. Accessibility

Target: **WCAG 2 A/AA, 0 axe-core violations** on every screen and state, in
both themes (`scripts/ui-check/axe.js`, and the state checks in
`checks.js`).

- **Focus:** one global treatment, `:focus-visible { ring-2 ring-ring
  ring-offset-2 }`: a **2 px accent ring**. Mouse clicks leave none. Never
  remove it per component; rows use an inset ring.
- **Contrast:** 4.5:1 for text, 3:1 for large text and UI boundaries. Re-run
  axe after any token change, and check hover states too.
- **Touch targets: 44 px** on a phone (buttons, row tools, popovers, tabs).
- **Labels:** every input has a visible `<label>` or an `aria-label`; a
  placeholder is not a label.
- **Live regions:** errors `role="alert"`; progress `role="status"` /
  `aria-live="polite"`; bars `role="progressbar"`.
- **Native controls first** (`<dialog>`, `<select>`, `<input type=range>`,
  radios inside labels for the grouped choices).
- **Hidden elements:** toggle a class, not the `hidden` attribute, on an
  element with a display utility.
- `color-scheme` follows the theme, so scrollbars and pickers match.

## 11. Accounts mode

The landing page and the sign-in screens (`app/page.tsx`, `app/(auth)`,
`components/auth`, `components/landing`, the `.glass-*` rules and the
`marquee`/`drift` animations) belong to the optional hosted mode, which a
local install never shows. In v1.1.0 they took the new tokens only; they
were not redesigned.

## Decisions recorded

| Question | Answer |
|---|---|
| Commit the Stitch DESIGN.md? | No; and since v1.1.0 it is no longer the reference. |
| Landing/auth screens | Kept for accounts mode; tokens only in v1.1.0 (§11). |
| A "System" theme option | Yes, the default (§1). |
| Exact brief colours vs AA (v1.1.0) | Fills keep the brief's values; text uses AA twins (§2). |
| UI webfont (v1.1.0) | None: the system stack; Geist and JetBrains Mono removed. |
