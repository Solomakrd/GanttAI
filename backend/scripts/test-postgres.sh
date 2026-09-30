#!/bin/sh
set -eu

: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a disposable PostgreSQL database URL}"
PYTHONPATH=backend uv run --python 3.12 --with-requirements backend/requirements.txt \
  python -m pytest backend/tests/test_postgres.py
