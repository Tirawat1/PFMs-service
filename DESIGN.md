---
name: WC Finance
description: Role-based reimbursement and project finance tracking for a university faculty
colors:
  primary: "#f0378a"
  primary-deep: "#b71e60"
  primary-soft: "rgba(240,55,138,.12)"
  neutral-bg: "#f5f8fc"
  neutral-panel: "#ffffff"
  neutral-panel-alt: "#eef3fa"
  neutral-line: "rgba(15,42,74,.10)"
  neutral-line-strong: "rgba(15,42,74,.16)"
  neutral-text: "#0f2a4a"
  neutral-text-muted: "#5b7290"
  neutral-text-dim: "#8ba0b8"
  status-success: "#0f9d6b"
  status-warning: "#b45309"
  status-danger: "#e11d48"
  status-info: "#0e7490"
  status-verified: "#7c3aed"
typography:
  display:
    fontFamily: "Sora, Noto Sans Thai, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  stat:
    fontFamily: "Sora, sans-serif"
    fontSize: "27px"
    fontWeight: 800
    lineHeight: 1
  title:
    fontFamily: "Manrope, Noto Sans Thai, sans-serif"
    fontSize: "16px"
    fontWeight: 800
  body:
    fontFamily: "Manrope, Noto Sans Thai, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Manrope, Noto Sans Thai, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    letterSpacing: "0.05em"
  thai:
    fontFamily: "Noto Sans Thai, Manrope, sans-serif"
rounded:
  xs: "7px"
  sm: "10px"
  md: "12px"
  lg: "16px"
  xl: "18px"
  xxl: "20px"
  full: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "22px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "linear-gradient(135deg, {colors.primary}, {colors.primary-deep})"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "13px 18px"
  button-primary-hover:
    backgroundColor: "linear-gradient(135deg, {colors.primary}, {colors.primary-deep})"
    textColor: "#ffffff"
  button-ghost:
    backgroundColor: "rgba(15,42,74,.05)"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.md}"
    padding: "13px 18px"
  badge-status:
    rounded: "{rounded.full}"
    padding: "5px 11px"
  input-field:
    backgroundColor: "#f4f7fb"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.md}"
    padding: "13px 14px"
  panel-card:
    backgroundColor: "{colors.neutral-panel}"
    rounded: "{rounded.xl}"
    padding: "20px"
---

# Design System: WC Finance

## Overview

**Creative North Star: "The Ledger Desk"**

WC Finance is a working desk, not a showroom — an internal tool two co-equal audiences (department requesters, finance/purchasing officers) sit at every day to move real money through a fixed, auditable pipeline. The system is calm and flat by default: white panels floating on a very pale blue-grey wash, dense information laid out in generous 12–24px rhythm rather than compressed, and exactly one saturated color — a magenta-pink gradient rooted in the faculty's institutional pink — reserved for the handful of things that are truly primary on any given screen (the main action button, the active nav item, the currently-focused pipeline step). Status is never color-only: every state badge pairs a tint with a text label. Numbers get their own quieter, more geometric display face (Sora) so amounts and IDs read as data, distinct from the warmer body copy (Manrope) and from Thai text (Noto Sans Thai), which is a first-class citizen throughout, not a smaller afterthought font. Nothing about this system tries to be exciting; it tries to be legible at a glance to someone checking whether their reimbursement moved forward today.

**Key Characteristics:**
- Flat, bordered white panels on a pale radial-gradient page wash — depth comes from soft color washes and thin borders, rarely from shadow.
- One accent color used sparingly (primary buttons, active nav, current pipeline step, focus rings) — everything else is neutral navy-grey.
- Every status is a tinted pill with an accompanying text label, never color alone.
- Numbers and headings render in Sora; running text and UI copy render in Manrope; Thai text always renders in Noto Sans Thai, never falls back to a Latin face.
- Generous, consistent spacing scale (8/12/16/22/30px) — density comes from a *lot* of small bordered panels, not from cramming.

## Colors

The palette is almost entirely neutral navy-on-pale-blue, with a single warm pink accent carrying all emphasis, plus a small, consistent set of status hues borrowed for meaning (success green, warning amber, danger red, info cyan, a violet reserved for "Verified").

### Primary
- **Faculty Pink** (`#f0378a`): the one accent. Primary buttons, gradient text treatments (`.gradt`), active/current states (active nav item, current pipeline step, focused input border, toggle-on switches), notification dot, brand mark. *Provisional* — anchored to the faculty's known institutional pink but not yet confirmed against an official brand guideline (see PRODUCT.md § Brand Commitments); treat the exact hex as adjustable, the hue and role as fixed.
- **Faculty Pink Deep** (`#b71e60`): the gradient's dark end. Pairs with Faculty Pink in every gradient (buttons, login art, active nav, brand mark, "current step" ring). Never used as a flat fill on its own.

