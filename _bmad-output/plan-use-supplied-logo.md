---
title: 'Use supplied logo'
type: 'feature'
ticket: ''
created: '2026-10-02'
status: 'built'
route: 'oneshot'
route_source: 'auto'
baseline_revision: '5e6bbacafc75fac86befca5eec85c6017c72c2a8'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The header still uses a generated CSS mark and text instead of the supplied GanttAI logo.

**Approach:** Copy the supplied image into the frontend's static assets and use it as the linked header brand, preserving the existing accessible home label and responsive layout.

</frozen-after-approval>

## Implementation Notes

This is a small static-asset and header-style replacement, so it uses the oneshot route.
- Added a web-sized copy at `frontend/public/ganttai-logo.png` and replaced the generated mark/text while preserving the home link's accessible name.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm test -- --run` from `frontend/` -- expected: frontend tests pass.
- `npm run build` from `frontend/` -- expected: production bundle includes the logo and builds successfully.
