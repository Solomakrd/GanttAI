---
title: 'Project workspace authoring'
type: 'feature'
ticket: ''
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
baseline_revision: '113e0590869cfd183d981e80733015fedbc3ebed'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Projects have only generated ordinal labels and cannot be removed, tasks cannot be added manually, and the timeline gives no indication of the current day. Users need to manage named project spaces, populate them through any supported tool, and orient themselves in time.

**Approach:** Name the automatically created seeded first project “Ознакомительный проект”, while making user-created projects named and empty; add persistent project navigation/rename/delete with destructive confirmation, a versioned manual task-creation path reusing the task modal, and a local-calendar today marker based on the supplied design.

## Boundaries & Constraints

**Always:** Keep the initial no-workspace bootstrap seeded exactly as today and name that project “Ознакомительный проект”. A project created inside an existing workspace requires a trimmed 1–64 character name and starts with zero tasks. Renaming is metadata-only and is not part of plan undo. The icon-only project-delete action sits beside Add project and opens an accessible confirmation that explains permanent loss of tasks, versions, and chat history. Deleting the last project atomically replaces it with a new seeded “Ознакомительный проект” in the same workspace. Manual creation uses workspace authorization, expected-version locking, ID-based predecessors, canonical plan validation, and one new plan version. The today marker uses the user's local calendar day, appears only inside the plan range, and never changes that range.

**Never:** Do not add compatibility behavior for pre-feature project data, add project reordering, make project deletion recoverable through plan Undo, persist the active project in URLs/storage, auto-reschedule a manually entered task from its predecessors, or replace the established visual system with the prototype wholesale.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| First visit | No workspace token | Seeded project opens with localized ordinal fallback | Existing load recovery remains intact |
| New project | Valid workspace and name | Empty named project becomes active and can use task, AI, or Excel tools | Invalid name stays editable; request failure preserves current project |
| Rename | Existing project | Name updates everywhere without changing plan version | Failure preserves draft and plan |
| Delete | Current project and confirmation | Project aggregate is permanently removed and a deterministic remaining project becomes active | Cancel/failure preserves state; deleting the last creates a fresh seeded introductory project |
| Add task | Empty or populated project | Server creates ID/end date, validates dependencies, increments version once | 401/404/409/422/network errors preserve modal draft and chart |
| Today | Local day inside/outside range | Marker is centered on the matching day, zooms, and refreshes after midnight/focus; otherwise hidden | No timeline expansion |

</frozen-after-approval>

## Code Map

- `backend/alembic/versions/` -- reset pre-production workspace data and add required 64-character project names without legacy compatibility paths.
- `backend/app/models.py`, `backend/app/repositories.py` -- carry required names through snapshots; persist rename/create/delete metadata without touching plan versions; select or seed a deterministic replacement after deletion.
- `backend/app/main.py`, `backend/app/plan_service.py` -- seeded introductory naming, named empty-project semantics, rename/delete routes, and authenticated/versioned ID-based task creation while preserving MCP name-based add behavior.
- `frontend/src/api.js`, `frontend/src/App.jsx` -- parse names, create/rename/delete projects with confirmation, create tasks, and atomically maintain workspace/project versions.
- `frontend/src/components/TaskDetailsModal.jsx` -- reuse accessible edit modal in create mode; default start to earliest project date, or local today for an empty plan.
- `frontend/src/components/GanttChart.jsx`, `frontend/src/styles.css` -- persistent Add task action, named-project controls/modals, responsive layout, and noninteractive today line.
- `frontend/src/locales/{ru,en}.js` -- all project, task-create, empty-state, and today labels.
- `backend/tests/`, `frontend/src/*.test.*`, `README.md` -- persistence/API/domain/UI regression coverage and endpoint documentation.

## Tasks & Acceptance