### Neutral
- **Paper** (`#f5f8fc`): page background, under a very subtle dual radial-gradient pink wash (`.app`).
- **Panel White** (`#ffffff`): every card, panel, table, and the login form pane.
- **Panel Wash** (`#eef3fa`): secondary/inset surfaces — pipeline cells, stat backgrounds inside cards, segmented-control track.
- **Ink Navy** (`#0f2a4a`): primary text color and the base hue every other neutral derives from (all line/mute/dim colors below are this navy at varying alpha or lightness).
- **Slate** (`#5b7290`): muted text — labels, secondary metadata, sub-headings.
- **Fog** (`#8ba0b8`): dimmest text — placeholder-weight captions, disabled-adjacent copy, empty-state icons.
- **Hairline** (`rgba(15,42,74,.10)`) / **Hairline Strong** (`rgba(15,42,74,.16)`): the only two border colors in the system. Strong is for interactive/focusable boundaries (inputs, dividers between distinct button groups); regular is for passive card/panel edges.

### Status
- **Success Green** (`#0f9d6b`): positive amounts, "Purchase Complete"/"Settled" badges, completed pipeline steps, deposit-received confirmations.
- **Warning Amber** (`#b45309`): "Notified"/"Submitted" badges, open-discrepancy tags, pending states.
- **Danger Red** (`#e11d48`, deeper `#dc2626` for "Rejected"): negative amounts, destructive actions, rejected states, delete affordances.
- **Info Cyan** (`#0e7490`): "Docs Submitted"/"Linked" badges, Drive-integration banners, fixed-discrepancy tags.
- **Verified Violet** (`#7c3aed`): reserved solely for the "Verified" pipeline status — the one status badge that isn't a reused semantic color, deliberately distinct so the mid-pipeline "someone has checked this" moment stands apart from plain "in progress" amber.

### Named Rules
**The One Accent Rule.** Faculty Pink and its gradient partner are the *only* saturated color used for emphasis or action. Every other color on screen is either a neutral navy tint or a status hue tied to a specific, fixed meaning — never decoration.

**The Label-Plus-Color Rule.** No status, amount sign, or state is ever conveyed by color alone. A status is always a pill with text; a positive/negative amount always carries a `+`/`−` prefix alongside its green/red tint.

## Typography

**Display Font:** Sora (with system sans-serif fallback)
**Body Font:** Manrope (with system sans-serif fallback)
**Thai Font:** Noto Sans Thai (with Manrope fallback — used via the `.th` class wherever Thai copy appears, including inside otherwise-Manrope components)

**Character:** Sora is geometric and slightly condensed — used only where a number or a heading needs to read as structured data (page titles, stat tiles, bank balances, pipeline-step counts). Manrope is warmer and more humanist, carrying every sentence of running UI copy. The two never compete on the same line; Sora appears only in short, large, numeric-or-title contexts.

### Hierarchy
- **Display** (800, 34px, 1.1 line-height, Sora): page titles (`.h1`) — one per screen.
- **Stat** (800, 27px, 1 line-height, Sora): the big number in a stat tile or bank-balance card; also used at 23px for pipeline-step counts and 30px for the bank-balance hero figure.
- **Title** (800, 16px, Manrope): panel headings (`.panel-t`), card titles.
- **Body** (400–600, 14–15px, 1.5 line-height, Manrope): form inputs, table cells, descriptions, buttons (700 weight).
- **Label** (600, 12.5px, uppercase, 0.05em tracking, Manrope): field labels, stat captions, table column headers (11.5px) — the system's only uppercase/tracked text, reserved for metadata-level labels.

### Named Rules
**The Sora-For-Numbers Rule.** Any element whose primary content is a number or an ID (stat values, bank balances, pipeline counts) renders in Sora at 800 weight. Prose and interactive labels never do, even at large sizes.

## Layout

Two shells: a public **login** screen (`grid-template-columns: 1.1fr .9fr`, art pane left / form right, art pane hidden under 900px) and the authenticated **app shell** (`262px` fixed sidebar + fluid content column, sidebar collapsing to an off-canvas drawer under 820px). Inside the content column, `.content` caps at `1500px` and centers itself (`margin: 0 auto`) so wide monitors don't leave dead space on one side.

Density comes from a small, consistent gap scale — 8/10/12/14/16/24px — applied via utility classes (`.gap8`…`.gap24`), not ad hoc values. Page padding is 30px desktop, dropping to 18px/14px under 820px alongside a reduced display size (34px → 26px) and a 2-column stat grid instead of 4. Two content-grid patterns recur throughout: `.grid2` (1.6fr/1fr, e.g. account list beside transaction list) collapsing to one column under 1200px, and `.grid3` for card grids (categories) collapsing to two then one column as the viewport narrows.

## Elevation & Depth

Almost entirely flat. Depth is conveyed through layering pale panel colors against the page wash and through 1px hairline borders, not shadow — the default `.panel` has no box-shadow at all. Shadow is reserved for a short, deliberate list of floating or actively-emphasized elements: the modal overlay, the toast, the login brand mark, the active sidebar nav item's pink glow, a hovered bank/account card, and the focus ring simulated around the current pipeline step. When shadow does appear, it's always a soft, large-radius, low-opacity wash tinted toward the element's own color (pink glow under pink elements, navy under neutral ones) — never a hard drop shadow.

