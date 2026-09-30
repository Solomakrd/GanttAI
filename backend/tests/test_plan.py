from datetime import date

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import Plan, Task, app


client = TestClient(app)


def test_seeded_plan_is_deterministic_and_has_dependencies():
    first = client.get("/api/plan")
    second = client.get("/api/plan")

    assert first.status_code == 200
    assert first.json() == second.json()
    assert len(first.json()["tasks"]) == 5
    assert first.json()["tasks"][3]["predecessors"] == ["wireframes", "api"]


def test_task_schema_rejects_invalid_dates_and_duration():
    try:
        Task(
            id="bad",
            task="Invalid",
            assignee="Nobody",
            duration=0,
            start_date=date(2026, 10, 10),
            end_date=date(2026, 10, 9),
        )
    except ValidationError as error:
        assert "duration" in str(error)
        assert "end_date" in str(error)
    else:
        raise AssertionError("invalid task should not validate")


def test_empty_plan_is_a_valid_api_shape():
    plan = Plan(tasks=[])
    assert plan.model_dump() == {"tasks": []}


def test_invalid_records_can_be_excluded_while_valid_records_remain():
    valid = Task(
        id="valid",
        task="Valid",
        assignee="A",
        duration=1,
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 1),
    )
    records = [valid, {"id": "invalid", "task": "", "duration": -1}]
    accepted = []
    rejected = []
    for record in records:
        try:
            accepted.append(record if isinstance(record, Task) else Task.model_validate(record))
        except ValidationError:
            rejected.append(record["id"])

    assert [task.id for task in accepted] == ["valid"]
    assert rejected == ["invalid"]
