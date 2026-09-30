---
title: 'Interactive Gantt chart with seeded plan'
type: 'feature'
ticket: ''
created: '2026-09-30'
status: 'built'
baseline_revision: 'NO_VCS'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['/Users/tplaymeow/Desktop/GanttAI/ProjectDescription.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The project has no working application, while the first user-facing milestone is an immediately useful project view rather than an empty page.

**Approach:** Create a small React frontend backed by a FastAPI plan endpoint. The page loads a deterministic seeded task set and renders an interactive, horizontally scrollable Gantt timeline with task bars, dependencies, and basic navigation.

## Boundaries & Constraints

**Always:** Use React for the UI and Python/FastAPI for the plan API. Keep the task model compatible with the required Excel columns: task, description, assignee, duration, predecessors. Make the seeded response deterministic and provide loading and API-error states. Support desktop and narrow screens without hiding the timeline controls.

**Never:** Do not implement Excel import/export, LLM integration, MCP tools, task-detail modal, authentication, persistence, or collaborative editing in this slice. Do not invent external-provider credentials or add a database before a later slice requires it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Initial load | Browser opens the app | Seeded tasks and dependency lines appear in a readable timeline | Show a non-blocking loading state, then a clear API error with retry |
| Empty plan | API returns an empty task list | Timeline remains valid and explains that no tasks exist | No crash or invalid date calculations |
| Invalid task data | API returns a task with missing/invalid dates | Valid tasks render; invalid record is excluded and surfaced as an error | Keep the page usable and identify the rejected record |
| Narrow viewport | Viewport below desktop width | Task labels remain accessible and timeline can scroll horizontally | No horizontal overflow outside the chart region |

</frozen-after-approval>

## Code Map

- `ProjectDescription.md` -- source requirements and mandatory stack; no application code exists yet.
- `frontend/` -- new React application boundary for chart state, layout, styling, and API client.
- `backend/` -- new FastAPI application boundary for the seeded plan endpoint and validation model.
- `frontend/src/` and `backend/tests/` -- new unit/integration test locations for rendering, API shape, and edge cases.

## Tasks & Acceptance

**Execution:**
- [ ] `backend/` -- create the FastAPI app, typed task/dependency schema, deterministic seed data, CORS configuration, and `GET /api/plan` endpoint -- provide a stable source for the chart.
- [ ] `backend/tests/` -- test the seeded response, schema validation, and empty/invalid data behavior -- protect the API contract.
- [ ] `frontend/` -- scaffold the React app, API client, responsive shell, loading/error states, and seeded-plan rendering -- deliver the usable page.
- [ ] `frontend/src/components/GanttChart.*` -- render date columns, task rows, bars, and predecessor connectors from API data -- make dependencies visible without hard-coded task positions.
- [ ] `frontend/src/` -- add responsive styling and chart interaction such as horizontal scrolling and fit-to-plan navigation -- keep the timeline usable on desktop and mobile.
- [ ] `frontend/` -- add component tests for successful load, API failure, empty data, invalid records, and narrow layout -- cover the matrix above.

**Acceptance Criteria:**
- Given the backend is running, when the browser opens the root page, then a seeded project plan is visible without manual data entry.
- Given tasks with predecessors, when the chart renders, then each valid predecessor relationship is represented between the corresponding task rows.
- Given the API is unavailable, when the page loads, then the user sees a retryable error state rather than a blank or crashed page.
- Given a narrow viewport, when the user views the chart, then the chart area scrolls horizontally while the surrounding page remains usable.
- Given the required test commands are run, when all tests finish, then backend and frontend checks pass.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `high` -> `patch`: `frontend/src/api.js:4-9` accepted non-string and normalized dates, allowing `GanttChart` to call `.slice` on a number; fix by rejecting malformed date types and non-round-trippable dates before rendering.
- `medium` -> `patch`: `frontend/src/api.js:18-22` and `frontend/src/App.jsx:24` reduced invalid records to a count, so users could not identify rejected records; preserve rejected record IDs in the load result and display them.

## Design Notes

Keep the API model as the source of truth for task identity, dates, duration, assignee, and predecessors. The chart should derive its date scale and bar positions from the returned data so later Excel and chat slices can reuse the same contract.

## Verification

**Commands:**
- `cd backend && pytest` -- expected: API and validation tests pass.
- `cd frontend && npm test -- --run` -- expected: component and state tests pass.
- `cd frontend && npm run build` -- expected: production build succeeds.

**Manual checks (if no CLI):**
- Open the app with the API running, confirm seeded bars and dependency connectors, resize to a narrow viewport, and verify only the chart timeline scrolls.
