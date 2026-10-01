---
title: 'Adapt reference workspace design'
type: 'feature'
ticket: ''
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
baseline_revision: '0b77141dc2db24b1c7da91057568756957e3dfc2'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current editorial landing-page treatment separates core controls from the Gantt workspace and does not match the supplied product-interface reference. The application needs a denser, full-height planning workspace that makes the timeline and AI assistant the primary surfaces.

**Approach:** Adapt the visual language and responsive structure of `/Users/tplaymeow/Downloads/gantt.designe.index.html` to the existing React application, while retaining the application's real data model, dynamic dates, accessibility, and all current project, Excel, chat, and task-editing behavior.

## Boundaries & Constraints

**Always:** Preserve startup/retry behavior, workspace identity, project creation/switching, undo, version conflict protection, dynamic and empty plans, Excel validation/import/export, WebSocket lifecycle and cancellation, task-modal focus behavior, and independent busy locks. Keep desktop and mobile usable, with a dedicated Plan/AI switch on narrow screens.

**Never:** Copy the reference's mutable demo data or imperative script; hard-code its sample project, fixed dates, task count, or 30-day duration limit; alter backend/API contracts; expose the workspace token; or present unsupported project rename/manual task creation as working features.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Loaded workspace | Versioned project with tasks | Compact task table and date grid appear beside the persistent AI panel | Existing data remains the source of truth |
| Narrow viewport | Width at or below tablet breakpoint | Header compacts and Plan/AI tabs expose one usable surface at a time | No hidden operation or lost draft |
| Empty/loading/error | No tasks, pending API, or failed API | The redesigned workspace shows an appropriate usable state | Retry and notices retain current semantics |
| Long plan | Many tasks or broad date range | Sticky task column and horizontally scrollable timeline remain aligned | Controls and task editing remain reachable |
| Import/chat/task operation | Pending or failed mutation | Relevant progress/error state appears in the new shell | Other operations cannot incorrectly unlock the app |

</frozen-after-approval>

## Code Map

- `frontend/src/App.jsx` -- owns workspace loading, versioned mutations, project switching, top-level layout, notices, and modal selection; restructure markup without changing state transitions.
- `frontend/src/components/GanttChart.jsx` -- computes UTC date positions and dependency geometry; retain calculations while mapping output to the reference task-table/timeline treatment.
- `frontend/src/components/PlanChat.jsx` -- owns authenticated WebSocket state, transcript, cancellation, retry, and composer; retain event handling while adopting assistant-panel presentation.
- `frontend/src/components/ExcelControls.jsx` -- owns file/date validation and import/export request lifecycle; expose topbar actions and a reference-style import dialog without changing request semantics.
- `frontend/src/components/TaskDetailsModal.jsx` -- owns validation, focus trap/restoration, and atomic save; restyle and localize presentation only.
- `frontend/src/styles.css` -- replace the existing editorial design system with reference-derived tokens, full-height layout, sticky Gantt panes, dialogs, and responsive Plan/AI switching.
- `frontend/index.html` -- align title and theme metadata with the redesigned shell.
- `frontend/src/*.test.jsx` -- preserve behavioral coverage and adjust only presentation-dependent accessible labels/selectors; add mobile-tab coverage where practical.
- `frontend/src/api.js` -- behavioral boundary; do not modify.

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/App.jsx`, `frontend/src/components/ExcelControls.jsx` -- compose the full-height header/workspace shell, project controls, Excel actions/dialog, status notices, and mobile surface switch around existing handlers.
- [x] `frontend/src/components/GanttChart.jsx` -- render the dynamic plan as a compact sticky task table and calendar grid with colored bars, dependencies, weekends, range, zoom, and empty state.
- [x] `frontend/src/components/PlanChat.jsx`, `frontend/src/components/TaskDetailsModal.jsx` -- adapt assistant and task-dialog markup while preserving asynchronous and accessibility contracts.
- [x] `frontend/src/styles.css`, `frontend/index.html` -- implement the reference-derived visual system and desktop/mobile layouts without fixed demo dimensions that cap real plans.
- [x] `frontend/src/*.test.jsx` -- update presentation-sensitive assertions and verify mobile navigation while retaining all existing operation, error, conflict, and focus tests.

**Acceptance Criteria:**
- Given a loaded project, when the workspace renders on desktop, then the compact dynamic Gantt and AI assistant occupy the primary split workspace and all existing project/Excel/task/chat actions remain available.
- Given a viewport narrower than the desktop breakpoint, when the user selects Plan or AI assistant, then only the chosen surface is foregrounded without remounting it or losing its current state.
- Given keyboard-only use, when controls, task rows, dialogs, and chat are operated, then focus is visible, modal focus remains trapped/restored, and accessible names continue to describe each action.
- Given the existing test fixtures and API mocks, when the frontend suite and production build run, then all behavioral tests pass and Vite completes without errors.

## Implementation Notes

- Replaced the editorial landing layout with a full-height planning shell while leaving API and versioning code unchanged.
- Preserved both mobile surfaces in the DOM so switching tabs does not discard chat state.
- Added focused coverage for long plans, mobile state retention, notice stacking, and import-dialog focus restoration.
- Verification completed with 38 passing tests and a successful Vite production build.

## Plan Change Log

## Review Triage Log

- `medium` / `patch` -- `ExcelControls.jsx` renders failed-import feedback below a z-index 50 backdrop at z-index 40, so a real error can be hidden while its dialog remains open; raise feedback above the modal layer.
- `medium` / `patch` -- the import dialog focuses a visually hidden 1x1 file input on open and after operation state changes, violating visible-focus behavior; focus a visible dialog control instead.
- `medium` / `patch` -- the 290px sticky task column leaves an unusable timeline sliver at the supported 320px width; compact the mobile task column/content enough to keep timeline interaction reachable.
- `medium` / `patch` -- simultaneous operational and rejected-record notices share the same fixed position and overlap; offset adjacent notices so both remain visible.
- `low` / `patch` -- mobile surface controls use `aria-selected` without tab roles, so assistive technology cannot interpret their active state; add tablist/tab semantics and panel relationships.

## Design Notes

Treat the reference as a visual and interaction specification, not a source implementation. Keep project labels derived from available workspace order because the backend currently exposes IDs and versions, not editable names. Prefer small inline SVG icon primitives over a new icon dependency.

## Verification

**Commands:**
- `npm test -- --run` in `frontend/` -- expected: all Vitest suites pass.
- `npm run build` in `frontend/` -- expected: Vite production build succeeds.

**Manual checks (if no CLI):**
- Inspect desktop and mobile widths for aligned Gantt rows, horizontal timeline scrolling, Plan/AI switching, dialog scrolling, and no clipped topbar actions.
