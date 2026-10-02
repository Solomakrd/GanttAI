from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import pytest

from app.db import Base
from app.main import seeded_tasks
from app.models import Plan
from app.repositories import AccessDenied, ConversationRecord, MessageRecord, PlanVersionRecord, ProjectRepository, VersionConflict, WorkspaceRecord, token_hash


@pytest.fixture
def repository(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'repository.db'}")
    Base.metadata.create_all(engine)
    return ProjectRepository(sessionmaker(engine, expire_on_commit=False))


def test_create_load_commit_reload_and_token_hash(repository):
    token, initial = repository.create(Plan(tasks=seeded_tasks()), "Intro")
    changed = initial.plan.model_copy(deep=True)
    changed.tasks[0].description = "Persisted"
    version = repository.commit_plan(initial.project_id, token, 1, changed, "chat", "change it", "Changed it.")
    loaded = repository.load(initial.project_id, token)
    assert version == loaded.version == 2
    assert loaded.plan.tasks[0].description == "Persisted"
    assert [message["role"] for message in loaded.messages][-2:] == ["user", "assistant"]
    with repository.factory() as session:
        workspace = session.scalar(select(WorkspaceRecord))
        assert workspace.token_hash == token_hash(token)
        assert token not in workspace.token_hash
        assert len(session.scalars(select(PlanVersionRecord)).all()) == 2


def test_one_workspace_token_owns_and_lists_multiple_projects(repository):
    token, first = repository.create(Plan(tasks=seeded_tasks()), "First")
    returned_token, second = repository.create(Plan(tasks=[]), "Second", token)
    workspace = repository.resolve(token)
    assert returned_token == token
    assert [item.project_id for item in workspace.projects] == [first.project_id, second.project_id]
    assert [item.project_name for item in workspace.projects] == ["First", "Second"]
    assert second.plan.tasks == []
    assert workspace.active_project.project_id == second.project_id
    assert repository.load(first.project_id, token).project_id == first.project_id
    with pytest.raises(AccessDenied):
        repository.load(first.project_id, "another-token")


def test_stale_commit_rolls_back_without_messages_or_versions(repository):
    token, initial = repository.create(Plan(tasks=seeded_tasks()), "Intro")
    before = repository.load(initial.project_id, token)
    with pytest.raises(VersionConflict):
        repository.commit_plan(initial.project_id, token, 0, before.plan, "chat", "stale", "bad")
    after = repository.load(initial.project_id, token)
    assert after == before


def test_undo_creates_another_immutable_version(repository):
    token, initial = repository.create(Plan(tasks=seeded_tasks()), "Intro")
    changed = initial.plan.model_copy(deep=True)
    changed.tasks[0].assignee = "Other"
    repository.commit_plan(initial.project_id, token, 1, changed, "chat")
    version, restored = repository.undo(initial.project_id, token, 2)
    assert version == 3
    assert restored == initial.plan


def test_rename_is_metadata_only_and_delete_removes_the_complete_aggregate(repository):
    token, first = repository.create(Plan(tasks=seeded_tasks()), "First")
    _, second = repository.create(Plan(tasks=[]), "Second", token)
    renamed = repository.rename(first.project_id, token, "Renamed")
    assert renamed.project_name == "Renamed"
    assert renamed.version == 1

    workspace = repository.delete(first.project_id, token, Plan(tasks=seeded_tasks()), "Intro")
    assert [item.project_id for item in workspace.projects] == [second.project_id]
    assert workspace.active_project.project_id == second.project_id
    with repository.factory() as session:
        assert not session.scalars(select(PlanVersionRecord).where(PlanVersionRecord.project_id == first.project_id)).all()
        assert not session.scalars(select(ConversationRecord).where(ConversationRecord.project_id == first.project_id)).all()
        assert not session.scalars(select(MessageRecord).join(ConversationRecord).where(ConversationRecord.project_id == first.project_id)).all()


def test_delete_last_project_reseeds_the_same_workspace(repository):
    token, first = repository.create(Plan(tasks=[]), "Only")
    workspace = repository.delete(first.project_id, token, Plan(tasks=seeded_tasks()), "Intro")
    assert len(workspace.projects) == 1
    assert workspace.active_project.project_id != first.project_id
    assert workspace.active_project.project_name == "Intro"
    assert len(workspace.active_project.plan.tasks) == 5
    assert repository.resolve(token).active_project.project_id == workspace.active_project.project_id
