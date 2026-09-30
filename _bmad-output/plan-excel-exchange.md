---
title: 'Excel import and export for the displayed plan'
type: 'feature'
ticket: ''
created: '2026-09-30'
status: 'built'
baseline_revision: '1ae2e5596770869979da64e0cd772d64e7a16670'
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

**Problem:** Users can only view the seeded plan; they cannot bring their task list from Excel or download the displayed plan.

**Approach:** Add workbook exchange through FastAPI and React controls. Parse tasks into the existing chart contract and export the displayed tasks with their dependency relationships.

## Boundaries & Constraints

**Always:** Support the required columns задача, описание, исполнитель, длительность, предшественники. Reuse React, FastAPI and the existing task/date contract. Surface actionable import/export errors. Keep the seeded initial view and existing chart navigation working.

**Never:** Implement LLM/MCP chat or task-details editing in this slice. Treat the previous plan's frozen block as historical scope, not authorization to alter it.

**Decisions:**
- Count all calendar days, including weekends and holidays. When uploading a five-column workbook, prompt for a project start date using a labelled calendar date picker; require the user's choice before submitting. Root tasks start on that date, duration includes both endpoints, and successors start the day after the latest predecessor finishes.
- Use .xlsx and the first worksheet with the five Russian headers. The predecessors column contains task names, not task numbers, on both import and export; forward references are supported. Export optional `id`, `start_date`, `end_date` columns to retain exact IDs and dates. On reimport, validate and preserve supplied dates rather than silently rescheduling them; clearly explain this beside the date picker.
- Import atomically replaces the displayed plan only after the entire workbook passes validation. Errors preserve the current plan. Keep imported tasks in browser memory until reload, which restores the seed. Import returns Plan without server persistence; export receives the displayed Plan.
- Require unique task names after trimming surrounding whitespace, with case-sensitive matching. Reject duplicates with the conflicting row numbers; never guess which task a predecessor name identifies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Import | Valid workbook and scheduling inputs | Tasks render with calculated dates and resolved dependencies | Clear success result |
| Date selection | Five-column workbook without a chosen start date | Prompt with a calendar date picker; do not submit until selected | Cancel leaves the current plan unchanged |
| Invalid workbook | Corrupt file, missing headers, invalid duration or dates | No chart crash; explain offending sheet/row/column where possible | Actionable validation response |
| Invalid dependencies | Unknown predecessor, self-reference or cycle | No invalid schedule or recursive failure | Identify affected tasks |
| Duplicate names | Two task names match after trimming | Reject the import and preserve the current plan | Report the duplicate name and conflicting rows |
| Export | Currently displayed plan | Download a workbook matching the agreed contract | Preserve displayed data if download fails |
| Round trip | Export followed by import | Preserve agreed task fields, relationships and dates | Test both seeded and imported plans |
| Network failure | Import/export request fails | Usable controls and readable error; allow retry | No unhandled rejection |

</frozen-after-approval>

## Code Map

- `backend/app/main.py`: `Task`, `Plan`, `seeded_tasks`, `get_plan`; required ID, name, assignee, duration, start/end dates. GET builds a fresh seed; no storage exists. Dates are inclusive calendar days in the seed. No duration consistency or graph validation exists.
- `frontend/src/api.js`: `fetchPlan`, private `parseTask`, `API_URL`; canonical ISO dates validated, invalid IDs reported. Extend shared request handling rather than duplicate date validation.
- `frontend/src/App.jsx`: `state`, `loadPlan`; owns displayed tasks. Current fetch failure clears them, so file-operation failures need separate state.
- `frontend/src/components/GanttChart.jsx`: `GanttChart` derives bars from dates and connectors from IDs. No scheduler; missing references silently disappear. It renders one column per day, so imports need bounded date spans.
- `backend/tests/test_plan.py`, `frontend/src/App.test.jsx`: existing regression suites. The latter mocks fetch; layout test is not real browser coverage.
- `backend/requirements.txt`: no Excel or multipart dependency; `frontend/package.json` has Vitest and Testing Library.

## Tasks & Acceptance

**Execution:**
- [x] `backend/requirements.txt` — add pinned openpyxl and multipart support for server-side workbook processing.
- [x] `backend/app/excel.py` — implement workbook validation, reference resolution, scheduling and export serialization under the agreed contract. Bound file size, expanded workbook size, row count and chart date span; reject formulas as input and write user text as literal strings.
- [x] `backend/app/main.py` — expose import/export routes using the canonical Plan response and structured errors; implement the agreed state lifetime without cross-user shared mutable plans.
- [x] `backend/tests/test_excel.py` — exercise all matrix rows, multipart uploads, scheduling, graph failures, boundary limits and workbook round trips through actual route handlers.
- [x] `frontend/src/api.js` — add upload/download helpers; handle structured errors and Blob responses; release object URLs after downloading.
- [x] `frontend/src/App.jsx`, `frontend/src/components/ExcelControls.jsx`, `frontend/src/styles.css` — add file selection, scheduling inputs, export action and operation feedback. Keep controls accessible on narrow screens, prevent racing operations and allow reselecting the same file.
- [x] `frontend/src/ExcelControls.test.jsx`, `frontend/src/App.test.jsx` — test upload-to-chart flow, export of displayed tasks, validation/network failures, disabled/loading states and repeated file selection.
- [x] `README.md` — document workbook examples, scheduling/state semantics, launch and verification commands.

