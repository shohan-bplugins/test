# Dashboard — Changelog

## 2026-07-08

A round of layout, clarity, and density improvements to the Dashboard
(`Dashboard.jsx` + `Dashboard.css`).

### Layout

- **Conditional top section based on theme support** (`supportsAppBlocks`):
  - **App blocks available →** rich 3-column layout: Theme App Block + Current
    Plan stacked in the left column, the App Blocks list in the middle, and
    Recent Audios on the right.
  - **Auto mode (no block support) →** compact two-column layout: a vertical
    status rail on the left beside the App Blocks setup guide on the right.
- Added a **header action row** (page title on the left, `Go to audio list` +
  `Add New Player` on the right).
- Auto-mode status rail is now **three separate cards** (Theme App Block ·
  Current Plan · App Blocks) instead of one strip with dividers; the cards
  stretch to match the height of the App Blocks card beside them.

### App Blocks card

- Blocks-available view uses a clean list: status dot · block name · `Add` /
  `Added` action, with a `x/5 added` badge and a `Reload Status` footer.
- Auto-mode view shows a plain-language guide: what happens automatically, a
  status panel (app embed enabled?, assign a player), and always-visible
  "Home page & other pages — how to add" steps.

### Status & Plan

- Theme App Block card shows an "All set!" / "Action Required" status box with
  `Manage Block` / `Enable App Block` and `Reload Status`.
- Current Plan card shows usage (used / limit or Unlimited) with a progress bar
  and `Manage plan`.

### Removed collapse toggles

- **Help & Resources** no longer collapses — it's always expanded.
- The **"how to add"** steps in the App Blocks guide are always visible (the
  old expandable `<details>` was removed).
- FAQ accordion is unchanged (still expand/collapse per question).

### Density

- Compressed vertical spacing across the board: container padding, card
  header/footer, status panel, section labels, step lists, help section, and
  FAQ rows — for a shorter, tighter page.

### Fixes

- Fixed a `ReferenceError: nav is not defined` in the status rail's reload
  button (`nav.state` → `revalidator.state`) and added the missing loading
  spinner style.

### Housekeeping

- Removed dead code left over from earlier iterations (unused grid variants,
  the grouped-blocks experiment, and orphaned helpers/state/imports).
