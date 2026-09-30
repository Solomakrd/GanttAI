from copy import deepcopy
from datetime import date

import pytest

from app.models import Plan
from app.plan_service import PlanEditError, PlanEditor


def plan():
    return Plan.model_validate({"tasks": [
        {"id": "a", "task": "A", "description": "", "assignee": "Maya", "duration": 2, "start_date": "2026-10-01", "end_date": "2026-10-02", "predecessors": []},
        {"id": "b", "task": "B", "description": "", "assignee": "Leo", "duration": 1, "start_date": "2026-10-05", "end_date": "2026-10-05", "predecessors": ["a"]},
        {"id": "c", "task": "C", "description": "", "assignee": "Noah", "duration": 1, "start_date": "2026-10-10", "end_date": "2026-10-10", "predecessors": []},
    ]})


def test_typed_edits_reschedule_descendants_but_preserve_unrelated_tasks_and_gaps():
    editor = PlanEditor(plan())
    editor.update("A", description="Expanded scope", assignee="Priya")
    assert editor.plan.tasks[1].start_date == date(2026, 10, 5)
    editor.update("A", duration=4)
    assert editor.plan.tasks[0].end_date == date(2026, 10, 4)
    assert editor.plan.tasks[1].start_date == date(2026, 10, 5)
    assert editor.plan.tasks[2].start_date == date(2026, 10, 10)
    editor.add("Release", "Maya", 2, predecessors=["B"])
    assert editor.plan.tasks[-1].start_date == date(2026, 10, 6)


def test_move_preserves_a_later_explicit_start_and_reschedules_descendants():
    editor = PlanEditor(plan())
    result = editor.update("B", start_date="2026-10-08")
    assert result.tasks[1].start_date == date(2026, 10, 8)
    assert result.tasks[1].end_date == date(2026, 10, 8)


def test_delete_removes_links_and_reschedules_successors_from_project_start():
    editor = PlanEditor(plan())
    result = editor.delete(["A"])
    successor = next(task for task in result.tasks if task.task == "B")
    assert successor.predecessors == []
    assert successor.start_date == date(2026, 10, 1)


def test_invalid_operation_never_mutates_the_previous_plan():
    editor = PlanEditor(plan())
    before = deepcopy(editor.plan.model_dump())
    with pytest.raises(PlanEditError, match="Unknown predecessor"):
        editor.dependencies("A", ["Missing"])
    assert editor.plan.model_dump() == before


def test_duplicate_cycle_and_limits_are_rejected():
    editor = PlanEditor(plan())
    with pytest.raises(PlanEditError, match="already exists"):
        editor.add("A", "Maya", 1)
    with pytest.raises(PlanEditError, match="cycle"):
        editor.dependencies("A", ["B"])
    with pytest.raises(PlanEditError, match="Duration"):
        editor.update("A", duration=731)
