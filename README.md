# GanttAI

React Gantt timeline backed by FastAPI and PostgreSQL. The initial project contains a deterministic five-task seed. Import/export Excel or use the adjacent OpenRouter/MCP chat to apply validated bulk edits as immutable plan versions.

## Run locally

Python 3.10+, a current Node.js LTS release, Docker, and an OpenRouter API key are required for the complete application.

```sh
cp .env.example .env
docker compose up -d postgres
```

Set `OPENROUTER_API_KEY` and the required OpenRouter model slug in `OPENROUTER_MODEL` (for example, `openai/gpt-5-mini`) in the server environment. Requests use `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`. The key is used only by FastAPI and is never sent to or stored by the browser/database. Then migrate and run the API:

```sh
cd backend
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
set -a; source ../.env; set +a
./.venv/bin/alembic upgrade head
./.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open `http://localhost:5173` (or `http://127.0.0.1:5173`). The default API URL is `http://localhost:8000`; set `VITE_API_URL` when using another address. The local API permits these two frontend origins. Interactive API documentation is at `http://localhost:8000/docs`.

## Workbook contract

Use `.xlsx`. The **first worksheet**, starting at row 1, must have these five Russian headers; their order may vary:

| задача | описание | исполнитель | длительность | предшественники |
| --- | --- | --- | --- | --- |
| Research | Understand the problem | Maya | 3 | |
| Prototype | Build a draft | Leo | 2 | Research |
| Review | Review both streams | Noah | 1 | Research, Prototype |

Choose the file, select a **Project start date** using the calendar picker, then select **Import plan**. No request is sent until a date is chosen. Cancel keeps the displayed plan.

- Duration is a positive whole **numeric cell**, measured in inclusive calendar days. Weekends and holidays count. Starting `2026-10-02` (Friday) with duration 3 finishes Sunday `2026-10-04`; its successor starts Monday `2026-10-05`.
- Root tasks start on the chosen date. Successors start the day after their latest predecessor finishes. Forward references are supported; worksheet row order is preserved in the chart.
- Task names are trimmed and must be unique, with case-sensitive matching. Duplicate errors identify both conflicting row numbers. Assignees must be non-empty; descriptions and predecessors may be blank.
- Predecessors are **task names**, never task numbers or IDs. Multiple names use CSV syntax **inside one cell**: `Research, Prototype`. For names containing commas or quotes, use `"Design, review","Say ""go"""`. Unknown names, repeated predecessors, self-references and dependency cycles are rejected.
- Blank and whitespace-only rows are ignored, including formatted empty rows and gaps between tasks; they do not count toward the 500-task limit. Errors still refer to original worksheet row numbers. Formulas and Excel error cells are rejected; paste values before uploading. Exported user text is written as literal strings, including values beginning with `=`.

### Export and reimport

**Export Excel** downloads `gantt-plan.xlsx` containing the displayed plan, including imported tasks. It includes the five required headers plus optional `id`, `start_date`, and `end_date` columns. Predecessors remain names.

On reimport:

- Supplied IDs are preserved and must be unique. Blank/missing IDs receive generated IDs.
- Supply dates as `YYYY-MM-DD` text or Excel date cells without a time. Supply **both dates per row or leave both blank**. Fully dated exports can also be imported via the API without a project start date; the UI always asks for a date, which only schedules undated tasks.
- Supplied dates are **validated and preserved**, even if another project start date is selected. Their inclusive range must match duration, and every successor must start after its predecessors finish. Gaps are allowed. Invalid dates are rejected rather than silently rescheduled.
- Imports are atomic. A validation or network error keeps the current chart and allows retry. File selection can be repeated with the same filename after corrections.

Imported plans are saved as immutable versions in the active PostgreSQL project. Reload restores the workspace's project list plus its latest project and conversation. The browser stores only one anonymous workspace token; PostgreSQL stores its SHA-256 hash on the workspace, which may own multiple projects. **New project** adds a seeded project without replacing the token, and the project selector restores earlier projects. Concurrent Excel/chat results use an expected version and cannot overwrite newer state.

## Plan chat

The assistant supports adding, renaming, describing, reassigning, moving, resizing and deleting tasks, plus replacing dependencies. Dates are inclusive calendar days. Schedule-changing tasks and their descendants are rescheduled while unrelated tasks retain their dates. Ambiguous requests produce a clarification without changing the plan; **Cancel** and failures preserve the exact current version.

The model can edit only through the official MCP SDK's in-process server/client in `backend/app/mcp_server.py`. There is no public MCP transport and no filesystem, shell, database, credential or arbitrary network tool. WebSocket authentication is the first bounded protocol message, so workspace tokens do not appear in URLs. WebSockets expose bounded lifecycle states, tool names, user-safe results, final messages and validated plans, never hidden reasoning or provider payloads. Each successful request is validated and committed once in a PostgreSQL transaction.

### Limits and API

- 2 MiB workbook file; multipart requests additionally allow 64 KiB overhead, enforced before parsing/spooling.
- 20 MiB expanded ZIP contents; at most 1,000 ZIP entries.
- At most 500 data rows, 32 columns, 10,000 dependency relationships, and a 730-calendar-day chart span. Each duration is 1–730 days.
- Text cells must fit Excel's 32,767-character limit. The 500-row limit applies to nonempty data rows, not the physical worksheet length.

Endpoints:

- `GET /api/plan`: fresh seeded `Plan`.
- `POST /api/plan/import`: multipart `file` and `start_date` (`YYYY-MM-DD`, required for undated tasks); returns validated `Plan`.
- `POST /api/plan/export`: JSON `{"tasks": [...]}` using the existing ID-based task contract; returns an `.xlsx` download.
- `POST /api/projects`: creates a persisted seeded project and anonymous workspace token.
- `GET /api/workspace`: lists the token's projects and restores its latest project, plan version and messages.
- `POST /api/projects/{id}/import`: version-checked persisted Excel import.
- `POST /api/projects/{id}/undo`: writes the prior content as a new immutable version.
- `WS /api/projects/{id}/chat`: version-checked chat, safe status events and atomic plan replacement.

Workbook errors use `detail: {message, sheet, row, column}` where location is available, with HTTP 422 for invalid workbooks or 413 for file/expanded-size limits. FastAPI request-schema errors use its standard `detail` array; the UI handles both.

## Verification

```sh
cd backend
./.venv/bin/python -m pytest
```

```sh
cd frontend
npm test -- --run
npm run build
```

Backend tests exercise actual multipart/import/export routes, scheduling, graph validation, size/row/date limits, literal text and seeded/imported round trips. Frontend tests cover date selection, cancellation, atomic chart replacement, export payloads and downloads, failures/retries, loading locks and selecting the same file again.

To run the real PostgreSQL migration/JSONB/locking integration test in an isolated temporary schema:

```sh
TEST_DATABASE_URL=postgresql+psycopg://ganttai:ganttai@localhost:5432/ganttai sh backend/scripts/test-postgres.sh
```

Provider calls are mocked in automated tests. To exercise chat manually, configure a development key and test clarification, a multi-edit request, cancellation, stale Excel/chat operations, undo, reload, and a 375px viewport. Do not record API keys or raw provider payloads.

For browser verification, run both servers and import the sample dependency chain above; export and reimport it with a different selected start date and confirm the original dates remain. Try a workbook with a duplicate task name and confirm the chart remains unchanged. Repeat at desktop and 375px-wide viewports, checking file/date controls, feedback, horizontal timeline scrolling and zoom/fit actions.
