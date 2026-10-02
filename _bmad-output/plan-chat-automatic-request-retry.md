---
title: 'Automatically retry interrupted chat requests without duplicates'
type: 'bugfix'
ticket: ''
created: '2026-10-02'
status: 'built'
baseline_revision: '7efa67de83482ecdf9594ad83515b7f01df81217'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Retrying an interrupted chat request through the Retry button adds a second user message and requires another click. A connection loss can also occur after the server committed the result but before the client received it, so blindly resending may duplicate persisted history or processing.

**Approach:** Give each submitted request a stable client-generated ID, retain the unfinished request across automatic WebSocket reconnection, and resend it without appending another bubble. Make server processing and terminal persistence idempotent by that ID so reconnects recover either the original result or one safe retry.

## Boundaries & Constraints

**Always:** Keep one optimistic user bubble per request; preserve the same request ID, content, and expected version across retries; keep chat mutation locking active while recovery is pending; correlate terminal events before clearing pending state; atomically persist one user/assistant pair and any plan version; return a previously committed terminal result before stale-version rejection; support SQLite tests and PostgreSQL production migrations. Guarantee exactly-once durable plan/history effects; after a 30-second processing lease expires, a replacement provider call may briefly overlap a paused former call, but ownership fencing must reject every stale result.

**Never:** Allow two attempts to finalize one request, infer identity from message text, expose provider payloads, append pending/failed requests to persisted history, replay after authentication failure or component cleanup, or implement deletion of explicitly cancelled messages in this change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Interrupted before commit | In-flight request loses its socket | Reconnect sends the same request ID automatically; one user bubble remains | Retry ownership is released safely and processing resumes once |
| Commit response lost | Result and messages commit before disconnect | Repeated ID returns the stored terminal event and plan without another agent run or history row | Stored result wins before expected-version validation |
| Reconnect overlaps old work | Same ID arrives while its prior attempt is still owned | Recovery waits while the lease is healthy; after expiry, a new fenced owner may run and only its result can finalize | Stale owners cannot mutate plan or history |
| Clarification | Retried request produces no plan change | Exactly one user/assistant pair is committed and one clarification is shown | Pair and terminal result commit atomically |
| ID collision | Same ID has different immutable request fields | Reject as invalid request | Do not mutate plan or history |
| Terminal connection failure | Auth rejection/timeout or cleanup | Do not replay | Preserve safe disconnected/error state |

</frozen-after-approval>

## Code Map

- `frontend/src/components/PlanChat.jsx` -- owns optimistic transcript, pending request, reconnect lifecycle, busy lock, send/retry/cancel UI, and terminal event handling.
- `frontend/src/api.js` -- validates incoming complete plans and forwards WebSocket protocol events; preserve request correlation fields.
- `frontend/src/PlanChat.test.jsx`, `frontend/src/App.test.jsx` -- fake-socket coverage for reconnect, one bubble, replay payload, busy locking, stale sockets, and committed-result recovery.
- `backend/app/main.py` -- validates message frames, streams correlated events, runs/cancels agent tasks, and must replay durable terminal results before version checks.
- `backend/app/repositories.py` -- SQLAlchemy records and transactional project/message writes; add request claiming, release, and atomic terminal finalization.
- `backend/alembic/versions/20261002_03_chat_request_idempotency.py` -- durable request identity, immutable inputs, processing lease, status, and terminal response migration.
- `backend/tests/test_chat.py`, `backend/tests/test_repositories.py`, `backend/tests/test_postgres.py` -- protocol, race, atomicity, migration, and PostgreSQL coverage.

## Tasks & Acceptance

**Execution:**
- [x] `backend/alembic/versions/20261002_03_chat_request_idempotency.py`, `backend/app/repositories.py` -- add per-conversation request records with unique request IDs, immutable request fields, bounded processing ownership, and stored terminal responses; finalize changed plans or clarifications with exactly one message pair in the same transaction.
- [x] `backend/app/main.py`, `backend/app/repositories.py` -- require bounded request IDs, correlate progress/terminal events, claim before processing, replay completed results before stale checks, fence stale finalization, durably cancel the actual request owner from any duplicate waiter, release unfinished ownership on disconnect, and reject ID collisions without leaking internals.
- [x] `frontend/src/components/PlanChat.jsx`, `frontend/src/api.js` -- retain one pending request, automatically resend it after authenticated reconnect, preserve the optimistic bubble and busy lock, recover malformed uncorrelated frames through reconnect without discarding pending state, accept correlated cached completion despite the reconnect version advance, and remove the old manual draft-restoration retry path.
- [x] `backend/tests/test_chat.py`, `backend/tests/test_repositories.py`, `backend/tests/test_postgres.py` -- cover duplicate changed and clarification requests, healthy-lease single invocation, expired-lease stale-result fencing, collision rejection, durable cancellation from a duplicate waiter, atomic history, lost terminal response replay, and migration schema.
- [x] `frontend/src/PlanChat.test.jsx`, `frontend/src/App.test.jsx` -- cover same-ID automatic replay, one user bubble, no manual click, persistent busy lock, cached completion, malformed-frame recovery, repeated reconnects, stale-event rejection, and no replay on terminal disconnect/cleanup.

