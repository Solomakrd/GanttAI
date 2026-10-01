---
title: 'Render striped two-color dependency lines'
type: 'feature'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: 'ff9f0bdf7d0aac281b7e751344cddec1fa7873c4'
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

**Problem:** Dependency lines use one fixed color and an arrowhead, so they do not visually connect the colors of the related tasks.

**Approach:** Remove the arrowhead and render each existing S-shaped connector as alternating stripes: the source task's color followed by the dependent task's color, while preserving the exact edge-center anchors.

</frozen-after-approval>

## Implementation Notes

This is a focused SVG/CSS/test update under 100 lines. Two coincident paths will provide gap-free alternating source and target colors without changing dependency geometry.

- Carried each task's existing bar color into dependency geometry.
- Replaced the marker-ended path with a target-color underlay and source-color dashed overlay; the source color starts each stripe sequence.
- Updated the chart legend and regression tests for colors, stripe attributes, geometry, imports, and marker removal.
- Focused tests and production build pass.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm test -- --run src/App.test.jsx` from `frontend/` -- expected: connector colors, stripes, missing arrowhead, and geometry pass.
- `npm run build` from `frontend/` -- expected: production build succeeds.
