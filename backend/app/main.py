from datetime import date, timedelta
import asyncio
import json
import os
from typing import Annotated, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .agent import AgentConfigurationError, OpenAIPlanAgent
from .db import create_schema, get_engine
from .excel import ExcelError, MAX_FILE_BYTES, read_workbook, write_workbook
from .models import Plan, ProjectSnapshot, Task, WorkspaceSnapshot
from .plan_service import PlanEditError, PlanEditor, validate_plan
from .repositories import AccessDenied, ProjectRepository, VersionConflict


INTRODUCTORY_PROJECT_NAME = "Ознакомительный проект"


class ImportBodyLimit:
    """Bound multipart bytes before Starlette parses/spools the uploaded file."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        is_import = scope["path"] == "/api/plan/import" or (scope["path"].startswith("/api/projects/") and scope["path"].endswith("/import"))
        if not is_import or scope["method"] != "POST":
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


def cors_origin_values():
    configured = os.getenv("CORS_ORIGINS")
    if configured is None or (not configured.strip() and os.getenv("APP_ENV") != "production"):
        configured = "http://localhost:5173,http://127.0.0.1:5173"
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


app = FastAPI(title="GanttAI Plan API")
app.add_middleware(ImportBodyLimit)
cors_origins = cors_origin_values()
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def repository():
    if not hasattr(app.state, "repository"):
        if os.getenv("APP_ENV") != "production":
            create_schema()
        app.state.repository = ProjectRepository()
    return app.state.repository


@app.get("/health/live")
def liveness():
    return {"status": "ok"}


@app.get("/health/ready")
def readiness():
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return {"status": "ready"}


def workspace_token(value):
    if not value:
        raise HTTPException(status_code=401, detail="A workspace token is required.")
    return value


class ProjectCreated(ProjectSnapshot):
    workspace_token: str


class UndoRequest(BaseModel):
    expected_version: int


class ProjectNameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)

    @field_validator("name", mode="before")
    @classmethod
    def trimmed_name(cls, value):
        if not isinstance(value, str):
            return value
        value = value.strip()
        if not value:
            raise ValueError("Project name is required.")
        return value


class VersionedTaskRequest(BaseModel):
    expected_version: int
    task: str = Field(min_length=1, max_length=32767)
    description: str = Field(max_length=32767)
    assignee: str = Field(min_length=1, max_length=32767)
    duration: int = Field(ge=1, le=730)
    start_date: date
    predecessors: list[str] = Field(default_factory=list, max_length=500)


class TaskUpdateRequest(VersionedTaskRequest):
    pass


class TaskCreateRequest(VersionedTaskRequest):
    pass


@app.get("/api/plan", response_model=Plan)
def get_plan() -> Plan:
    return Plan(tasks=seeded_tasks())


@app.post("/api/projects", response_model=ProjectCreated)
def create_project(body: Optional[ProjectNameRequest] = None,
                   x_workspace_token: Optional[str] = Header(None)) -> ProjectCreated:
    try:
        if x_workspace_token and body is None:
            raise HTTPException(status_code=422, detail="A project name is required.")
        plan = Plan(tasks=[]) if x_workspace_token else Plan(tasks=seeded_tasks())
        name = body.name if x_workspace_token else INTRODUCTORY_PROJECT_NAME
        token, snapshot = repository().create(plan, name, x_workspace_token)
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Workspace not found.") from error
    return ProjectCreated(**snapshot.model_dump(), workspace_token=token)


@app.patch("/api/projects/{project_id}", response_model=ProjectSnapshot)
def rename_project(project_id: str, body: ProjectNameRequest,
                   x_workspace_token: Optional[str] = Header(None)) -> ProjectSnapshot:
    try:
        return repository().rename(project_id, workspace_token(x_workspace_token), body.name)
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error


@app.delete("/api/projects/{project_id}", response_model=WorkspaceSnapshot)
def delete_project(project_id: str, x_workspace_token: Optional[str] = Header(None)) -> WorkspaceSnapshot:
    try:
        return repository().delete(project_id, workspace_token(x_workspace_token),
                                   Plan(tasks=seeded_tasks()), INTRODUCTORY_PROJECT_NAME)
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error


@app.get("/api/workspace", response_model=WorkspaceSnapshot)
def get_workspace(x_workspace_token: Optional[str] = Header(None)) -> WorkspaceSnapshot:
    try:
        return repository().resolve(workspace_token(x_workspace_token))
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Workspace not found.") from error


@app.get("/api/projects/{project_id}", response_model=ProjectSnapshot)
def get_project(project_id: str, x_workspace_token: Optional[str] = Header(None)) -> ProjectSnapshot:
    try:
        return repository().load(project_id, workspace_token(x_workspace_token))
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error


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


@app.post("/api/projects/{project_id}/import", response_model=ProjectSnapshot)
async def import_project_plan(project_id: str, file: UploadFile = File(...), start_date: Optional[date] = Form(None),
                              expected_version: int = Form(...), x_workspace_token: Optional[str] = Header(None)) -> ProjectSnapshot:
    token = workspace_token(x_workspace_token)
    try:
        if not file.filename or not file.filename.lower().endswith(".xlsx"):
            raise ExcelError("Choose an .xlsx workbook.")
        data = await file.read(MAX_FILE_BYTES + 1)
        candidate = Plan.model_validate(await run_in_threadpool(read_workbook, data, start_date))
        repository().commit_plan(project_id, token, expected_version, candidate, "excel",
                                 system_message=f"Imported {len(candidate.tasks)} tasks from Excel.")
        return repository().load(project_id, token)
    except VersionConflict as error:
        raise HTTPException(status_code=409, detail="The plan changed while the workbook was importing. Reload and retry.") from error
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error
    finally:
        await file.close()


@app.post("/api/plan/export")
def export_plan(plan: Plan) -> Response:
    data = write_workbook([task.model_dump() for task in plan.tasks])
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="gantt-plan.xlsx"'})


PlanResponse = Annotated[Plan, "Validated plan response"]


@app.post("/api/projects/{project_id}/undo", response_model=ProjectSnapshot)
def undo_project(project_id: str, body: UndoRequest, x_workspace_token: Optional[str] = Header(None)) -> ProjectSnapshot:
    token = workspace_token(x_workspace_token)
    try:
        repository().undo(project_id, token, body.expected_version)
        return repository().load(project_id, token)
    except VersionConflict as error:
        raise HTTPException(status_code=409, detail="The plan changed before undo completed. Reload and retry.") from error
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.patch("/api/projects/{project_id}/tasks/{task_id:path}", response_model=ProjectSnapshot)
def update_project_task(project_id: str, task_id: str, body: TaskUpdateRequest,
                        x_workspace_token: Optional[str] = Header(None)) -> ProjectSnapshot:
    token = workspace_token(x_workspace_token)
    try:
        snapshot = repository().load(project_id, token)
        if snapshot.version != body.expected_version:
            raise VersionConflict()
        candidate = PlanEditor(snapshot.plan).edit_task(
            task_id, body.task, body.description, body.assignee, body.duration,
            body.start_date.isoformat(), body.predecessors,
        )
        repository().commit_plan(project_id, token, body.expected_version, candidate, "task")
        return repository().load(project_id, token)
    except VersionConflict as error:
        raise HTTPException(status_code=409, detail="The plan changed while the task was being saved. Reload and retry.") from error
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error
    except PlanEditError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/projects/{project_id}/tasks", response_model=ProjectSnapshot)
def create_project_task(project_id: str, body: TaskCreateRequest,
                        x_workspace_token: Optional[str] = Header(None)) -> ProjectSnapshot:
    token = workspace_token(x_workspace_token)
    try:
        snapshot = repository().load(project_id, token)
        if snapshot.version != body.expected_version:
            raise VersionConflict()
        candidate = PlanEditor(snapshot.plan).create_task(
            body.task, body.description, body.assignee, body.duration,
            body.start_date.isoformat(), body.predecessors,
        )
        repository().commit_plan(project_id, token, body.expected_version, candidate, "task")
        return repository().load(project_id, token)
    except VersionConflict as error:
        raise HTTPException(status_code=409, detail="The plan changed while the task was being saved. Reload and retry.") from error
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error
    except PlanEditError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


async def run_chat(websocket, project_id, token, payload):
    completion = None
    expected_version = payload.get("expected_version")
    message = payload.get("content")
    if not isinstance(expected_version, int) or not isinstance(message, str) or not message.strip() or len(message) > 10000:
        await websocket.send_json({"type": "error", "code": "invalid_request", "message": "Send a non-empty message and the current plan version."})
        return
    try:
        snapshot = await asyncio.to_thread(repository().load, project_id, token)
        if snapshot.version != expected_version:
            await websocket.send_json({"type": "error", "code": "stale", "message": "The plan changed. Reload and retry."})
            return

        async def status(event):
            await websocket.send_json(event)

        agent_factory = getattr(app.state, "agent_factory", OpenAIPlanAgent)
        agent = agent_factory()
        candidate, reply, changed = await agent.run(snapshot.plan, message.strip(), snapshot.messages, status)
        if changed:
            candidate = validate_plan(candidate)
            # Keep the final transaction on this task so cancellation cannot outlive a detached commit thread.
            version = repository().commit_plan(project_id, token, expected_version, candidate, "chat", message.strip(), reply)
            completion = {"type": "complete", "version": version, "plan": candidate.model_dump(mode="json"), "message": reply}
            await websocket.send_json(completion)
            return True
        else:
            await asyncio.to_thread(repository().append_message, project_id, token, "user", message.strip())
            await asyncio.to_thread(repository().append_message, project_id, token, "assistant", reply)
            await websocket.send_json({"type": "clarification", "version": expected_version, "message": reply})
    except VersionConflict:
        await websocket.send_json({"type": "error", "code": "stale", "message": "The plan changed while the request was running. Reload and retry."})
    except AgentConfigurationError as error:
        await websocket.send_json({"type": "error", "code": "configuration", "message": str(error)})
    except PlanEditError as error:
        await websocket.send_json({"type": "error", "code": "invalid_edit", "message": str(error)})
    except asyncio.CancelledError:
        if completion is not None:
            await websocket.send_json(completion)
            return True
        raise
    except Exception:
        await websocket.send_json({"type": "error", "code": "processing", "message": "The plan could not be updated. Your existing plan was kept; retry when ready."})


@app.websocket("/api/projects/{project_id}/chat")
async def project_chat(websocket: WebSocket, project_id: str):
    await websocket.accept()
    try:
        auth_text = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        if len(auth_text) > 4096:
            await websocket.close(code=4401)
            return
        auth = json.loads(auth_text)
        if not isinstance(auth, dict) or auth.get("type") != "auth" or not isinstance(auth.get("token"), str):
            await websocket.close(code=4401)
            return
        token = auth["token"]
        snapshot = await asyncio.to_thread(repository().load, project_id, token)
    except asyncio.TimeoutError:
        await websocket.close(code=4408)
        return
    except (AccessDenied, json.JSONDecodeError, RuntimeError, TypeError, WebSocketDisconnect):
        await websocket.close(code=4401)
        return
    await websocket.send_json({"type": "connected", "version": snapshot.version})
    active = None
    try:
        while True:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "code": "invalid_request", "message": "Send a valid chat message."})
                continue
            if payload.get("type") == "cancel":
                if active and not active.done():
                    active.cancel()
                    committed = False
                    try:
                        committed = bool(await active)
                    except asyncio.CancelledError:
                        pass
                    if not committed:
                        await websocket.send_json({"type": "cancelled", "message": "Request cancelled. The plan was not changed."})
                continue
            if payload.get("type") != "message" or (active and not active.done()):
                await websocket.send_json({"type": "error", "code": "busy", "message": "Wait for the current request or cancel it first."})
                continue
            active = asyncio.create_task(run_chat(websocket, project_id, token, payload))
    except WebSocketDisconnect:
        if active and not active.done():
            active.cancel()
