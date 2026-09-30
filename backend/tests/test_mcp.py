import asyncio
import json

from mcp import Client
from mcp.shared.exceptions import MCPError
import pytest

from app.main import seeded_tasks
from app.mcp_server import InternalMCPServer, MAX_TOOL_CALLS
from app.models import Plan


def test_only_allowlisted_tools_can_touch_the_draft():
    server = InternalMCPServer(Plan(tasks=seeded_tasks()))
    before = server.editor.plan.model_dump()
    async def run():
        async with Client(server.server) as client:
            tools = await client.list_tools()
            assert {tool.name for tool in tools.tools} == {"read_plan", "add_task", "update_task", "set_dependencies", "delete_tasks"}
            with pytest.raises(MCPError, match="not allowlisted"):
                await client.call_tool("run_shell", {"command": "print secrets"})
    asyncio.run(run())
    assert server.editor.plan.model_dump() == before


def test_tool_payloads_are_typed_and_calls_are_bounded():
    server = InternalMCPServer(Plan(tasks=seeded_tasks()))
    async def run():
        async with Client(server.server) as client:
            with pytest.raises(MCPError, match="arguments were invalid"):
                await client.call_tool("add_task", {"task": "Injected", "assignee": "A", "duration": 1, "unexpected": "ignore schemas"})
            for _ in range(MAX_TOOL_CALLS):
                result = await client.call_tool("read_plan", {})
                assert json.loads(result.content[0].text)["ok"]
            assert (await client.call_tool("read_plan", {})).is_error
    asyncio.run(run())


def test_mcp_changes_are_draft_only_until_repository_commit():
    original = Plan(tasks=seeded_tasks())
    server = InternalMCPServer(original)
    async def run():
        async with Client(server.server) as client:
            result = await client.call_tool("update_task", {"task": "Team review", "assignee": "Noah"})
            assert not result.is_error
    asyncio.run(run())
    assert original.tasks[-1].assignee == "Maya"
    assert server.editor.plan.tasks[-1].assignee == "Noah"


def test_plan_edit_errors_are_safe_and_actionable():
    server = InternalMCPServer(Plan(tasks=seeded_tasks()))
    async def run():
        async with Client(server.server) as client:
            result = await client.call_tool("update_task", {"task": "Missing", "assignee": "Noah"})
            payload = json.loads(result.content[0].text)
            assert not result.is_error
            assert payload == {"ok": False, "error": "Unknown task 'Missing'."}
    asyncio.run(run())
