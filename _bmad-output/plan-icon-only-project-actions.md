---
title: 'Icon-only project actions'
type: 'feature'
ticket: ''
created: '2026-10-02'
status: 'built'
route: 'oneshot'
route_source: 'auto'
baseline_revision: 'ee851d993f5cf4e5bbd47013f8ac507b85e39798'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The New project and Undo actions consume unnecessary header space through visible text, and Undo is separated from the chart it affects.

**Approach:** Keep New project in the header as an icon-only control and move Undo to an icon-only control directly below the Gantt chart, preserving accessible labels and existing behavior.

</frozen-after-approval>

## Implementation Notes

This is a small JSX/CSS/test adjustment with no API or state-management changes, so it uses the oneshot route.
- Keep both translated action names as `aria-label` values while rendering only their glyphs.
- Add a dedicated row below `GanttChart` for Undo so the chart retains its independently scrollable layout.
- Updated `frontend/src/App.jsx`, `frontend/src/styles.css`, and `frontend/src/App.test.jsx`; all 62 frontend tests and the production build pass.

## Plan Change Log

## Review Triage Log

- `low`, patched: the header icon button's more-specific 40px rule overrode the 36px mobile width; the max-520px selector now explicitly includes `.icon-action`.

## Verification

**Commands:**
- `npm test -- --run` from `frontend/` -- expected: frontend test suite passes.
- `npm run build` from `frontend/` -- expected: production bundle builds successfully.
