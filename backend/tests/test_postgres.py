import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.main import seeded_tasks
from app.models import Plan
from app.repositories import ProjectRepository, VersionConflict


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")


def test_migrations_jsonb_and_optimistic_locking_on_postgresql():
    schema = f"ganttai_test_{uuid.uuid4().hex}"
    admin_engine = create_engine(TEST_DATABASE_URL)
    schema_url = make_url(TEST_DATABASE_URL).update_query_dict({"options": f"-csearch_path={schema}"})
    engine = None
    previous_database_url = os.environ.get("DATABASE_URL")
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        os.environ["DATABASE_URL"] = schema_url.render_as_string(hide_password=False)
        backend = Path(__file__).resolve().parents[1]
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "alembic"))
        command.upgrade(config, "20260930_02")
        pre_migration_engine = create_engine(schema_url)
        with pre_migration_engine.begin() as connection:
            connection.execute(text("INSERT INTO workspaces (id, token_hash, created_at) VALUES ('legacy-workspace', :hash, now())"), {"hash": "0" * 64})
            connection.execute(text("INSERT INTO projects (id, workspace_id, current_version, created_at) VALUES ('legacy-project', 'legacy-workspace', 1, now())"))
        pre_migration_engine.dispose()
        command.upgrade(config, "head")

        engine = create_engine(schema_url)
        columns = {column["name"]: column["type"] for column in inspect(engine).get_columns("plan_versions")}
        assert isinstance(columns["plan"], JSONB)
        project_columns = {column["name"]: column for column in inspect(engine).get_columns("projects")}
        assert project_columns["name"]["nullable"] is False
        assert project_columns["name"]["type"].length == 64
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM workspaces")) == 0

        repository = ProjectRepository(sessionmaker(engine, expire_on_commit=False))
        token, project = repository.create(Plan(tasks=seeded_tasks()), "PostgreSQL")
        changed = project.plan.model_copy(deep=True)
        changed.tasks[0].description = "PostgreSQL JSONB"
        assert repository.commit_plan(project.project_id, token, 1, changed, "test") == 2
        with pytest.raises(VersionConflict):
            repository.commit_plan(project.project_id, token, 1, changed, "stale")
        assert repository.load(project.project_id, token).plan.tasks[0].description == "PostgreSQL JSONB"
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url
        if engine:
            engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()
