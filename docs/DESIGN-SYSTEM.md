# Till design system — match the Order Portal

The till must look like the restaurant's **Order Portal** (`/admin/portal`). This file is the
rulebook for every restyle. It is a **look-and-feel** job only.

## Hard rules

1. **Do not change behaviour.** No change to flows, data, IPC calls (`window.api.invoke`),
   permissions, props/exports used by other files, i18n keys or the words they hold, or which
   buttons exist. Keep every `onPress`/`onClick`, `aria-*`, `data-no-scan`, test id and
   condition exactly. Only markup structure *for layout* and classes change.
2. **The restaurant's colour is the only brand colour** (`--brand`, set at runtime from the
   server; HeroUI `primary` is the same colour). It marks only: the primary action, and "where you
   are / selected". Never decoration, headings or borders.
3. **No pastel or tinted fills.** No `bg-*/10`, `bg-*/15`, `bg-primary/20`, `bg-success/10`,
   `bg-warning/15`, `-50`/`-100` colour tints, gradients, coloured card fills. A status is a
   **solid chip with white text**. A notice is a white surface with a thin border (`.ui-notice`).
4. **Never browser/OS defaults:** no `title=` tooltips (use `components/Hint.tsx`), no
   `window.alert/confirm/prompt` (use `useToast` / `useConfirmDialog`), no native `<select>`
   (HeroUI `Select`), no `<input type="date">` (HeroUI `DatePicker` or the existing pattern),
   no OS scrollbars (global thin scrollbar is already set).
5. **Fingers first:** tap targets ≥ 44px on the till. `.ui-btn`, `.ui-icon-btn`, `.ui-seg-item`
   already enforce it on touch; for HeroUI `Button` use `size="md"` or `"lg"` (not `sm`) for
   anything tapped during service.
6. **Arabic = RTL.** Logical classes only: `ms-/me-/ps-/pe-/start-/end-/border-s/border-e/
   text-start/text-end`. Never `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`.
   Direction icons get `flip-rtl`. Money and numbers keep the existing `money` class.
7. Light **and** dark from one definition: use the tokens below, never `text-slate-*`,
   `text-gray-*`, `bg-white`, `bg-gray-50`, `bg-slate-950`, hex colours, or
   `theme === 'dark' ? … : …` class branches.

## Screen sizes — the main requirement

The same screens run on **Android phones and small tablets**, **old low-resolution PCs**
(1024×768, 1366×768 with 125–150% Windows scaling ≈ 1024×600 CSS px) and **large monitors**
(1920–2560+). Every screen must work and look right from **360px wide / 560px tall** up to
**2560px**:

- No fixed widths or heights for content. Use `min-w-0`, `flex-wrap`, `truncate`,
  `grid-cols-[repeat(auto-fill,minmax(…,1fr))]`, `clamp()`, `max-w-*` for readable text on huge
  screens. Keep the existing fluid `--pos-*` scale and `pos-*` classes.
- Short screens: scroll inside the content area, keep primary actions reachable (sticky footer
  in popups and the cart), never let a fixed header + footer squeeze content to nothing.
- Popups: `max-h-[calc(100dvh-2rem)]` with an inner scroll area; below `sm` (640px) become a
  near-full-width sheet (`w-full`, small margins). Never wider than the screen.
- Padding scales: `p-3 sm:p-4 lg:p-6` — not big fixed paddings that eat a small screen.
- Rows of tabs/chips/tables scroll horizontally (`overflow-x-auto chip-scroll`) instead of
  wrapping into many lines or overflowing.
- Toolbars wrap (`flex-wrap gap-2`); multi-column forms collapse to one column below `sm`.
- Tap targets stay ≥ 44px on touch at every size.

## Round 2 decisions (operator review, Nov 2026)

- **Quiet tables.** Tables are neutral `surface` tiles/pills with a 1px `line-strong` border and
  a small solid status dot; only *busy* (red dot + red text label) and *reserved* (amber dot)
  carry colour. The current table = brand border + `--brand-ring`. No big solid green pills.
- **Dish cards without a photo** drop the image box entirely and become a compact text card
  (name, Arabic name, price, the Sizes/Options chip inline). Cards with a photo keep it.
- **Compact order-screen header:** one row — open-order tabs (scroll), then NEW, order type,
  help. With no or one open order the strip must not render as a long empty bar.
  On phones it is at most two rows.
- **Cart top:** Apply promo and Clear cart share one small row (small outline buttons or icon
  buttons with Hint), never two full-width rows above the dishes.
- **Phones (< 768px):** no side rail; a bottom dock with the main screens and a "More" sheet
  holding everything else (same links, same permissions).
- **Side menu:** Catalog and System links sit under one collapsible "More" group; it opens by
  itself when the current screen is inside it.
