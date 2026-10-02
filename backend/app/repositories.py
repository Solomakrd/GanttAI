import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .db import Base, session_factory
from .models import Plan, ProjectSnapshot, WorkspaceProject, WorkspaceSnapshot


JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class WorkspaceRecord(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    projects: Mapped[list["ProjectRecord"]] = relationship(cascade="all, delete-orphan")


class ProjectRecord(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    versions: Mapped[list["PlanVersionRecord"]] = relationship(cascade="all, delete-orphan")
    conversation: Mapped["ConversationRecord"] = relationship(cascade="all, delete-orphan", uselist=False)


class PlanVersionRecord(Base):
    __tablename__ = "plan_versions"
    __table_args__ = (UniqueConstraint("project_id", "version"),)
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    plan: Mapped[dict] = mapped_column(JSON_TYPE, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ConversationRecord(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    messages: Mapped[list["MessageRecord"]] = relationship(cascade="all, delete-orphan")


class MessageRecord(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="message")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class VersionConflict(Exception):
    pass


class AccessDenied(Exception):
    pass


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class ProjectRepository:
    def __init__(self, factory=None):
        self.factory = factory or session_factory()

    def create(self, plan: Plan, name: str, token=None):
        new_token = token or secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        project_id, conversation_id = str(uuid.uuid4()), str(uuid.uuid4())
        with self.factory.begin() as session:
            if token:
                workspace = session.scalar(select(WorkspaceRecord).where(WorkspaceRecord.token_hash == token_hash(token)))
                if not workspace:
                    raise AccessDenied()
                workspace_id = workspace.id
            else:
                workspace_id = str(uuid.uuid4())
                session.add(WorkspaceRecord(id=workspace_id, token_hash=token_hash(new_token), created_at=now))
                session.flush()
            session.add(ProjectRecord(id=project_id, name=name, workspace_id=workspace_id, current_version=1, created_at=now))
            session.flush()
            session.add(PlanVersionRecord(project_id=project_id, version=1, plan=plan.model_dump(mode="json"), source="seed", created_at=now))
            session.add(ConversationRecord(id=conversation_id, project_id=project_id, created_at=now))
            session.flush()
            session.add(MessageRecord(conversation_id=conversation_id, role="system", kind="system", content="Seed plan created.", created_at=now))
        return new_token, self.load(project_id, new_token)

    def resolve(self, token):
        with self.factory() as session:
            workspace = session.scalar(select(WorkspaceRecord).where(WorkspaceRecord.token_hash == token_hash(token)))
            if not workspace:
                raise AccessDenied()
            projects = session.scalars(select(ProjectRecord).where(ProjectRecord.workspace_id == workspace.id).order_by(ProjectRecord.created_at, ProjectRecord.id)).all()
        if not projects:
            raise AccessDenied()
        active = self.load(projects[-1].id, token)
        return WorkspaceSnapshot(projects=[WorkspaceProject(project_id=item.id, project_name=item.name, version=item.current_version,
                                                             created_at=item.created_at) for item in projects],
                                 active_project=active)

    def load(self, project_id, token):
        with self.factory() as session:
            project = session.scalar(select(ProjectRecord).join(WorkspaceRecord).where(
                ProjectRecord.id == project_id, WorkspaceRecord.token_hash == token_hash(token)))
            if not project:
                raise AccessDenied()
            version = session.scalar(select(PlanVersionRecord).where(PlanVersionRecord.project_id == project_id, PlanVersionRecord.version == project.current_version))
            conversation = session.scalar(select(ConversationRecord).where(ConversationRecord.project_id == project_id))
            messages = session.scalars(select(MessageRecord).where(MessageRecord.conversation_id == conversation.id).order_by(MessageRecord.id)).all()
            return ProjectSnapshot(project_id=project.id, project_name=project.name, conversation_id=conversation.id, version=project.current_version,
                                   plan=Plan.model_validate(version.plan), messages=[{"id": m.id, "role": m.role, "content": m.content, "kind": m.kind} for m in messages])

    def rename(self, project_id, token, name):
        with self.factory.begin() as session:
            project = session.scalar(select(ProjectRecord).join(WorkspaceRecord).where(
                ProjectRecord.id == project_id, WorkspaceRecord.token_hash == token_hash(token)).with_for_update())
            if not project:
                raise AccessDenied()
            project.name = name
        return self.load(project_id, token)

    def delete(self, project_id, token, seed_plan: Plan, seed_name: str):
        now = datetime.now(timezone.utc)
        with self.factory.begin() as session:
            workspace = session.scalar(select(WorkspaceRecord).where(
                WorkspaceRecord.token_hash == token_hash(token)).with_for_update())
            if not workspace:
                raise AccessDenied()
            project = session.scalar(select(ProjectRecord).where(
                ProjectRecord.id == project_id, ProjectRecord.workspace_id == workspace.id))
            if not project:
                raise AccessDenied()
            session.delete(project)
            session.flush()
            remaining = session.scalars(select(ProjectRecord).where(
                ProjectRecord.workspace_id == workspace.id).order_by(ProjectRecord.created_at, ProjectRecord.id)).all()
            if not remaining:
                replacement_id, conversation_id = str(uuid.uuid4()), str(uuid.uuid4())
                session.add(ProjectRecord(id=replacement_id, name=seed_name, workspace_id=workspace.id,
                                          current_version=1, created_at=now))
                session.flush()
                session.add(PlanVersionRecord(project_id=replacement_id, version=1,
                                              plan=seed_plan.model_dump(mode="json"), source="seed", created_at=now))
                session.add(ConversationRecord(id=conversation_id, project_id=replacement_id, created_at=now))
                session.flush()
                session.add(MessageRecord(conversation_id=conversation_id, role="system", kind="system",
                                          content="Seed plan created.", created_at=now))
        return self.resolve(token)

    def append_message(self, project_id, token, role, content, kind="message"):
        with self.factory.begin() as session:
            project = session.scalar(select(ProjectRecord).join(WorkspaceRecord).where(
                ProjectRecord.id == project_id, WorkspaceRecord.token_hash == token_hash(token)))
            if not project:
                raise AccessDenied()
            conversation_id = session.scalar(select(ConversationRecord.id).where(ConversationRecord.project_id == project_id))
            session.add(MessageRecord(conversation_id=conversation_id, role=role, content=content, kind=kind, created_at=datetime.now(timezone.utc)))

    def commit_plan(self, project_id, token, expected_version, plan: Plan, source, user_message=None, assistant_message=None, system_message=None):
        now = datetime.now(timezone.utc)
        with self.factory.begin() as session:
            project = session.scalar(select(ProjectRecord).join(WorkspaceRecord).where(
                ProjectRecord.id == project_id, WorkspaceRecord.token_hash == token_hash(token)).with_for_update())
            if not project:
                raise AccessDenied()
            if project.current_version != expected_version:
                raise VersionConflict()
            next_version = expected_version + 1
            session.add(PlanVersionRecord(project_id=project_id, version=next_version, plan=plan.model_dump(mode="json"), source=source, created_at=now))
            project.current_version = next_version
            conversation_id = session.scalar(select(ConversationRecord.id).where(ConversationRecord.project_id == project_id))
            for role, content, kind in (("user", user_message, "message"), ("assistant", assistant_message, "message"), ("system", system_message, "system")):
                if content:
                    session.add(MessageRecord(conversation_id=conversation_id, role=role, content=content, kind=kind, created_at=now))
        return next_version

    def undo(self, project_id, token, expected_version):
        if expected_version <= 1:
            raise ValueError("There is no earlier plan version to restore.")
        with self.factory() as session:
            prior = session.scalar(select(PlanVersionRecord).where(PlanVersionRecord.project_id == project_id, PlanVersionRecord.version == expected_version - 1))
            if not prior:
                raise ValueError("The prior plan version is unavailable.")
            plan = Plan.model_validate(prior.plan)
        version = self.commit_plan(project_id, token, expected_version, plan, "undo", assistant_message="Restored the previous plan as a new version.")
        return version, plan
