from typing import List, Optional

from mcp import types
from mcp.server import MCPServer
from mcp.shared.exceptions import MCPError
from pydantic import BaseModel, ConfigDict, Field

from .plan_service import PlanEditError, PlanEditor


MAX_TOOL_CALLS = 30

class ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReadArguments(ToolArguments):
    pass


class AddArguments(ToolArguments):
    task: str = Field(min_length=1, max_length=32767)
    assignee: str = Field(min_length=1, max_length=32767)
    duration: int = Field(ge=1, le=730)
    description: str = Field(default="", max_length=32767)
    predecessors: List[str] = Field(default_factory=list, max_length=500)
    start_date: Optional[str] = None


class UpdateArguments(ToolArguments):
    task: str = Field(min_length=1, max_length=32767)
    new_name: Optional[str] = Field(default=None, min_length=1, max_length=32767)
    description: Optional[str] = Field(default=None, max_length=32767)
    assignee: Optional[str] = Field(default=None, min_length=1, max_length=32767)
    duration: Optional[int] = Field(default=None, ge=1, le=730)
    start_date: Optional[str] = None


class DependencyArguments(ToolArguments):
    task: str = Field(min_length=1, max_length=32767)
    predecessors: List[str] = Field(max_length=500)


class DeleteArguments(ToolArguments):
    tasks: List[str] = Field(min_length=1, max_length=500)


ARGUMENT_MODELS = {
    "read_plan": ReadArguments,
    "add_task": AddArguments,
    "update_task": UpdateArguments,
    "set_dependencies": DependencyArguments,
    "delete_tasks": DeleteArguments,
}


class InternalMCPServer:
    """Official in-process MCP server with no network transport."""

    def __init__(self, plan):
        self.editor = PlanEditor(plan)
        self.calls = 0
        self.server = MCPServer("ganttai-plan-editor", middleware=[self._validate_tool_call])
        self._register_tools()

    async def _validate_tool_call(self, context, call_next):
        if context.method == "tools/call" and context.params:
            name = context.params.get("name")
            arguments = context.params.get("arguments", {})
            if name not in ARGUMENT_MODELS:
                raise MCPError(types.INVALID_PARAMS, "Tool is not allowlisted.")
            try:
                ARGUMENT_MODELS[name].model_validate(arguments)
            except Exception as error:
                raise MCPError(types.INVALID_PARAMS, "Tool arguments were invalid.") from error
        return await call_next(context)

    def _invoke(self, name, arguments):
        self.calls += 1
        if self.calls > MAX_TOOL_CALLS:
            raise ValueError("The edit used too many tool calls.")
        arguments = ARGUMENT_MODELS[name].model_validate(arguments).model_dump(exclude_none=True)
        try:
            if name == "read_plan":
                result = self.editor.read()
            elif name == "add_task":
                result = self.editor.add(**arguments).model_dump(mode="json")
            elif name == "update_task":
                result = self.editor.update(**arguments).model_dump(mode="json")
            elif name == "set_dependencies":
                result = self.editor.dependencies(**arguments).model_dump(mode="json")
            elif name == "delete_tasks":
                result = self.editor.delete(arguments["tasks"]).model_dump(mode="json")
        except PlanEditError as error:
            return {"ok": False, "error": str(error)[:500]}
        return {"ok": True, "task_count": len(result["tasks"]), "plan": result if name == "read_plan" else None}

    def _register_tools(self):
        @self.server.tool(name="read_plan", description="Read the current plan.")
        def read_plan():
            return self._invoke("read_plan", {})

        @self.server.tool(name="add_task", description="Add one task; predecessor values are exact task names.")
        def add_task(task: str, assignee: str, duration: int, description: str = "",
                     predecessors: Optional[List[str]] = None, start_date: Optional[str] = None):
            return self._invoke("add_task", {"task": task, "assignee": assignee, "duration": duration,
                                              "description": description, "predecessors": predecessors or [],
                                              "start_date": start_date})

        @self.server.tool(name="update_task", description="Rename, describe, reassign, move, or resize one task.")
        def update_task(task: str, new_name: Optional[str] = None, description: Optional[str] = None,
                        assignee: Optional[str] = None, duration: Optional[int] = None,
                        start_date: Optional[str] = None):
            return self._invoke("update_task", {"task": task, "new_name": new_name, "description": description,
                                                 "assignee": assignee, "duration": duration,
                                                 "start_date": start_date})

        @self.server.tool(name="set_dependencies", description="Replace a task's predecessors using exact task names.")
        def set_dependencies(task: str, predecessors: List[str]):
            return self._invoke("set_dependencies", {"task": task, "predecessors": predecessors})

        @self.server.tool(name="delete_tasks", description="Delete tasks by exact name and remove their dependency links.")
        def delete_tasks(tasks: List[str]):
            return self._invoke("delete_tasks", {"tasks": tasks})
