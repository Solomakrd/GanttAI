from fastapi.testclient import TestClient
from sqlalchemy import create_engine

import app.main as main


client = TestClient(main.app)


def test_empty_cors_setting_keeps_local_development_origins(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "")
    monkeypatch.delenv("APP_ENV", raising=False)
    assert main.cors_origin_values() == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_empty_cors_setting_disables_cors_in_production(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "")
    monkeypatch.setenv("APP_ENV", "production")
    assert main.cors_origin_values() == []


def test_liveness_does_not_touch_database(monkeypatch):
    monkeypatch.setattr(main, "get_engine", lambda: (_ for _ in ()).throw(AssertionError("database accessed")))
    assert client.get("/health/live").json() == {"status": "ok"}


def test_readiness_checks_database(monkeypatch):
    engine = create_engine("sqlite://")
    monkeypatch.setattr(main, "get_engine", lambda: engine)
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_fails_when_database_is_unavailable(monkeypatch):
    engine = create_engine("sqlite:////missing-parent/database.sqlite")
    monkeypatch.setattr(main, "get_engine", lambda: engine)
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