**Acceptance Criteria:**
- Given a five-column workbook, when the user starts importing it, then the UI asks for a calendar date and waits for selection before submitting.
- Given a task starting on Friday with duration three, when dates are calculated, then it finishes on Sunday and its successor starts on Monday.
- Given a running app, when a valid file is imported, then its tasks and dependencies are visible without restarting either server.
- Given an imported plan, when Export is selected, then the downloaded workbook represents the displayed plan rather than the seed.
- Given named predecessors, when importing and exporting a workbook, then references resolve to the correct tasks regardless of row order and exported predecessor cells contain names rather than numbers or IDs.
- Given an exported workbook, when it is reimported under the agreed rules, then task fields, dependencies and dates round-trip as specified.
- Given an invalid file or failed request, when processing ends, then the app shows an actionable error and allows another attempt.

## Design Notes

Keep internal API predecessor references as IDs; translate names at the workbook boundary using a complete name-to-ID index before resolving dependencies. Multiple names use comma-separated CSV syntax inside the Excel cell; quote names containing commas or quotes and use the same parser/serializer for round trips. Test forward references, unknown names, separator-containing names and the agreed duplicate policy.

## Implementation Notes

- Implemented stateless `POST /api/plan/import` (multipart file/start_date) and `POST /api/plan/export` (displayed Plan). Import buffers at most 2 MiB plus 64 KiB multipart overhead before parsing. Workbook limits: 2 MiB compressed, 20 MiB expanded, 1,000 ZIP entries, 500 data rows, 32 columns, 10,000 relationships and 730 calendar days.
- Name resolution uses a complete index, with iterative topological scheduling. Optional dates can be supplied per row in pairs; gaps are preserved. Undated tasks require the selected start date. CSV names support commas, quotes and embedded newlines. Export text is literal and exported archives meet the import size limits.
- Pinned openpyxl 3.1.5, python-multipart 0.0.20 (compatible with the existing Python 3.9 environment) and defusedxml 0.7.1 for XML parsing.
- React exchange state is separate from the displayed Plan; file errors preserve it. Controls require explicit date selection, serialize operations, support cancellation before submission/reselection, abort requests on unmount and release download object URLs.
- Updated the chart's ISO-date conversion to avoid JavaScript Date.UTC's special handling of years 0001–0099 for imported dates.

## Plan Change Log

## Review Triage Log

- Independent Quick review pending: no subagent tool is available in this session. A standalone review handoff is supplied in `plan-excel-exchange-quick.md`; no independent lens is recorded as run.
- Parent session subsequently ran the independent Quick lens. Counts: high 0, medium 1, low 0, false 0, maybe-false 0.
- `medium` → `patch`: `backend/app/excel.py` accepts predecessor text whose CSV-escaped export exceeds the Excel cell limit. Reproduced through routes: a name containing 17,000 quotes imports with HTTP 200 but exporting that Plan returns 422. Validate canonical serialized predecessor text during import using the existing text limit, before accepting the Plan.
- Fixed using a shared CSV serializer and import-time length validation. Added rejection tests and an exact-limit round-trip test; no review findings remain open. Removed the now-obsolete standalone review handoff after the independent lens completed.

## Verification

- Backend directory: `./.venv/bin/python -m pytest` — existing and Excel tests pass.
- Frontend directory: `npm test -- --run` and `npm run build` — tests and production build pass.
- Browser: import a dependency chain, export/reimport, attempt an invalid file, inspect controls at desktop and narrow viewport widths. Report any unavailable browser verification explicitly.

### Results — 2026-09-30

- Final verification after the review fix: backend **56 passed**, frontend **19 passed**, production build **passed**. Real-browser verification remains unavailable as noted below.

- `./.venv/bin/python -m pytest`: **53 passed** (49 Excel route cases plus 4 existing plan cases).
- `npm test -- --run`: **19 passed** across the App and ExcelControls suites.
- `npm run build`: **passed** (Vite production build).
- Matrix coverage: valid import and chart replacement; explicit date selection/cancel; malformed workbook/duration/date failures; unknown/self/cyclic references; duplicate rows; displayed-plan export/download and failures; seeded/imported/empty round trips; import/export network errors and retry. All corresponding automated tests ran and passed.
- Browser verification **not run**: no browser tool is exposed; `npm exec --no -- playwright --version` confirmed Playwright is not installed. DOM tests do not verify real download handling or desktop/narrow viewport rendering. README contains the manual browser checklist.