### Shadow Vocabulary
- **Floating surface** (`0 30px 80px rgba(15,42,74,.18)`): the modal.
- **Toast** (`0 16px 40px rgba(15,42,74,.16)`): the bottom-center toast.
- **Accent glow** (`0 8px 22px -8px rgba(240,55,138,.55)`): active sidebar nav item.
- **Card lift** (translateY(-2px) + border color shift, no added shadow beyond the ambient one already on bank cards): hover state on category cards and bank/account cards.

### Named Rules
**The Flat-At-Rest Rule.** Panels, cards, and table rows carry no shadow at rest. Shadow only appears on floating UI (modal, toast) or as a direct response to hover/active state.

## Shapes

Uniformly rounded, never sharp. A five-step radius scale runs from small chips (7px) up through buttons (12px), panels/cards (16–18px), to modals (20px); circular treatments (`border-radius: 50%`/full pill) are reserved for status dots, the current-step indicator, avatars/icon tiles that represent a *person or single entity*, and toggle switches. Icon tiles that represent a *category or type* (account icons, stat icons, doc-menu icons) use the softer squarish 10–15px radius instead of a circle — the shape distinction is the only signal separating "this represents someone" from "this represents a kind of thing." Borders are always 1px, always one of the two hairline neutrals, never the accent color except on focus/hover.

## Components

### Buttons
- **Shape:** 12px radius standard, 10px for the `.btn-sm` compact variant.
- **Primary:** Faculty Pink → Faculty Pink Deep gradient fill, white text, 700 weight, `13px 18px` padding (`9px 13px` for `.btn-sm`).
- **Ghost:** `rgba(15,42,74,.05)` fill, hairline-strong border, navy text — the default for secondary/destructive-adjacent actions (Close, Reopen, Correct, Delete all use this, distinguished by icon and label text, not color).
- **Hover / Focus:** primary brightens (`filter: brightness(1.08)`); ghost darkens its fill slightly. All buttons depress 1px on `:active`.

### Badges / Status Pills
- **Style:** fully rounded pill, a small solid dot (`::before`) plus label text, 12px/700 weight, tinted background at ~12–16% opacity of the status color with the status color as text.
- **State:** one fixed color pair per pipeline/projection/revenue status (see Colors § Status) — never reused for an unrelated meaning.

### Cards / Panels
- **Corner Style:** 18px (`.panel`), 16px (`.catcard`).
- **Background:** solid white on the pale page wash.
- **Shadow Strategy:** none at rest (see Elevation).
- **Border:** 1px hairline; category/bank cards shift border to the accent color on hover.
- **Internal Padding:** 20px (panel), 18px (category card).

### Inputs / Fields
- **Style:** `#f4f7fb` fill (a shade between Panel Wash and Paper), 1px hairline-strong border, 12px radius, 13px/14px padding.
- **Focus:** border shifts to Faculty Pink; no glow/shadow added.
- **Label:** always a separate uppercase 12.5px label above the field, never a placeholder-only field.

### Navigation (Sidebar)
- **Style:** icon + label rows, 11px radius, 600 weight, muted-navy default.
- **Hover:** faint navy wash background.
- **Active:** Faculty Pink gradient fill, white text, soft pink glow shadow — the single most saturated element on any authenticated screen.
- **Mobile:** off-canvas drawer sliding in from the left under 820px, dismissed via a scrim.

### Toggle Switch
- **Style:** 46×26px pill track, `#d7e0ec` off-state, Faculty Pink on-state, white/grey circular thumb that slides between the two ends.

### Status Stepper (Pipeline)
- **Style:** horizontal row of circular step dots connected by a hairline track; done steps fill Success Green, the current step fills Faculty Pink with a soft pink ring, future steps stay neutral outline-only.

## Do's and Don'ts

### Do:
- **Do** keep the accent gradient to primary actions, active nav, current-step indicators, and focus states only.
- **Do** pair every status badge and every signed amount with a text label, not color alone.
- **Do** render all Thai copy in Noto Sans Thai via the `.th` class, even mid-sentence inside an otherwise-Manrope component.
- **Do** use Sora for numbers/titles and Manrope for everything else — never mix them on the same text run.
- **Do** keep panels and table rows flat (no shadow) and reserve shadow for floating UI and hover/active response only.

### Don't:
- **Don't** introduce a second saturated accent color; new emphasis needs go through the existing status-color vocabulary or stay neutral.
- **Don't** add drop shadows to resting cards/panels to create "depth" — depth here comes from panel-on-wash layering and hairline borders.
- **Don't** use a circular icon tile for something that represents a category/type (accounts, doc types) or a squarish one for something that represents a person/entity — the shape is meaningful.
- **Don't** lock in the exact Faculty Pink hex as final brand truth without checking PRODUCT.md § Brand Commitments — it's a confirmed-direction placeholder, not an approved brand color yet.
