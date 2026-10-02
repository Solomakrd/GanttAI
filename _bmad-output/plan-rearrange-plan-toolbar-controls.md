---
title: 'Rearrange plan toolbar controls'
type: 'feature'
ticket: ''
created: '2026-10-02'
status: 'built'
route: 'oneshot'
route_source: 'auto'
baseline_revision: '06ed00b6a7c8d35152bd9ef9a3e98737bf34dc23'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Add task and Undo actions sit with the zoom controls on the right, while long project names have too little room in the project selector.

**Approach:** Place Add task and Undo beside the “План работ” heading, leave only zoom/reset controls on the right, and slightly widen the desktop project selector while preserving responsive sizing.

</frozen-after-approval>

## Implementation Notes

This is a small JSX/CSS/test adjustment with no behavior, API, or state-management changes, so it uses the oneshot route. Native selects do not reliably wrap their selected value, so the selector was widened rather than replaced with a custom control.
- Added a dedicated left-side action group beside the chart heading and kept zoom/reset in the right-side control group.
- Updated narrow-screen layout to stack the action and zoom groups without horizontal toolbar scrolling.
- Widened the desktop project selector from 210px to 250px while retaining existing responsive width limits.
- Updated placement assertions; all 71 frontend tests and the production build pass.

## Plan Change Log

## Review Triage Log

- `medium`, patched: viewport-only stacking could let the two toolbar groups overflow when the assistant narrowed the plan pane; the toolbar now uses a container query based on the chart's actual width.

## Verification

**Commands:**
- `npm test -- --run` from `frontend/` -- expected: frontend test suite passes.
- `npm run build` from `frontend/` -- expected: production bundle builds successfully.
