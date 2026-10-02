---
title: 'Remove unsuccessful chat request retry fix'
type: 'chore'
ticket: ''
created: '2026-10-02'
status: 'in-review'
baseline_revision: '7dbb4899e75f3a5bcda12ad857a3553419462d9e'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The third chat fix, which added durable request-idempotency and later adjusted manual Retry, does not work acceptably and should no longer be part of the product.

**Approach:** Revert the third fix commits `7dbb489` and `ed91e76` in reverse order, returning all affected product code and tests to the exact `7efa67d` state while retaining the first two fixes from `27164b3` and `7efa67d`.

## Boundaries & Constraints

**Always:** Preserve the Enter/Shift+Enter behavior from `27164b3`; preserve automatic WebSocket reconnect from `7efa67d`; remove the request-idempotency migration, backend persistence/protocol changes, frontend same-request replay changes, tests, and planning artifacts introduced only by the third fix; use non-destructive revert commits so history remains auditable.

**Never:** Reset or rewrite branch history, revert either of the first two fixes, retain partial third-fix behavior, or downgrade the local database when it is already at the parent revision `20260930_02`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Current repository | `7dbb489` on top of `ed91e76`, `7efa67d`, and `27164b3` | Revert both third-fix commits and match the full `7efa67d` tree, apart from the new removal plan and revert history | Stop on any revert conflict rather than guessing |
| Local database | Alembic current revision is `20260930_02` | Remove migration file without running a downgrade | Document that any other database already at `20261002_03` must be downgraded before deploying the removal |

</frozen-after-approval>

## Code Map

- `7dbb489` -- follow-up manual Retry correction; revert first because it directly follows the main third-fix commit.
- `ed91e76` -- main third fix spanning chat request IDs, durable backend idempotency, migration, frontend replay, and their tests/artifacts.
- `frontend/src/components/PlanChat.jsx`, `frontend/src/api.js`, frontend tests -- must return to the automatic-reconnect implementation at `7efa67d`, retaining Enter submission and reconnect behavior.
- `backend/app/main.py`, `backend/app/repositories.py`, backend tests -- remove third-fix request ownership, fencing, replay, and persistence behavior.
- `backend/alembic/versions/20261002_03_chat_request_idempotency.py` -- remove the third-fix migration; local Alembic state was verified at its parent `20260930_02`.
- `_bmad-output/plan-chat-automatic-request-retry.md`, `_bmad-output/plan-chat-retry-preserves-pending-request.md`, `_bmad-output/deferred-work.md` -- reverse only content introduced by the removed commits while keeping this removal record.

## Tasks & Acceptance

**Execution:**
- [x] Repository history -- revert `7dbb489`, then `ed91e76`, preserving both earlier fixes and recording the removal without history rewriting.
- [x] Product tree -- verify all paths touched by those commits equal their `7efa67d` versions and no request-idempotency migration or partial retry implementation remains.
- [x] Backend and frontend -- run complete tests and the frontend production build to confirm the retained Enter and automatic reconnect behavior remains healthy.

**Acceptance Criteria:**
- Given the current branch, when the removal is complete, then `27164b3` and `7efa67d` remain in history and their behavior remains in the resulting source tree.
- Given the files introduced or changed by the third fix, when compared with `7efa67d`, then they are identical except for the new removal plan and revert commit metadata.
- Given the reverted product tree, when backend tests, frontend tests, and frontend build run, then they complete successfully.

## Implementation Notes

- Reverted `7dbb489` as `7b35b8f`, then reverted `ed91e76` as `c53c0d6`; both completed without conflicts.
- The local database was already at `20260930_02`, so no downgrade was run. Databases already upgraded to removed revision `20261002_03` must be downgraded before deploying this removal.

## Plan Change Log

- 2026-10-02: Completed both non-destructive reverts and verified the restored `7efa67d` product tree.

## Review Triage Log

- Quick review found no unmet acceptance criteria, broken repository rules, or actionable defects.

## Verification

**Commands:**
- `git diff --exit-code 7efa67d -- <third-fix paths>` -- expected: no product/test/migration differences remain.
- `./.venv/bin/python -m pytest` from `backend/` -- expected: retained backend suite passes.
- `npm test -- --run` from `frontend/` -- expected: retained frontend suite passes.
- `npm run build` from `frontend/` -- expected: production build succeeds.
- `./.venv/bin/alembic current` from `backend/` -- expected: local database remains at `20260930_02`.

**Results:**
- Third-fix path diff against `7efa67d`: clean.
- Backend: 95 passed, 1 skipped.
- Frontend: 58 passed.
- Frontend production build: passed.
- Alembic: `20260930_02 (head)`.
