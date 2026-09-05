# Agent result — Report finding Details inline row

**Date:** 2026-09-05  
**Branch:** main (uncommitted)

---

## Files changed

| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | Replaced detached `<div class="issue-detail">` with an inline expandable `<tr>` rendered immediately after the triggering finding row. Added `aria-expanded` / `aria-controls` to the Details trigger button. Toggling behaviour (repeated click closes) implemented. `Fragment` with key used for the row pair. |
| `apps/web/src/components.tsx` | Extended `Button` props to accept `aria-expanded` and `aria-controls` and pass them to the underlying `<button>`. |
| `apps/web/src/styles/base.css` | Added `.issue-detail-row` / `.issue-detail-cell` rules; removed the old top margin from `.issue-detail` (now uses `border-top` instead since it appears inside a table cell). |
| `apps/web/src/App.test.tsx` | Added `describe('Issue Center — inline detail row', ...)` with 7 regression tests covering: hidden by default, inline expansion, button label flip, `aria-expanded` attribute, collapse via "Hide details", collapse via "Close details", and single-row-at-a-time switching. |

---

## Behaviour before

Clicking **Details** on any finding row called `setSelectedIssue(issue)`, which conditionally rendered a `<div class="issue-detail">` **below the entire `<DataTable>`** — detached from the row it described. A second click on Details for a different row simply replaced the detached block's content. Repeated click on the same row did nothing (it was already selected); a "Close details" button inside the block was the only way to dismiss it.

## Behaviour after

Clicking **Details** expands an inline `<tr class="issue-detail-row">` **directly below the triggering row** inside the same `<tbody>`. The full `colSpan={5}` cell contains the same detail fields and "Close details" button as before.

- **Toggle:** repeated click on the same row's Details button ("Hide details" while expanded) collapses it.  
- **Single expansion:** clicking Details on a different row collapses the previously-open row and expands the new one.  
- **Keyboard support:** the Details trigger is a native `<button>` — Enter/Space work without additional code; Tab order follows document flow.  
- **ARIA:** the trigger button carries `aria-expanded="true"/"false"` and `aria-controls="issue-detail-<id>"` pointing to the detail row's `id`.  
- **Existing content preserved:** all detail fields (Severity, Status, Target, Evidence, Recommendation, Impact, Confidence) and the "Close details" button are identical to before.

---

## Tests run

```
Test Files  2 passed (2)
Tests      32 passed (32)
```

New tests added (all in `Issue Center — inline detail row`):
1. hides all details by default
2. shows inline detail below the row when Details is clicked
3. changes button label to "Hide details" when expanded
4. sets aria-expanded=true on the trigger button when expanded
5. collapses the detail row when Hide details is clicked
6. collapses the detail row when Close details is clicked
7. collapses the first row and expands the second when a different row is clicked

TypeScript: `tsc --noEmit` — no errors.  
Build: `vite build` — clean, 151 ms.

---

## Remaining concerns

- **`aria-expanded` on `<tr>`:** The `<tr>` itself also carries `aria-expanded` for potential assistive-technology support, but the W3C ARIA specification does not include `aria-expanded` as a valid attribute for `row` role. This was left for discoverability; it can be removed if it causes ARIA validator noise without affecting the button's own correct `aria-expanded`.
- **Responsive / mobile stacking:** The `<td colSpan={5}>` approach is standard for desktop table layouts. On mobile where the table uses `data-label` attribute-based stacking (see existing `.data-table` CSS), the detail row will appear as a full-width block, which is correct and preserves readable layout. No issues observed.
- **Animation:** The inline row appears/disappears instantly (no CSS transition). A CSS height/opacity transition can be added later without touching this logic.
