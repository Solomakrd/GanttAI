from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import pytest

from app.db import Base
from app.main import seeded_tasks
from app.models import Plan
from app.repositories import AccessDenied, ChatRequestRecord, PlanVersionRecord, ProjectRepository, RequestCollision, RequestOwnershipLost, VersionConflict, WorkspaceRecord, token_hash


@pytest.fixture
def repository(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'repository.db'}")
    Base.metadata.create_all(engine)
    return ProjectRepository(sessionmaker(engine, expire_on_commit=False))


def test_create_load_commit_reload_and_token_hash(repository):
    token, initial = repository.create(Plan(tasks=seeded_tasks()))
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
    token, first = repository.create(Plan(tasks=seeded_tasks()))
    returned_token, second = repository.create(Plan(tasks=seeded_tasks()), token)
    workspace = repository.resolve(token)
    assert returned_token == token
    assert [item.project_id for item in workspace.projects] == [first.project_id, second.project_id]
    assert workspace.active_project.project_id == second.project_id
    assert repository.load(first.project_id, token).project_id == first.project_id
    with pytest.raises(AccessDenied):
        repository.load(first.project_id, "another-token")


def test_stale_commit_rolls_back_without_messages_or_versions(repository):
    token, initial = repository.create(Plan(tasks=seeded_tasks()))
    before = repository.load(initial.project_id, token)
    with pytest.raises(VersionConflict):
        repository.commit_plan(initial.project_id, token, 0, before.plan, "chat", "stale", "bad")
    after = repository.load(initial.project_id, token)
    assert after == before


def test_undo_creates_another_immutable_version(repository):
    token, initial = repository.create(Plan(tasks=seeded_tasks()))
    changed = initial.plan.model_copy(deep=True)
    changed.tasks[0].assignee = "Other"
    repository.commit_plan(initial.project_id, token, 1, changed, "chat")
    version, restored = repository.undo(initial.project_id, token, 2)
    assert version == 3
    assert restored == initial.plan


def test_chat_request_claim_collision_release_and_expired_lease_recovery(repository):
    token, project = repository.create(Plan(tasks=seeded_tasks()))
    claim, _, first_owner = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)
    assert claim == "claimed"
    assert repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)[0] == "processing"
    with pytest.raises(RequestCollision):
        repository.claim_chat_request(project.project_id, token, "stable-id", "different", 1)

    repository.release_chat_request(project.project_id, "stable-id", first_owner)
    claim, _, second_owner = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)
    assert claim == "claimed"
    with repository.factory.begin() as session:
        record = session.scalar(select(ChatRequestRecord))
        record.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    claim, _, third_owner = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)
    assert claim == "claimed"
    assert third_owner not in {first_owner, second_owner}


def test_chat_request_finalization_is_atomic_and_replays_terminal_result(repository):
    token, project = repository.create(Plan(tasks=seeded_tasks()))
    _, _, owner = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)
    changed = project.plan.model_copy(deep=True)
    changed.tasks[0].description = "Changed once"
    terminal = repository.finalize_chat_request(project.project_id, token, "stable-id", owner, changed, "Done.", True)
    replay = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)

    assert replay == ("completed", terminal, None)
    loaded = repository.load(project.project_id, token)
    assert loaded.version == 2
    assert [message["role"] for message in loaded.messages][-2:] == ["user", "assistant"]
    with repository.factory() as session:
        assert len(session.scalars(select(PlanVersionRecord)).all()) == 2


def test_expired_lease_fences_the_stale_owner_and_only_replacement_can_finalize(repository):
    token, project = repository.create(Plan(tasks=seeded_tasks()))
    _, _, stale_owner = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)
    with repository.factory.begin() as session:
        session.scalar(select(ChatRequestRecord)).lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    _, _, replacement_owner = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)
    changed = project.plan.model_copy(deep=True)
    changed.tasks[0].description = "Replacement won"

    with pytest.raises(RequestOwnershipLost):
        repository.finalize_chat_request(project.project_id, token, "stable-id", stale_owner, changed, "Stale.", True)
    terminal = repository.finalize_chat_request(
        project.project_id, token, "stable-id", replacement_owner, changed, "Replacement.", True,
    )

    assert terminal["type"] == "complete"
    loaded = repository.load(project.project_id, token)
    assert loaded.version == 2
    assert [message["role"] for message in loaded.messages].count("user") == 1
    assert [message["role"] for message in loaded.messages].count("assistant") == 1


@pytest.mark.parametrize("lease_expires_at", [None, datetime.now(timezone.utc) - timedelta(seconds=1)])
def test_chat_request_cannot_renew_a_missing_or_expired_lease(repository, lease_expires_at):
    token, project = repository.create(Plan(tasks=seeded_tasks()))
    _, _, owner = repository.claim_chat_request(project.project_id, token, "stable-id", "change it", 1)
    with repository.factory.begin() as session:
        session.scalar(select(ChatRequestRecord)).lease_expires_at = lease_expires_at

    assert not repository.renew_chat_request(project.project_id, "stable-id", owner)