**Execution:**
- [x] `backend/alembic/versions/`, `backend/app/{models,repositories,main}.py` -- reset pre-production workspace data, persist required names, create named empty secondary projects, rename metadata, and hard-delete authorized project aggregates safely.
- [x] `backend/app/{main,plan_service}.py` -- add versioned manual task creation and share validation without changing MCP behavior.
- [x] `frontend/src/{api,App}.js*`, `frontend/src/components/TaskDetailsModal.jsx` -- implement project dialogs/navigation/deletion confirmation and create-mode task flow with draft/focus preservation.
- [x] `frontend/src/components/GanttChart.jsx`, `frontend/src/styles.css`, locale files -- add responsive task action and local-day marker matching the design language.
- [x] Backend/frontend tests and `README.md` -- cover the matrix, migration contract, localization, accessibility, and API usage.

**Acceptance Criteria:**
- Given a new browser workspace, when it first loads, then the existing seeded plan appears and remains usable.
- Given that workspace, when a named project is created, then it opens empty and supports manual creation, AI chat, Excel import/export, switching, and rename.
- Given more than one project, when deletion is confirmed, then its plans and chat are permanently removed and a remaining project opens; cancellation or failure changes nothing.
- Given the only project, when deletion is confirmed, then it is permanently removed and a fresh seeded “Ознакомительный проект” opens under the same workspace token.
- Given a valid task form, when it is submitted, then exactly one version is created and Undo can revert it.
- Given today within the displayed plan dates, when the chart loads or zooms, then a localized marker remains aligned to that day; when outside, no marker appears.
- Given desktop or mobile widths, when project/task controls and dialogs are used by keyboard, then controls remain reachable, labeled, focus-managed, and non-clipped.

## Implementation Notes

- Added required project names, empty secondary projects, metadata rename, cascade deletion with introductory reseeding, and a pre-production data-reset migration.
- Reused the task modal for versioned manual creation and added the local-calendar Today marker without expanding plan ranges.
- Hardened mobile control overflow, destructive-dialog accessibility, final-day marker placement, and failure-state draft preservation during review.
- Verification: backend 117 passed / 1 PostgreSQL-only skipped; frontend 70 passed; production build, Compose config, migrated Docker stack, and proxied project bootstrap all passed.

## Plan Change Log

## Review Triage Log

| Verdict | Route | Finding | Evidence |
|---------|-------|---------|----------|
| medium | patch | Project name length was validated before trimming. | Verified in `backend/app/main.py`; padded valid names could fail the trimmed 1–64 contract. Validation now trims in a before-validator and a regression covers a padded 64-character name. |
| medium | patch | Named-project creation recovered a stale token by creating a seeded introductory workspace. | Verified in `frontend/src/api.js` and `backend/app/main.py`; the tokenless retry cannot preserve the requested empty named project and violates failure-state preservation. |
| medium | patch | Chart controls could be clipped at 320px. | Verified from the fixed-width controls and hidden overflow in `frontend/src/styles.css`; the mobile toolbar needs an independently scrollable control row. |
| low | patch | The project input applied the 64-unit browser limit before trimming. | Verified in `frontend/src/App.jsx`; removing the premature DOM limit lets the server enforce the approved trimmed Unicode-character contract consistently. |
| medium | patch | The destructive warning was not associated with its alert dialog. | Verified in `frontend/src/App.jsx`; visible warning text lacked `aria-describedby`, so assistive technology was not guaranteed to announce it with the dialog. |
| low | patch | The Today badge was clipped on the final displayed day. | Verified from final-day marker geometry and `.plot` overflow; the final-day label needs to open leftward while its line remains centered. |

## Design Notes

Use `/Users/tplaymeow/Downloads/gantt.designe.index.html` as visual reference for the named-project picker, rename/create dialog, task form, and today line. Top-bar order places icon-only Delete project beside Add project. Chart control order is Zoom out, percentage, Zoom in, Reset, Add task, then icon-only Undo. Project names may duplicate because identity is the project ID.

## Verification

**Commands:**
- `backend/.venv/bin/pytest` -- backend repository, migration, route, task-domain, authorization, and concurrency tests pass.
- `npm test -- --run` in `frontend/` -- UI/API/localization/accessibility regressions pass.
- `npm run build` in `frontend/` -- production bundle succeeds.
- `docker compose config --quiet` with required environment -- deployment configuration remains valid.
