---
title: 'Align dependency arrows with task bar centers'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: '712b12f9b71787fdd0dff3ed5cb915c918a3c96c'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dependency arrows use logical date-grid coordinates instead of the rendered task-bar edges, so they do not connect precisely to the visible bars.

**Approach:** Calculate each connector from the vertical center of the predecessor bar's right edge to the vertical center of the dependent bar's left edge, including bar inset, minimum width, zoom, and marker-tip alignment.

</frozen-after-approval>

## Implementation Notes

This is a localized geometry correction in `frontend/src/components/GanttChart.jsx` with focused assertions in `frontend/src/App.test.jsx`; the expected change is under 100 lines.

- Added shared rendered-bar geometry so connector endpoints and task bars use identical inset, minimum-width, and zoom calculations.
- Aligned the SVG marker tip with the path endpoint and added regression assertions for both default and reduced zoom.
- Verified the focused frontend test suite and production build.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm test -- --run src/App.test.jsx` from `frontend/` -- expected: connector geometry tests pass at default and reduced zoom.
- `npm run build` from `frontend/` -- expected: production build succeeds.
