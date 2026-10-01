---
title: 'Render smooth S-shaped dependency arrows'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: '5e66285e768898b39bf2c412dc892cb220b981bb'
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

**Problem:** Orthogonal dependency connectors finish with a leftward segment when consecutive tasks have little horizontal space, making the arrowhead hard to see and visually point away from the dependent task.

**Approach:** Render each dependency as a smooth S-shaped curve that leaves the predecessor toward the right, bends down and left, then enters the dependent task toward the right at the exact center of its left edge.

</frozen-after-approval>

## Implementation Notes

This is a focused SVG path and regression-test change under 100 lines. Existing bar-edge anchors and marker alignment remain unchanged.

- Replaced the orthogonal route with a cubic Bezier whose start and end tangents both point right.
- Used a minimum 20px control offset that expands with the scheduling gap so every connector retains the requested right-left-right S shape.
- Updated geometry assertions at default and reduced zoom, including a dependency across a multi-day gap.
- Focused tests and production build pass after the review patch.

## Plan Change Log

## Review Triage Log

- `medium` -> `patch`: fixed control offsets only reversed horizontally for gaps under 40px; made the offset gap-aware and added a regression assertion for a multi-day gap.

## Verification

**Commands:**
- `npm test -- --run src/App.test.jsx` from `frontend/` -- expected: S-curve geometry and existing chart behavior pass.
- `npm run build` from `frontend/` -- expected: production build succeeds.