- **Order cards everywhere orders are listed** (Today's Orders, kitchen) — see "Order card".

## Tokens (CSS variables, `styles/portal.css`)

| token | use |
|---|---|
| `--canvas` | page background (`bg-canvas` or HeroUI `bg-background`) |
| `--surface` / `--surface-2` | cards, popups, inputs / quiet inner areas (`bg-surface`, `bg-surface-2`; HeroUI `bg-content1` = surface) |
| `--line` / `--line-strong` | hairline borders (`border border-line`, `border-line-strong`) |
| `--ink` / `--ink-2` / `--ink-3` | main / secondary / muted text (`ink`, `ink-2`, `ink-3`; HeroUI `text-foreground`, `text-default-700`, `text-default-500`) |
| `--hover` | hover fill |
| `--shadow-1/2/3` | card / raised / popup (HeroUI `shadow-small/medium/large`) |
| `--brand`, `--brand-ink`, `--brand-hover`, `--brand-strong`, `--brand-ring` | brand fill / text on brand / hover / brand text on white / focus glow |
| `--st-amber #b45309` `--st-green #047857` `--st-blue #1d4ed8` `--st-red #b91c1c` `--st-gray #52525b` | status fills, white text, same in both themes. HeroUI: `warning`, `success`, `danger` are these. |

Arbitrary values are fine when needed: `bg-[var(--surface)]`, `border-[var(--line)]`,
`shadow-[var(--shadow-2)]`.

## Ready-made classes (`styles/portal.css`)

| class | component |
|---|---|
| `.ui-card` (+ `.ui-card-raise` for hover lift) | Card: surface, 1px line, radius 20px, shadow-1 |
| `.ui-popup` | Popup/menu/dialog surface: radius 16px, shadow-3 |
| `.ui-btn` + `.ui-btn-primary / -outline / -ghost / -danger` (+ `.ui-btn-lg` / `.ui-btn-sm`) | Buttons for plain `<button>` |
| `.ui-icon-btn` (+ `.ui-icon-btn-outline`) | Icon button 2.5rem square |
| `.ui-seg` + `.ui-seg-item` (selected = `aria-pressed/selected/checked="true"`) | Segmented control / tabs |
| `.ui-chip` + `.ui-chip-brand / -amber / -green / -blue / -red / -gray / -outline` | Status chip (solid, white text) / outline chip (order type) |
| `.ui-count` | Round count badge (ink fill); add `ui-chip-brand` colours for a brand count |
| `.ui-input` | Input wrapper: HeroUI `classNames={{ inputWrapper: 'ui-input' }}` |
| `.ui-notice` | Notice: white surface + thin border + icon + text |
| `.ui-nav` (`aria-current="page"` = brand fill) | Side menu item |

HeroUI components are already themed (radius 9/11/16, neutrals, status colours, shadows) — prefer
them for anything with behaviour (Modal, Select, Input, Button with `isLoading`). Adjust with
`className` / `classNames`, e.g. `<Button color="primary" size="lg" className="font-semibold">`,
outline = `variant="bordered"` + `className="border border-[var(--line-strong)] bg-[var(--surface)]"`,
ghost = `variant="light"`. `<Chip>` must be `variant="solid"` (never `flat`).

## Type

Inter / IBM Plex Sans Arabic (bundled), tabular numbers, rem sizes × `--ui-text`.
Order numbers `text-lg font-bold` (1.125rem 700). Money `text-base font-semibold`.
Labels `text-sm font-semibold`. Small print `text-xs`. Section headings: `text-xs font-semibold
uppercase tracking-wide ink-2` followed by a `.ui-count`.

## What the portal looks like (screenshots, Nov 2026)

- **Canvas** warm grey; content on white cards, 12–16px gaps, generous padding (page `p-4 lg:p-6`).
- **Top bar** (no border, on canvas): sidebar-toggle icon button · page title `text-xl
  font-semibold` · pushed to the end: primary button with a `+` icon, status chip, outline select,
  icon buttons.
- **Tabs**: `.ui-seg` with a `.ui-count` after each label; the selected tab's count is brand.
- **Section heading**: `PREPARING ①` — uppercase small label + count badge.
- **Empty state**: dashed `border-[var(--line-strong)]` box, radius 20px, centred `ink-2` text.
- **Order card** (`.ui-card`, padding 1rem):
  - row 1: `#6901` (`text-lg font-bold`) · outline chip `Dine-in` · end: time chip
    (outline < 15 min, amber ≥ 15, red ≥ 30).
  - row 2 (`ink-2`, one line): customer name · `1 items`.
  - row 3: total (`font-semibold`) · payment chip (`Not paid · KNET` amber / `Paid · Cash` green)
    · end: the one next action as a small primary button + a small outline print icon button.
  - fresh/new orders: brand border + `--brand-ring` glow.
- **Order sheet / detail dialog**: surface, radius 24px, shadow-3; header `#ref` large bold with
  chips row (status brand/green/blue/red/gray, type outline, payment amber/green, age red);
  sections with `ITEMS · 1` small uppercase heading; item rows in a bordered card with thumbnail;
  totals: `Items … KD x` muted, `Total` bold; secondary actions as two outline buttons; a
  destructive action as red text (ghost danger); the main action as a full-width large primary
  button pinned at the bottom.
- **Status → chip colour**: Done/Closed/Completed → green · Ready / Out for delivery /
  Waiting for pickup → blue · Cancelled/Rejected/Refunded → red · New/Placed/Order received →
  brand · others (Pending, Preparing, Prepared) → gray · Paid → green · Unpaid → amber.
  Use the words the app already shows; never invent status names.
- **Icons**: lucide, `strokeWidth={1.8}`, 20px in menus/buttons, 16px in small buttons/chips,
  colour = text colour.
- **Motion**: 150ms colour/shadow transitions; buttons press to scale .98.
