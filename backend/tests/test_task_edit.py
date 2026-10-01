import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.main import app
from app.models import Plan
from app.repositories import ProjectRepository


@pytest.fixture
def client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'tasks.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    app.state.repository = ProjectRepository(sessionmaker(engine, expire_on_commit=False))
    with TestClient(app) as test_client:
        yield test_client
    del app.state.repository


def create(client):
    return client.post("/api/projects").json()


def edit(client, project, task_id="discovery", version=1, **changes):
    task = next(item for item in project["plan"]["tasks"] if item["id"] == task_id)
    body = {
        "expected_version": version,
        "task": task["task"],
        "description": task["description"],
        "assignee": task["assignee"],
        "duration": task["duration"],
        "start_date": task["start_date"],
        "predecessors": task["predecessors"],
        **changes,
    }
    return client.patch(
        f"/api/projects/{project['project_id']}/tasks/{task_id}",
        headers={"X-Workspace-Token": project["workspace_token"]}, json=body,
    )


def test_task_edit_commits_all_fields_once_and_reschedules_descendants(client):
    project = create(client)
    response = edit(client, project, task="Discovery and scope", description="Expanded", assignee="Priya", duration=5)
    assert response.status_code == 200
    saved = response.json()
    assert saved["version"] == 2
    assert saved["plan"]["tasks"][0] == {
        "id": "discovery", "task": "Discovery and scope", "description": "Expanded", "assignee": "Priya",
        "duration": 5, "start_date": "2026-10-05", "end_date": "2026-10-09", "predecessors": [],
    }
    assert saved["plan"]["tasks"][1]["start_date"] == "2026-10-10"
    assert saved["plan"]["tasks"][3]["start_date"] == "2026-10-15"


def test_dependency_edit_uses_ids_and_reschedules_successors(client):
    project = create(client)
    response = edit(client, project, task_id="review", start_date="2026-10-21", predecessors=["api"])
    assert response.status_code == 200
    review = response.json()["plan"]["tasks"][-1]
    assert review["predecessors"] == ["api"]
    assert review["start_date"] == "2026-10-21"


def test_metadata_only_edit_preserves_existing_schedule_gaps(client):
    project = create(client)
    response = edit(client, project, description="Metadata only")
    assert response.status_code == 200
    tasks = response.json()["plan"]["tasks"]
    assert tasks[1]["start_date"] == project["plan"]["tasks"][1]["start_date"]
    assert tasks[2]["start_date"] == project["plan"]["tasks"][2]["start_date"]


def test_path_like_task_id_can_be_edited(client):
    token, snapshot = app.state.repository.create(Plan.model_validate({"tasks": [{
        "id": "phase/one", "task": "Phase one", "description": "", "assignee": "Maya", "duration": 1,
        "start_date": "2026-10-01", "end_date": "2026-10-01", "predecessors": [],
    }]}))
    response = client.patch(
        f"/api/projects/{snapshot.project_id}/tasks/phase/one", headers={"X-Workspace-Token": token},
        json={"expected_version": 1, "task": "Phase one", "description": "Updated", "assignee": "Maya",
              "duration": 1, "start_date": "2026-10-01", "predecessors": []},
    )
    assert response.status_code == 200
    assert response.json()["plan"]["tasks"][0]["description"] == "Updated"


def test_end_date_overflow_returns_an_actionable_422(client):
    token, snapshot = app.state.repository.create(Plan.model_validate({"tasks": [{
        "id": "last-day", "task": "Last day", "description": "", "assignee": "Maya", "duration": 1,
        "start_date": "9999-12-31", "end_date": "9999-12-31", "predecessors": [],
    }]}))
    response = client.patch(
        f"/api/projects/{snapshot.project_id}/tasks/last-day", headers={"X-Workspace-Token": token},
        json={"expected_version": 1, "task": "Last day", "description": "", "assignee": "Maya",
              "duration": 2, "start_date": "9999-12-31", "predecessors": []},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Task 'Last day' ends outside the supported date range."
    assert app.state.repository.load(snapshot.project_id, token).version == 1


@pytest.mark.parametrize("changes, message", [
    ({"task": "Product wireframes"}, "already exists"),
    ({"predecessors": ["review"]}, "cycle"),
    ({"task_id": "review", "start_date": "2026-10-05", "predecessors": ["api"]}, "start after"),
])
def test_invalid_task_edits_leave_the_version_unchanged(client, changes, message):
    project = create(client)
    response = edit(client, project, **changes)
    assert response.status_code == 422
    assert message in response.json()["detail"]
    loaded = client.get(f"/api/projects/{project['project_id']}", headers={"X-Workspace-Token": project["workspace_token"]}).json()
    assert loaded["version"] == 1


def test_stale_and_unauthorized_task_edits_are_rejected(client):
    project = create(client)
    assert edit(client, project, version=0).status_code == 409
    response = client.patch(
        f"/api/projects/{project['project_id']}/tasks/discovery",
        headers={"X-Workspace-Token": "wrong"},
        json={"expected_version": 1, "task": "A", "description": "", "assignee": "A", "duration": 1,
              "start_date": "2026-10-05", "predecessors": []},
    )
    assert response.status_code == 404
