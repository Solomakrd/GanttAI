---
title: 'Recover from a stale workspace token'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
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

**Problem:** A workspace token persisted in browser storage becomes invalid after the database is reset or replaced. Initial loading and new-project creation then repeatedly receive `404 Workspace not found.`, leaving the application unusable.

**Approach:** Recognize the backend's specific stale-workspace response, discard the invalid identity, and retry project creation once without authentication so the browser receives and persists a fresh workspace token.

</frozen-after-approval>

## Implementation Notes

This is a focused API-client recovery change under 100 lines. Preserve normal server errors, abort behavior, and all valid-token workspace restoration behavior; only the specific `404 Workspace not found.` response may trigger the one-time unauthenticated recovery.

- Preserved response status on API errors so recovery can distinguish the backend's stale-workspace response from unrelated failures.
- Added one-time unauthenticated retries for workspace loading and project creation, with replacement-token persistence.
- Added application-level regression coverage for both recovery paths.
- Cleared project choices from the invalid workspace when an in-session project creation rotates the workspace identity.

## Plan Change Log

## Review Triage Log

- `medium` / `patch` -- confirmed that project creation recovery retained inaccessible project choices from the invalid workspace; the API result now marks workspace rotation and `App` replaces the project list, covered by the regression test.

## Verification

**Commands:**
- `npm test -- --run` in `frontend/` -- expected: existing tests plus stale-token loading and new-project recovery tests pass.
- `npm run build` in `frontend/` -- expected: Vite production build succeeds.
