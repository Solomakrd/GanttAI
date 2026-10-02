from datetime import date, timedelta
import asyncio
from contextlib import suppress
import json
import re
from typing import Annotated, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .agent import AgentConfigurationError, OpenAIPlanAgent
from .db import create_schema
from .excel import ExcelError, MAX_FILE_BYTES, read_workbook, write_workbook
from .models import Plan, ProjectSnapshot, Task, WorkspaceSnapshot
from .plan_service import PlanEditError, PlanEditor, validate_plan
from .repositories import AccessDenied, ProjectRepository, RequestCollision, RequestOwnershipLost, VersionConflict


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


app = FastAPI(title="GanttAI Plan API")
app.add_middleware(ImportBodyLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def repository():
    if not hasattr(app.state, "repository"):
        create_schema()
        app.state.repository = ProjectRepository()
    return app.state.repository


def workspace_token(value):
    if not value:
        raise HTTPException(status_code=401, detail="A workspace token is required.")
    return value


class ProjectCreated(ProjectSnapshot):
    workspace_token: str


class UndoRequest(BaseModel):
    expected_version: int


class TaskUpdateRequest(BaseModel):
    expected_version: int
    task: str = Field(min_length=1, max_length=32767)
    description: str = Field(max_length=32767)
    assignee: str = Field(min_length=1, max_length=32767)
    duration: int = Field(ge=1, le=730)
    start_date: date
    predecessors: list[str] = Field(default_factory=list, max_length=500)


@app.get("/api/plan", response_model=Plan)
def get_plan() -> Plan:
    return Plan(tasks=seeded_tasks())


@app.post("/api/projects", response_model=ProjectCreated)
def create_project(x_workspace_token: Optional[str] = Header(None)) -> ProjectCreated:
    try:
        token, snapshot = repository().create(Plan(tasks=seeded_tasks()), x_workspace_token)
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Workspace not found.") from error
    return ProjectCreated(**snapshot.model_dump(), workspace_token=token)


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
        version = repository().commit_plan(project_id, token, body.expected_version, candidate, "task")
        return ProjectSnapshot(project_id=snapshot.project_id, conversation_id=snapshot.conversation_id,
                               version=version, plan=candidate, messages=snapshot.messages)
    except VersionConflict as error:
        raise HTTPException(status_code=409, detail="The plan changed while the task was being saved. Reload and retry.") from error
    except AccessDenied as error:
        raise HTTPException(status_code=404, detail="Project not found.") from error
    except PlanEditError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


async def run_chat(websocket, project_id, token, payload):
    terminal = None
    owner_token = None
    expected_version = payload.get("expected_version")
    message = payload.get("content")
    request_id = payload.get("request_id")
    valid_request_id = isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", request_id)
    if not valid_request_id or not isinstance(expected_version, int) or not isinstance(message, str) or not message.strip() or len(message) > 10000:
        await websocket.send_json({"type": "error", "request_id": request_id if valid_request_id else None,
                                   "code": "invalid_request", "message": "Send a valid request ID, non-empty message, and current plan version."})
        return
    message = message.strip()

    async def send(event):
        await websocket.send_json({**event, "request_id": request_id})

    async def heartbeat():
        while True:
            await asyncio.sleep(10)
            renewed = await asyncio.to_thread(repository().renew_chat_request, project_id, request_id, owner_token)
            if not renewed:
                raise RequestOwnershipLost()

    async def release_request():
        nonlocal owner_token
        if owner_token:
            current_owner = owner_token
            owner_token = None
            await asyncio.to_thread(repository().release_chat_request, project_id, request_id, current_owner)

    try:
        while True:
            claim, cached, owner_token = await asyncio.to_thread(
                repository().claim_chat_request, project_id, token, request_id, message, expected_version,
            )
            if claim in {"completed", "cancelled"}:
                await websocket.send_json(cached)
                return True
            if claim == "claimed":
                break
            await send({"type": "status", "code": "recovering"})
            await asyncio.sleep(0.25)
        snapshot = await asyncio.to_thread(repository().load, project_id, token)
        if snapshot.version != expected_version:
            await send({"type": "error", "code": "stale", "message": "The plan changed. Reload and retry."})
            return

        async def status(event):
            await send(event)

        agent_factory = getattr(app.state, "agent_factory", OpenAIPlanAgent)
        agent = agent_factory()
        agent_task = asyncio.create_task(agent.run(snapshot.plan, message, snapshot.messages, status))
        heartbeat_task = asyncio.create_task(heartbeat())
        try:
            done, _ = await asyncio.wait((agent_task, heartbeat_task), return_when=asyncio.FIRST_COMPLETED)
            if heartbeat_task in done:
                agent_task.cancel()
                with suppress(asyncio.CancelledError):
                    await agent_task
                await heartbeat_task
            candidate, reply, changed = await agent_task
        finally:
            agent_task.cancel()
            heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await agent_task
            with suppress(asyncio.CancelledError):
                await heartbeat_task
        if changed:
            candidate = validate_plan(candidate)
        # Keep finalization on this task so cancellation cannot outlive the atomic commit.
        terminal = repository().finalize_chat_request(
            project_id, token, request_id, owner_token, candidate, reply, changed,
        )
        await websocket.send_json(terminal)
        return True
    except VersionConflict:
        await release_request()
        await send({"type": "error", "code": "stale", "message": "The plan changed while the request was running. Reload and retry."})
    except RequestCollision:
        await send({"type": "error", "code": "invalid_request", "message": "That request ID was already used for different input."})
    except RequestOwnershipLost:
        await release_request()
        cached = await asyncio.to_thread(repository().chat_request_terminal, project_id, request_id)
        if cached:
            terminal = cached
            await websocket.send_json(cached)
            return True
        await send({"type": "error", "code": "processing", "message": "The request is being recovered. Reconnect to continue."})
    except AgentConfigurationError as error:
        await release_request()
        await send({"type": "error", "code": "configuration", "message": str(error)})
    except PlanEditError as error:
        await release_request()
        await send({"type": "error", "code": "invalid_edit", "message": str(error)})
    except asyncio.CancelledError:
        if terminal is not None:
            await websocket.send_json(terminal)
            return True
        raise
    except Exception:
        if terminal is not None:
            return True
        await release_request()
        await send({"type": "error", "code": "processing", "message": "The plan could not be updated. Your existing plan was kept; retry when ready."})
    finally:
        if terminal is None:
            await release_request()


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
    active_request_id = None
    try:
        while True:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "code": "invalid_request", "message": "Send a valid chat message."})
                continue
            if payload.get("type") == "cancel":
                if active and not active.done():
                    if payload.get("request_id") != active_request_id:
                        await websocket.send_json({"type": "error", "request_id": payload.get("request_id"),
                                                   "code": "invalid_request", "message": "Cancel the active request by its request ID."})
                        continue
                    terminal = await asyncio.to_thread(
                        repository().cancel_chat_request, project_id, token, active_request_id,
                    )
                    active.cancel()
                    committed = False
                    try:
                        committed = bool(await active)
                    except asyncio.CancelledError:
                        pass
                    if not committed:
                        await websocket.send_json(terminal or {"type": "cancelled", "request_id": active_request_id,
                                                               "message": "Request cancelled. The plan was not changed."})
                continue
            if payload.get("type") != "message" or (active and not active.done()):
                await websocket.send_json({"type": "error", "request_id": payload.get("request_id"),
                                           "code": "busy", "message": "Wait for the current request or cancel it first."})
                continue
            active_request_id = payload.get("request_id")
            active = asyncio.create_task(run_chat(websocket, project_id, token, payload))
    except WebSocketDisconnect:
        if active and not active.done():
            active.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect):
                await active
