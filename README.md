# GanttAI

React Gantt timeline backed by FastAPI. The initial view loads a deterministic five-task seed. Import an Excel workbook to replace the displayed plan, or export the plan currently on screen.

## Run locally

Python 3.9+ and a current Node.js LTS release are required.

```sh
cd backend
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
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

Imported plans live **only in browser memory until reload**. Reload restores the seed. Import returns a `Plan` and does not persist data on the server or affect other users. Export accepts the displayed `Plan` rather than reading a shared server-side plan.

### Limits and API

- 2 MiB workbook file; multipart requests additionally allow 64 KiB overhead, enforced before parsing/spooling.
- 20 MiB expanded ZIP contents; at most 1,000 ZIP entries.
- At most 500 data rows, 32 columns, 10,000 dependency relationships, and a 730-calendar-day chart span. Each duration is 1–730 days.
- Text cells must fit Excel's 32,767-character limit. The 500-row limit applies to nonempty data rows, not the physical worksheet length.

Endpoints:

- `GET /api/plan`: fresh seeded `Plan`.
- `POST /api/plan/import`: multipart `file` and `start_date` (`YYYY-MM-DD`, required for undated tasks); returns validated `Plan`.
- `POST /api/plan/export`: JSON `{"tasks": [...]}` using the existing ID-based task contract; returns an `.xlsx` download.

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

For browser verification, run both servers and import the sample dependency chain above; export and reimport it with a different selected start date and confirm the original dates remain. Try a workbook with a duplicate task name and confirm the chart remains unchanged. Repeat at desktop and 375px-wide viewports, checking file/date controls, feedback, horizontal timeline scrolling and zoom/fit actions.
