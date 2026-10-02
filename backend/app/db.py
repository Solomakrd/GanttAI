import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine():
    url = os.getenv("DATABASE_URL", "postgresql+psycopg://ganttai:ganttai@localhost:5432/ganttai")
    options = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, pool_pre_ping=True, connect_args=options)


def session_factory():
    return sessionmaker(get_engine(), expire_on_commit=False)


def create_schema():
    # Alembic is used in deployed environments; this keeps isolated test databases simple.
    if os.getenv("APP_ENV") == "production":
        raise RuntimeError("Schema creation is disabled in production; run Alembic migrations.")
    from . import repositories  # noqa: F401
    Base.metadata.create_all(get_engine())
