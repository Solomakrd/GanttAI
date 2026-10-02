import pytest

from app.db import create_schema


def test_runtime_schema_creation_is_disabled_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="Alembic"):
        create_schema()
