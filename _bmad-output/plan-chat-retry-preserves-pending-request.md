---
title: 'Preserve pending chat request on manual Retry'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: 'ed91e769176428cb58ab257a74a6b0f221e5b315'
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

**Problem:** Clicking Retry around a WebSocket network failure can recreate the connection through effect cleanup, which clears the pending request before the replacement socket authenticates; no request is then sent.

**Approach:** Make manual Retry restart the socket connection without discarding the pending request, then replay the same request ID automatically after authentication with no duplicate chat bubble.

</frozen-after-approval>

## Implementation Notes

This is a focused correction to the existing reconnect lifecycle and fake-socket coverage. Preserve true unmount/project-change cleanup while allowing an intentional in-place reconnect to retain pending and retry state.

- Replaced state-driven manual reconnect with an imperative reconnect owned by the active socket effect, so cleanup remains reserved for actual component/project lifecycle changes.
- Added coverage for Retry both before and after the failed socket's close event, including same-ID replay, one bubble, retained busy state, and timer deduplication.
- Kept local operation state active across recoverable network errors so the composer stays disabled and Cancel remains available while the retained request is retried.

## Plan Change Log

## Review Triage Log

- `medium`, patched: a recoverable network error cleared local operation state despite retaining the pending request, enabling a second submission that could overwrite request correlation. Operation state now remains active, with UI assertions covering both sides of manual reconnect.

## Verification

**Commands:**
- `npm test -- --run src/PlanChat.test.jsx` from `frontend/` — expected: Retry before and after close reconnects immediately and replays the same pending payload once without a duplicate bubble.
- `npm test -- --run` from `frontend/` — expected: all frontend tests pass.
- `npm run build` from `frontend/` — expected: production frontend build succeeds.

- 2026-10-02: focused PlanChat suite passed (16 tests), full frontend suite passed (65 tests), and production build passed.
