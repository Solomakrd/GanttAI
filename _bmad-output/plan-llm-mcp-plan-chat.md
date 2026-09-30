---
title: 'LLM and MCP chat for atomic plan editing'
type: 'feature'
ticket: ''
created: '2026-09-30'
status: 'built'
baseline_revision: '18911cb00ba69e74437ffd4a8dcb25304534b2be'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['ProjectDescription.md', 'README.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users can view and exchange plans, but bulk edits still require changing source data manually. They need an adjacent chat that understands natural-language requests and updates the chart immediately.

**Approach:** Persist projects, versioned plans and chat history in PostgreSQL. Add a server-side OpenAI agent that modifies the current project plan only through allowlisted MCP tools; communicate over WebSockets so the UI can show reasoning-safe lifecycle/tool statuses, then validate and commit each candidate plan atomically.

## Boundaries & Constraints

**Always:** Use OpenAI with API credentials server-side. Use PostgreSQL transactions and migrations for projects, plan versions and chat messages. Reuse the existing Task/Plan contract, unique task names, inclusive calendar-day scheduling, graph validation and 500-task/730-day limits. Address edits by project ID plus expected version; PostgreSQL is authoritative after project creation/import. Stream only safe status events, tool names/results intended for users, the final response and validated Plan over WebSockets; never expose hidden reasoning. Preserve the old plan/version on provider, MCP, validation, cancellation, stale-response or network failure. Make chat and Excel operations unable to overwrite newer plan state. Provide deterministic mocked tests without live API spending.

**Never:** Let free-form model output mutate the plan, expose unrestricted code/files/network tools, store API keys/provider payloads in PostgreSQL, silently resolve version conflicts, or implement the task-details modal in this slice.

**Decisions:** Use the OpenAI Responses API with `OPENAI_API_KEY` and required configurable `OPENAI_MODEL`, a bounded timeout and no browser-visible key. Use internal MCP as the standardized allowlisted tool layer rather than exposing a public MCP endpoint. Apply each fully validated agent result automatically in one database transaction. Allow add, rename, describe, reassign, move, change duration/dependencies and delete; cascade descendants using calendar-day rules while preserving unrelated tasks. Use WebSockets for messages and user-safe lifecycle/tool statuses. Persist imported plans and subsequent versions in PostgreSQL.

Use an anonymous workspace token before account authentication exists: store only the token in the browser and its hash in PostgreSQL; it authorizes project/conversation access for the MVP. Persist the initial seed as a project. Each Excel import creates an immutable version in that project and adds a system chat message; “New project” creates a separate project. Retain every plan version without pruning in this release. Undo creates another immutable version from prior content rather than rewriting history.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Bulk edit | Valid request plus current Plan | MCP operations produce one validated replacement Plan and summary | Commit once; chart rerenders immediately |
| Clarification | Required edit information is missing/ambiguous | Assistant asks a question without changing tasks | Keep plan and conversation usable |
| Tool progress | Agent inspects or edits a plan | WebSocket emits bounded user-safe status/tool events | Never expose prompts, keys or hidden reasoning |
| Invalid proposal | Unknown task, duplicate name, cycle, impossible dates or limit breach | No partial edits | Explain affected task/request |
| Concurrent change | Excel/import or newer chat changes Plan while request runs | Older result cannot overwrite it | Mark stale and invite retry |
| Reload/reconnect | Existing project and conversation ID | Restore persisted current Plan and messages | Missing/inaccessible ID fails safely |
| Provider/MCP failure | Missing config, timeout, malformed tool call, cancellation | Current Plan remains intact | Safe user-facing error; no secret/provider payload leakage |
| Narrow viewport | Chat and timeline on mobile | Both remain operable and accessible | No page-level horizontal overflow |

</frozen-after-approval>

## Code Map

- `backend/app/main.py`: canonical `Task`, `Plan`, FastAPI routes; currently stateless and has no auth, WebSocket, LLM, MCP, database, project identity or request revision.
- `backend/app/excel.py`: `validate_schedule`, `ExcelError`, limits and graph/date rules are the strongest deterministic validation core; extract/generalize without changing Excel behavior.
- `frontend/src/App.jsx`: owns displayed `state.tasks`; migrate to a project ID/version plus a single update boundary shared by database load, Excel and chat.
- `frontend/src/api.js`: private `request` handles HTTP errors/abort; add WebSocket lifecycle and strict all-or-nothing Plan parsing while preserving HTTP Excel APIs.
- `frontend/src/components/GanttChart.jsx`: already rerenders from task props; no chart mutation API is needed.
- `frontend/src/components/ExcelControls.jsx`: precedent for AbortController, operation feedback and preserving tasks on failure; coordinate with an app-level operation/version guard.
- `backend/tests/`, `frontend/src/*.test.jsx`: existing atomic replacement, graph, scheduling, cancellation and fetch-mocking patterns.
- `backend/requirements.txt`, `.gitignore`: no LLM/MCP/settings SDK exists; `.env*` is ignored except `.env.example`.

## Tasks & Acceptance

**Execution:**
- [x] `docker-compose.yml`, `backend/app/db.py`, `backend/app/models.py`, `backend/alembic*`, `backend/requirements.txt`, `.env.example` — add PostgreSQL configuration, SQLAlchemy repositories and Alembic migrations for projects, immutable plan versions, conversations and messages; provide local/test database setup.
- [x] `backend/app/plan_service.py` — extract canonical validation/scheduling and deterministic typed operations for read, add, update, dependency changes, reassignment and delete; cascade affected descendants, generate collision-safe IDs and write a new version without mutating the prior one.
- [x] `backend/app/mcp_server.py` — implement an internal MCP tool server as the model's only plan-edit capability; expose no public MCP transport, constrain schemas/call count/payloads and keep deterministic services independently testable.
- [x] `backend/app/agent.py`, `backend/app/main.py`, `backend/app/repositories.py` — add OpenAI adapter, project/import/load APIs, WebSocket protocol, PostgreSQL conversation/plan persistence, optimistic version checks, MCP orchestration, timeout/cancellation and sanitized errors; automatically commit one final validated Plan version.
- [x] `backend/tests/test_plan_service.py`, `backend/tests/test_chat.py`, `backend/tests/test_mcp.py`, `backend/tests/test_repositories.py` — use isolated PostgreSQL tests and mocked OpenAI/MCP; cover migrations, every matrix row, persistence/reload, prompt/tool injection, transactional rollback, scheduling and version conflicts without provider calls.
- [x] `frontend/src/api.js`, `frontend/src/App.jsx`, `frontend/src/components/ExcelControls.jsx` — create/load persisted projects, save successful imports as new versions, manage reconnect-safe WebSocket events, send project/version, reject stale results and atomically refresh from validated server responses.
- [x] `frontend/src/components/PlanChat.jsx`, `frontend/src/styles.css` — add accessible adjacent transcript/composer, live operation/tool status, pending/cancel/retry/clarification states and responsive stacked layout.
- [x] `frontend/src/PlanChat.test.jsx`, `frontend/src/App.test.jsx` — cover successful chart update, failure preservation, stale requests, operation conflicts, cancellation and mobile-accessible controls.
- [x] `README.md` — document provider/MCP configuration, supported edit language, security boundaries, local run and mocked verification.

**Acceptance Criteria:**
- Given the displayed plan and a valid bulk request, when the agent completes, then all requested edits are applied automatically together, appear on the chart and are summarized by the assistant.
- Given a request to delete tasks, when deletion would leave valid remaining dependencies, then targets are removed and affected successors are rescheduled; otherwise the entire edit is rejected without partial changes.
- Given a running operation, when the agent invokes an allowlisted MCP tool, then the chat receives a user-safe WebSocket status without exposing hidden reasoning or credentials.
- Given an ambiguous request, when safe operation arguments cannot be formed, then the assistant asks for clarification and makes no plan change.
- Given any failed or stale request, when processing ends, then the exact pre-request Plan remains displayed and retry is available.
- Given no real provider credentials, when automated checks run, then all backend/frontend/MCP tests pass without outbound LLM calls.
- Given a successful Excel import or chat edit, when the page reloads with the same project identity, then the backend restores the latest persisted Plan and conversation.

## Implementation Notes

- Official `mcp==2.2.0` discovery and calls run through an in-process `MCPServer`/`Client`; protocol middleware enforces the strict allowlist and typed payloads.
- Anonymous ownership is stored once per workspace and supports listing, creating and restoring multiple projects with the same token.
- WebSocket credentials are sent in a size- and time-bounded first message, never in the URL.
- `backend/tests/test_postgres.py` runs the full migration chain, JSONB inspection and optimistic-lock check in a temporary PostgreSQL schema selected by `TEST_DATABASE_URL`.

## Plan Change Log

## Review Triage Log

| Verdict | Location | Evidence | Route |
|---|---|---|---|
| medium | `frontend/src/App.jsx:72-73,82` | `undoProject()` returns a snapshot whose token is null and which has no `workspaceProjects`; replacing all state therefore makes the next render dereference an absent list and loses chat credentials. | patch |
| medium | `backend/app/plan_service.py:120-126,62-64` | `update()` assigns an explicit dependent-task start, then `_commit()` unconditionally replaces it with the earliest dependency-valid date. | patch |
| medium | `backend/app/main.py:253-257,300-305` | Cancellation can be injected at the completion send after the synchronous commit; the handler then incorrectly reports that the persisted plan was unchanged. | patch |
| medium | `backend/app/agent.py:68-78` | The MCP SDK wraps deterministic `PlanEditError` exceptions as generic tool failures, and the adapter further reduces them to generic argument/processing errors, losing the affected task detail. | patch |
| low | `backend/app/agent.py:62-66` | A model-provided tool name is emitted before the allowlist check, so malformed provider output can put a non-allowlisted name into the status stream. | patch |
| high | `frontend/src/App.jsx:12,84-92`, `frontend/src/components/PlanChat.jsx:25-58` | Excel and chat share one boolean setter; a chat disconnect can clear an active Excel lock, permit project switching, and let the old project's late import replace the newly displayed state. | patch |

## Verification

- Backend: apply Alembic migrations to an isolated PostgreSQL database, then `./.venv/bin/python -m pytest` — all existing and new tests pass with provider network disabled.
- Frontend: `npm test -- --run` and `npm run build` — chat/chart behavior and production build pass.
- Manual: configure a development key, exercise clarification, multi-edit preview/apply/undo, Excel/chat race and narrow viewport; never record the key or provider payloads.
- 2026-09-30: Python 3.12 backend suite after review fixes: 84 passed, 1 PostgreSQL integration test skipped because `TEST_DATABASE_URL`/Docker was unavailable locally.
- 2026-09-30: frontend suite after review fixes: 27 passed; production build passed; Alembic PostgreSQL offline upgrade SQL generated through `20260930_02`.
- 2026-09-30: quick review completed; all six findings were fixed and no work was deferred.