**Acceptance Criteria:**
- Given an in-flight chat request whose WebSocket drops, when reconnection authenticates, then the same request is retried automatically without another user bubble or click.
- Given the original attempt already committed before its response was lost, when the request ID is retried, then the stored result is returned and no second agent call, plan version, or message pair is created.
- Given the request is still processing or its former owner disappeared, when a duplicate ID arrives, then it waits during a healthy lease and may replace an expired owner while exactly one fenced result can mutate durable state.
- Given retry recovery reaches a terminal completion or clarification, when the UI handles it, then pending/busy state clears once and later stale events for that request cannot mutate the plan.

## Implementation Notes

- Added renewable 30-second ownership leases; loss of a lease cancels the local agent task before another owner can safely recover it.
- Durable terminal events contain only the validated plan or clarification fields already exposed by the WebSocket protocol.
- Correlated terminal failures retain the immutable request separately from active pending state, allowing explicit same-ID button retry without another optimistic bubble or automatic provider-error loops.
- Cancellation is now a durable terminal request state, so any waiter can fence the current owner and every later stale finalization resolves to the same cancellation event.
- Uncorrelated protocol failures close the affected socket and retain pending/busy state for authenticated automatic replay.

## Plan Change Log

- Review iteration 1: replaced the impossible absolute single-provider-call guarantee with the human-approved exactly-once durable-write guarantee and explicit lease-expiry fencing. Added protocol-error reconnect recovery and durable cancellation fencing so malformed frames or cancellation from a duplicate waiter cannot discard a request that may still commit. KEEP stable request IDs, one optimistic bubble, atomic terminal persistence, cached-result replay, healthy-lease waiting, stale-event rejection, and busy-lock preservation.

## Review Triage Log

- Quick review found no unmet acceptance criteria, broken repository rules, or actionable defects.
- Follow-up verification gaps resolved: normal-suite protocol coverage now overlaps two identical attempts, and focused UI coverage verifies same-ID manual retry with one bubble and a complete busy lifecycle.

| Verdict | Location | Evidence | Route |
|---|---|---|---|
| medium | `frontend/src/components/PlanChat.jsx`, `frontend/src/api.js` protocol-error handling | An uncorrelated malformed frame clears the pending request even though the server may still commit it, so the later valid completion is ignored. | patch after intent resolution |
| medium | `backend/app/repositories.py` expired-lease claim | Lease expiry can fence persistence but cannot prove a paused former process stopped its provider call before a new owner starts; the human selected exactly-once durable effects with bounded provider overlap after lease expiry. | intent_gap resolved by human decision |
| high | `backend/app/main.py` duplicate-waiter cancellation | Cancelling a waiting duplicate reports that nothing changed but does not cancel/fence the durable owner, which may still commit. | bad_plan, add durable cancellation semantics after intent resolution |
| medium | `backend/app/repositories.py` lease renewal | Renewal did not reject an already-expired lease, allowing a paused owner to resurrect itself and delay bounded recovery. | patch |
| medium | `frontend/src/components/PlanChat.jsx` retry/reconnect handling | A retained same-ID retry lost its only Retry UI when a later disconnect/reconnect replaced and cleared the error. | patch |

- Final patches reject late renewal of expired leases and preserve same-ID Retry state/UI across later reconnects.

- Review iteration 1 implementation check: all three logged findings are resolved; no additional unmet acceptance criteria or actionable defects were found.

## Design Notes

Request identity must be durable rather than text-based because identical prompts can be legitimate separate actions. Persist the complete safe terminal WebSocket event so a commit-before-disconnect race can be resolved without reconstructing provider output or running the model again.

## Verification

**Commands:**
- `./.venv/bin/python -m pytest` from `backend/` -- expected: all backend, repository, protocol, and migration tests pass without provider calls.
- `npm test -- --run` from `frontend/` -- expected: all chat/reconnect and application locking tests pass.
- `npm run build` from `frontend/` -- expected: production frontend build succeeds.
- `./.venv/bin/alembic upgrade head --sql` from `backend/` -- expected: offline PostgreSQL migration SQL includes the request-idempotency table and constraints.

**Results:** Backend focused chat/repository suites passed (23 passed); backend full suite passed (103 passed, 1 PostgreSQL integration test skipped because `TEST_DATABASE_URL` is unset); frontend focused chat/application suites passed (37 passed); frontend full suite passed (62 passed); production build passed; offline PostgreSQL migration SQL contains `chat_requests`, its unique constraint, lease fields, and JSONB terminal response.

- 2026-10-02 host verification: backend 101 passed/1 skipped, frontend 61 passed, production build passed, and PostgreSQL offline migration SQL generated through `20261002_03`.
- 2026-10-02 resumed verification: backend 103 passed/1 skipped, frontend 62 passed, production build passed, and PostgreSQL offline migration SQL generated through `20261002_03`.
- 2026-10-02 post-review verification: backend 105 passed/1 skipped, frontend 63 passed, production build passed, and PostgreSQL offline migration SQL generated through `20261002_03`.
