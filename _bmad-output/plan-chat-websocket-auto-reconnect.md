---
title: 'Automatically reconnect chat WebSocket'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: '27164b3a4698dfefb767b91a3c1851a1144c0ca9'
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

**Problem:** When the chat WebSocket connection drops, the chat remains disconnected until the user manually presses Retry.

**Approach:** Automatically reconnect unexpected connection losses with bounded backoff while preventing stale sockets, cleanup closes, and authentication failures from creating reconnect loops. Do not automatically resend the last chat request in this change.

</frozen-after-approval>

## Implementation Notes

This is a focused client lifecycle change in the existing connection effect and WebSocket adapter, with fake-timer regression coverage. Preserve manual Retry as an immediate reconnect option and keep request replay deferred.

- Added bounded exponential reconnect scheduling owned by the chat effect, with reset after an authenticated connection and cleanup/stale-socket guards.
- Propagated WebSocket close codes so rejected authentication does not create an infinite reconnect loop.
- Added fake-timer coverage for automatic reconnect, no request replay, stale event suppression, backoff, authentication rejection, and cleanup.
- Kept close-code propagation tolerant of existing socket adapters that invoke close callbacks without an event object.
- Kept the composer unavailable when reconnection reveals a newer persisted server version, avoiding stale follow-up requests until the page reloads.
- Treated both rejected authentication and authentication timeout close codes as terminal failures.

## Plan Change Log

## Review Triage Log

| Verdict | Location | Evidence | Route |
|---|---|---|---|
| medium | `frontend/src/components/PlanChat.jsx` connected handler | A request can commit before its completion event is lost; accepting a reconnected server version newer than the displayed plan enabled guaranteed-stale follow-up requests. The composer now remains disabled and shows the existing reload guidance on any version mismatch. | patch |
| medium | `frontend/src/components/PlanChat.jsx` disconnect handler | Backend auth timeout code `4408` was reconnectable and could loop indefinitely just like rejected-auth code `4401`; both are now terminal. | patch |

## Verification

**Commands:**
- `npm test -- --run src/PlanChat.test.jsx` from `frontend/` — expected: automatic reconnect, backoff, terminal-auth, cleanup, and existing chat behavior pass.
- `npm test -- --run` from `frontend/` — expected: the complete frontend test suite passes.
- `npm run build` from `frontend/` — expected: production frontend build succeeds.

- 2026-10-02: focused chat suite passed (8 tests), full frontend suite passed (57 tests), and production Vite build passed.
- 2026-10-02: post-review focused suite passed (9 tests), full frontend suite passed (58 tests), and production build passed.
