FROM python@sha256:eeb8088e67610b37583880c7627e3931f087cba55a35810819e34a398f624a47

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.lock .
RUN pip install --no-cache-dir --require-hashes --requirement requirements.lock \
    && useradd --create-home --uid 10001 app

COPY --chown=app:app backend/alembic.ini .
COPY --chown=app:app backend/alembic ./alembic
COPY --chown=app:app backend/app ./app

USER app

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
