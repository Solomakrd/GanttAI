---
title: 'Reset and undo chart controls'
type: 'feature'
ticket: ''
created: '2026-10-02'
status: 'built'
route: 'oneshot'
route_source: 'auto'
baseline_revision: '795db46d6976e041bba330264c9917deb4e050b2'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The “Fit plan” label does not describe that the control resets the timeline, and Undo is visually detached from the chart controls.

**Approach:** Rename the reset control to “Сброс”/“Reset” and place the existing icon-only Undo action beside it in the chart toolbar, preserving both actions' behavior and accessibility.

</frozen-after-approval>

## Implementation Notes

This is a localized, small JSX/CSS/test change with no API or state-management behavior changes, so it uses the oneshot route.
- Pass Undo into the chart as an optional action and render it immediately after the reset control.
- Remove the dedicated below-chart action row and restore the plan surface's two-row layout.
- Updated both locales, chart/App composition, obsolete CSS, and placement tests; all 62 frontend tests and the production build pass.

## Plan Change Log

## Review Triage Log

- `medium`, patched: the chart's early empty-state return hid Undo after deleting the final task; the toolbar now remains rendered for empty versioned plans and a regression test verifies the adjacent enabled Undo action.

## Verification

**Commands:**
- `npm test -- --run` from `frontend/` -- expected: frontend test suite passes.
- `npm run build` from `frontend/` -- expected: production bundle builds successfully.
