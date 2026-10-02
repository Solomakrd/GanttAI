import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.main import INTRODUCTORY_PROJECT_NAME, app
from app.repositories import ProjectRepository


@pytest.fixture
def client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'projects.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    app.state.repository = ProjectRepository(sessionmaker(engine, expire_on_commit=False))
    with TestClient(app) as test_client:
        yield test_client
    del app.state.repository


def test_initial_project_is_named_and_secondary_project_is_named_and_empty(client):
    first = client.post("/api/projects").json()
    assert first["project_name"] == INTRODUCTORY_PROJECT_NAME
    assert len(first["plan"]["tasks"]) == 5

    second_response = client.post("/api/projects", headers={"X-Workspace-Token": first["workspace_token"]}, json={"name": "  Delivery  "})
    assert second_response.status_code == 200
    second = second_response.json()
    assert second["project_name"] == "Delivery"
    assert second["plan"]["tasks"] == []
    workspace = client.get("/api/workspace", headers={"X-Workspace-Token": first["workspace_token"]}).json()
    assert [item["project_name"] for item in workspace["projects"]] == [INTRODUCTORY_PROJECT_NAME, "Delivery"]


@pytest.mark.parametrize("name", ["", "   ", "x" * 65])
def test_project_names_are_required_and_bounded(client, name):
    first = client.post("/api/projects").json()
    response = client.post("/api/projects", headers={"X-Workspace-Token": first["workspace_token"]}, json={"name": name})
    assert response.status_code == 422


def test_project_name_length_is_checked_after_trimming(client):
    first = client.post("/api/projects").json()
    name = "x" * 64
    response = client.post("/api/projects", headers={"X-Workspace-Token": first["workspace_token"]}, json={"name": f"  {name}  "})
    assert response.status_code == 200
    assert response.json()["project_name"] == name


def test_rename_does_not_change_version_and_delete_selects_a_remaining_project(client):
    first = client.post("/api/projects").json()
    second = client.post("/api/projects", headers={"X-Workspace-Token": first["workspace_token"]}, json={"name": "Second"}).json()
    renamed = client.patch(f"/api/projects/{first['project_id']}", headers={"X-Workspace-Token": first["workspace_token"]}, json={"name": "First renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["version"] == 1
    assert renamed.json()["project_name"] == "First renamed"

    deleted = client.delete(f"/api/projects/{second['project_id']}", headers={"X-Workspace-Token": first["workspace_token"]})
    assert deleted.status_code == 200
    assert deleted.json()["active_project"]["project_id"] == first["project_id"]
    assert [item["project_id"] for item in deleted.json()["projects"]] == [first["project_id"]]


def test_deleting_last_project_reseeds_under_the_same_token(client):
    first = client.post("/api/projects").json()
    deleted = client.delete(f"/api/projects/{first['project_id']}", headers={"X-Workspace-Token": first["workspace_token"]})
    assert deleted.status_code == 200
    replacement = deleted.json()["active_project"]
    assert replacement["project_id"] != first["project_id"]
    assert replacement["project_name"] == INTRODUCTORY_PROJECT_NAME
    assert len(replacement["plan"]["tasks"]) == 5
    restored = client.get("/api/workspace", headers={"X-Workspace-Token": first["workspace_token"]})
    assert restored.json()["active_project"]["project_id"] == replacement["project_id"]


def test_unauthorized_project_metadata_operations_do_not_change_the_workspace(client):
    first = client.post("/api/projects").json()
    assert client.patch(f"/api/projects/{first['project_id']}", headers={"X-Workspace-Token": "wrong"}, json={"name": "No"}).status_code == 404
    assert client.delete(f"/api/projects/{first['project_id']}", headers={"X-Workspace-Token": "wrong"}).status_code == 404
    loaded = client.get(f"/api/projects/{first['project_id']}", headers={"X-Workspace-Token": first["workspace_token"]}).json()
    assert loaded["project_name"] == INTRODUCTORY_PROJECT_NAME
