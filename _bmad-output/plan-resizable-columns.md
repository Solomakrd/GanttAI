---
title: 'Add resizable workspace columns'
type: 'feature'
ticket: ''
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
baseline_revision: '51eef4db74e3cf515c06fbd13318638aae0dc7e3'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The redesigned workspace uses fixed widths for its major columns, so users cannot allocate space to long task names, a broad timeline, or the AI conversation according to their current work.

**Approach:** Add draggable, keyboard-accessible vertical separators for the selected column boundaries, clamp them to usable ranges, and integrate them with the existing responsive layout without changing project data or timeline zoom behavior.

## Boundaries & Constraints

**Always:** Keep task rows and timeline rows aligned; expose each handle as a focusable vertical separator with its current/minimum/maximum value; support pointer dragging, Arrow keys, Shift+Arrow, Home/End, and reset to the responsive default; prevent text selection while dragging; preserve the mobile Plan/AI tab experience and all existing task, chat, and Excel behavior.

**Never:** Resize individual calendar days through these handles, replace the existing zoom controls, allow either adjacent surface to become unusable, require backend changes, or show desktop split handles when the layout has collapsed to mobile tabs.

**Decisions:** Make all three practical boundaries resizable: task/owner within the task table, task table/timeline, and plan/AI assistant. Persist the resulting widths globally for this browser in a dedicated versioned local-storage preference, shared across projects.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pointer resize | User drags a visible separator | Adjacent columns resize continuously and the handle reports the new width | Clamp at configured bounds |
| Keyboard resize | Focused separator receives supported keys | Width changes by normal/large steps or jumps to a bound | Ignore unrelated keys |
| Small viewport | Workspace is at the mobile breakpoint | Desktop workspace split is absent; task/timeline layout remains usable | Responsive defaults override incompatible widths |
| Restored preference | Stored width is valid, malformed, or out of range | Valid width is restored; invalid width is clamped or discarded | Fall back to the responsive default |
| Reset | User invokes the documented reset gesture | The relevant boundary returns to its default width | No project or chat state is changed |

</frozen-after-approval>

## Code Map

- `frontend/src/App.jsx` -- owns the plan/assistant split and mobile tab state; place the workspace separator here and apply the assistant-width preference to `.workspace-frame`.
- `frontend/src/components/GanttChart.jsx` -- owns the task/owner and task-table/timeline splits and currently duplicates its 340px label width in `LABEL_WIDTH`; make both table widths adjustable and make the computed timeline width and CSS variables share state values.
- `frontend/src/styles.css` -- defines `--assistant`, `--task-column`, responsive defaults, sticky task table, and mobile collapse; add handle hit areas/states and breakpoint rules without breaking scrolling.
- `frontend/src/App.test.jsx` -- existing integration coverage for long plans and mobile state; add pointer/keyboard, clamping, reset, and preference restoration assertions.
- `frontend/src/components/PlanChat.jsx`, `frontend/src/api.js` -- behavioral boundaries; do not change chat lifecycle or API contracts.

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/App.jsx` -- manage the selected workspace widths, persistence, pointer/keyboard updates, reset behavior, and accessible separator markup while preserving mobile tabs.
- [x] `frontend/src/components/GanttChart.jsx` -- make the task/owner and task-table/timeline boundaries adjustable and use their widths consistently in CSS and total timeline sizing.
- [x] `frontend/src/styles.css` -- style unobtrusive but discoverable resize handles, dragging/focus states, bounds, cursor behavior, and mobile suppression.
- [x] `frontend/src/App.test.jsx` -- cover both input modes, bounds, reset, persistence validation, long-plan alignment, and the unchanged mobile surface behavior.

**Acceptance Criteria:**
- Given a desktop workspace, when a user drags or operates an enabled separator with the keyboard, then the intended boundary moves within safe limits and communicates its current value accessibly.
- Given a resized workspace, when the application remounts under the agreed persistence behavior, then the expected widths are restored without affecting project state.
- Given a mobile viewport, when the responsive breakpoint applies, then desktop-only resizing controls are unavailable and Plan/AI tabs remain usable.
- Given a long plan after task-column resizing, when the timeline is scrolled or zoomed, then task rows, bars, headers, and dependency geometry remain aligned.

## Implementation Notes

- Added a shared accessible separator for all three boundaries with pointer, Arrow, Shift+Arrow, Home/End, Enter/Space reset, and double-click reset interactions.
- Stored global versioned width preferences in local storage and validated/clamped them against the active viewport.
- Reserved at least 180px of desktop plan width for the timeline and switched entirely to responsive defaults at the mobile breakpoint.
- Verification completed with 43 passing tests and a successful Vite production build.

## Plan Change Log

## Review Triage Log

- `medium` / `patch` -- the fixed 600px task-table maximum can cover the full plan surface near the desktop breakpoint; derive its maximum from available plan width while preserving usable timeline space.
- `medium` / `patch` -- reset is only available by double-click, so keyboard-only users cannot restore a responsive default; support Enter/Space on the focused separator.
- `medium` / `patch` -- the long-plan test checks counts rather than scrolling and geometry; assert scroll state plus bar and dependency coordinates across resize/zoom.

## Design Notes

Prefer one small reusable separator component or tightly scoped hook only if it removes duplicated pointer/keyboard logic. Widths should remain CSS custom properties so the existing grid and sticky-column rules continue to own presentation. Calendar zoom remains an independent concern.

## Verification

**Commands:**
- `npm test -- --run` in `frontend/` -- expected: all Vitest suites pass, including resize interactions and existing regressions.
- `npm run build` in `frontend/` -- expected: Vite production build succeeds.

**Manual checks (if no CLI):**
- Inspect desktop dragging at minimum/default/maximum widths and verify mobile tabs at 820px and 320px without stray handles or clipped controls.
