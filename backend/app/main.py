from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator

from .excel import ExcelError, MAX_FILE_BYTES, read_workbook, write_workbook


class ImportBodyLimit:
    """Bound multipart bytes before Starlette parses/spools the uploaded file."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != "/api/plan/import" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > MAX_FILE_BYTES + 64 * 1024:
                response = JSONResponse(status_code=413, content={"detail": {"message": "Upload exceeds the 2 MiB file limit plus multipart overhead."}})
                return await response(scope, receive, send)
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class Task(BaseModel):
    id: str = Field(min_length=1)
    task: str = Field(min_length=1)
    description: str = ""
    assignee: str = Field(min_length=1)
    duration: int = Field(gt=0)
    start_date: date
    end_date: date
    predecessors: list[str] = Field(default_factory=list)

    @field_validator("end_date")
    @classmethod
    def end_date_follows_start(cls, value: date, info):
        start = info.data.get("start_date")
        if start and value < start:
            raise ValueError("end_date must be on or after start_date")
        return value


class Plan(BaseModel):
    tasks: list[Task]


def seeded_tasks() -> list[Task]:
    start = date(2026, 10, 5)
    return [
        Task(
            id="discovery",
            task="Discovery workshop",
            description="Align on the problem, users, and success measures.",
            assignee="Maya",
            duration=3,
            start_date=start,
            end_date=start + timedelta(days=2),
        ),
        Task(
            id="wireframes",
            task="Product wireframes",
            description="Turn the workshop outcomes into a navigable structure.",
            assignee="Noah",
            duration=4,
            start_date=start + timedelta(days=3),
            end_date=start + timedelta(days=6),
            predecessors=["discovery"],
        ),
        Task(
            id="api",
            task="Plan API",
            description="Define the plan contract for the first usable slice.",
            assignee="Priya",
            duration=5,
            start_date=start + timedelta(days=3),
            end_date=start + timedelta(days=7),
            predecessors=["discovery"],
        ),
        Task(
            id="chart",
            task="Gantt timeline",
            description="Render tasks, dates, and dependency connectors.",
            assignee="Leo",
            duration=5,
            start_date=start + timedelta(days=8),
            end_date=start + timedelta(days=12),
            predecessors=["wireframes", "api"],
        ),
        Task(
            id="review",
            task="Team review",
            description="Review the plan view and prepare the next slice.",
            assignee="Maya",
            duration=2,
            start_date=start + timedelta(days=13),
            end_date=start + timedelta(days=14),
            predecessors=["chart"],
        ),
    ]


app = FastAPI(title="GanttAI Plan API")
app.add_middleware(ImportBodyLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/plan", response_model=Plan)
def get_plan() -> Plan:
    return Plan(tasks=seeded_tasks())


@app.exception_handler(ExcelError)
async def excel_error_handler(request, error: ExcelError):
    return JSONResponse(status_code=error.status, content={"detail": error.detail})


@app.post("/api/plan/import", response_model=Plan)
async def import_plan(file: UploadFile = File(...), start_date: Optional[date] = Form(None)) -> Plan:
    try:
        if not file.filename or not file.filename.lower().endswith(".xlsx"):
            raise ExcelError("Choose an .xlsx workbook.")
        data = await file.read(MAX_FILE_BYTES + 1)
        result = await run_in_threadpool(read_workbook, data, start_date)
        return Plan.model_validate(result)
    finally:
        await file.close()


@app.post("/api/plan/export")
def export_plan(plan: Plan) -> Response:
    data = write_workbook([task.model_dump() for task in plan.tasks])
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="gantt-plan.xlsx"'})


PlanResponse = Annotated[Plan, "Validated plan response"]
