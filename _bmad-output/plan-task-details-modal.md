---
title: 'Editable task details modal'
type: 'feature'
ticket: ''
created: '2026-10-01'
status: 'built'
baseline_revision: 'e139c0df44d289eac0c1c6484cc320fbde2a5a1f'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['ProjectDescription.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The chart does not respond when a user selects a task, so its full description and scheduling data cannot be inspected or edited outside the AI chat or Excel workflow.

**Approach:** Open an accessible modal from either the task label or timeline bar, let the user edit the task's core fields and predecessors, then validate and save the complete change as one new project-plan version through the existing deterministic plan service.

## Boundaries & Constraints

**Always:** Show name, description, assignee, duration, start/end dates and predecessors. Use task IDs for UI selection, preserve the current plan on cancellation or failure, enforce optimistic version checks, reuse canonical plan validation/rescheduling, serialize modal/Excel/chat/project operations, and support keyboard and narrow-screen use.

**Never:** Let the browser calculate authoritative schedule changes, bypass immutable plan versions, save partial edits, expose a task editor for legacy stateless plans, add deletion to this modal, or change the existing Excel/chat contracts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inspect | User activates a task label or bar | Modal shows current task details and named predecessors | No error expected |
| Save | Valid field and dependency changes at current version | Server validates, reschedules affected descendants, commits once, and chart refreshes | Keep modal input until success |
| Cancel | User presses Cancel, Escape, or closes the backdrop | Modal closes without a request or plan change | No error expected |
| Invalid edit | Empty required value, duplicate name, cycle, or impossible schedule | Existing plan/version remain active | Show actionable error in the modal |
| Concurrent edit | Plan changes before save completes | Stale modal result cannot overwrite current state | Show conflict and keep the current chart |
| Selection invalidation | Import, chat, undo, or project switch replaces/removes the selected task | Close the modal rather than displaying stale data | No stale task object retained |

</frozen-after-approval>

## Code Map

- `backend/app/plan_service.py` -- `PlanEditor.update()` and `.dependencies()` already provide deterministic edits and descendant rescheduling; compose them against one in-memory candidate before commit.
- `backend/app/main.py` -- add a typed authenticated project task-update route beside import/undo, mapping `PlanEditError`, `VersionConflict`, and ownership failures to safe HTTP errors.
- `backend/tests/test_chat.py` or a focused new route test -- reuse repository/agent fixtures to cover atomic save, rescheduling, invalid input, access, and stale versions.
- `frontend/src/api.js` -- reuse `request()`, workspace-token headers, strict `snapshot()` parsing, and `expected_version` conventions for task saves.
- `frontend/src/App.jsx` -- remain the sole owner of project/version/task state; select by ID, coordinate busy state, close stale selections, and atomically accept the returned snapshot.
- `frontend/src/components/GanttChart.jsx` -- expose both labels and bars as keyboard-operable task selectors without changing chart geometry.
- `frontend/src/components/TaskDetailsModal.jsx` -- new controlled accessible dialog with labelled fields, named predecessor choices, focus handling, local validation, pending state, and inline server errors.
- `frontend/src/App.test.jsx` and a focused modal test -- follow Testing Library role/label queries and mocked fetch patterns; assert failed/stale saves preserve the chart.
- `frontend/src/styles.css` -- extend the established green/orange visual language with trigger focus states and responsive dialog styling.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/main.py`, `backend/app/plan_service.py` -- add one atomic task-edit command and versioned route that reuses canonical validation and immutable commits.
- [x] `backend/tests/` -- cover valid metadata/schedule/dependency edits plus duplicate, cycle, stale-version, and unauthorized failures.
- [x] `frontend/src/api.js`, `frontend/src/App.jsx` -- connect modal selection and saving to project state while preventing races and stale replacement.
- [x] `frontend/src/components/GanttChart.jsx`, `frontend/src/components/TaskDetailsModal.jsx`, `frontend/src/styles.css` -- implement accessible chart triggers and responsive edit dialog.
- [x] `frontend/src/App.test.jsx`, `frontend/src/TaskDetailsModal.test.jsx` -- cover mouse/keyboard opening, details, cancel/Escape, successful save, validation, conflict, and selection invalidation.
- [x] `README.md`, `_bmad-output/deferred-work.md` -- document direct task editing and mark the final deferred product requirement as delivered without rewriting historical entries.

**Acceptance Criteria:**
- Given a persisted project task, when its label or bar is activated, then an accessible dialog displays all agreed task fields and resolves predecessor IDs to names.
- Given a valid edit, when Save completes, then one new immutable version is active and the updated/rescheduled plan is visible immediately.
- Given cancellation, invalid input, network failure, or a stale version, when the operation ends, then no partial task change appears in the chart.
- Given keyboard-only use or a 375px viewport, when the modal is opened and closed, then controls remain reachable, focus returns to the trigger, and the page does not overflow horizontally.

## Implementation Notes

- Added a version-checked `PATCH` route and one-command `PlanEditor.edit_task()` flow; task IDs remain arbitrary text, including path separators.
- The dialog selects tasks by ID, traps/restores focus, preserves input on failed saves, and submits predecessor IDs while displaying names.
- Quick review found four issues; all were patched before final verification. Manual real-browser viewport checks remain outstanding.

## Plan Change Log

## Review Triage Log

| Verdict | Route | Evidence |
|---|---|---|
| medium | patch | `PlanEditor.edit_task()` always reschedules descendants, so metadata-only saves collapse valid schedule gaps; compare scheduling fields before choosing the reschedule roots. |
| medium | patch | FastAPI decodes `%2F` before matching a plain `{task_id}` segment, while imported task IDs may legally contain `/`; use a path converter and cover the route. |
| medium | patch | Date arithmetic runs before canonical validation and can raise `OverflowError` for a valid ISO boundary date; translate it to `PlanEditError` so the route returns 422. |
| low | patch | Valid long predecessor names retain min-content width in the mobile grid; allow the label text to shrink and wrap inside the modal. |

## Design Notes

The modal submits one command containing all editable values. The backend resolves IDs against the current version, applies metadata/schedule and dependency changes to one candidate, validates once more, and performs one repository commit. End date is displayed read-only because it is derived from start date and duration.

## Verification

**Commands:**
- `cd backend && ./.venv/bin/python -m pytest` -- expected: all deterministic and route tests pass without provider calls.
- `cd frontend && npm test -- --run` -- expected: chart, modal, Excel, chat, and project tests pass.
- `cd frontend && npm run build` -- expected: production bundle succeeds.

**Manual checks (if no CLI):**
- Open/edit/cancel a task at desktop and 375px widths; verify focus restoration, predecessor names, descendant rescheduling, and unchanged state after a forced conflict.
