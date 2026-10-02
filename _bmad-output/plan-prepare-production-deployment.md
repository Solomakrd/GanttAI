---
title: 'Prepare production deployment'
type: 'chore'
ticket: ''
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
baseline_revision: '233aa2f3eec0dae05fd92cfaedb514656dd4bdec'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The application runs locally but has no production images, process configuration, reverse proxy, health checks, safe production database configuration, or server deployment instructions. Its frontend defaults to localhost, the API creates schema at request time, and the existing Compose file exposes a development-only PostgreSQL instance.

**Approach:** Package the React frontend, FastAPI backend, and selected PostgreSQL topology into a reproducible production deployment with same-origin HTTP/WebSocket routing, explicit migrations, health checks, persistent data, environment-driven secrets, and operator documentation.

## Boundaries & Constraints

**Always:** Keep secrets outside images and Git; run Alembic before API startup; preserve PostgreSQL data across container replacement; serve frontend and `/api` from one public origin; proxy WebSocket upgrades; use reproducible locked dependencies; keep local development documented and functional.

**Never:** Bake `.env` or API keys into images; expose PostgreSQL publicly; use Uvicorn reload mode in production; rely on runtime `create_all` in production; introduce Kubernetes or cloud-specific infrastructure unless selected below; change application features or persistence contracts.

## Deployment Decisions

- Target one Linux VPS using Docker Compose.
- Publish the application initially over plain HTTP on the server IP; keep the proxy configuration easy to upgrade to domain-based HTTPS later.
- Run PostgreSQL inside the Compose stack with a persistent named volume; backups and restores are the VPS operator's responsibility.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Fresh deployment | Empty persistent database | Migrations complete, API becomes healthy, SPA loads and creates a project | API does not receive traffic until dependencies are ready |
| Existing deployment | Existing PostgreSQL volume and new image | Migrations run once and existing workspace/project data remains available | Failed migration prevents API startup without deleting data |
| Browser HTTP and chat | Public HTTPS origin | `/api` and WebSocket chat use the same origin through the proxy | Proxy preserves upgrades and returns useful gateway failures |
| Missing required secret | No OpenRouter key or database credential | Deployment fails clearly or chat reports configuration failure without leaking secrets | Secret values never appear in committed configuration |

</frozen-after-approval>

## Code Map

- `docker-compose.yml` -- currently provisions only a host-exposed development PostgreSQL; retain local workflow or split production configuration cleanly.
- `.env.example` -- documents backend variables but contains development credentials and omits deployment/domain settings.
- `.gitignore` -- already excludes real environment files; deployment additions must preserve that boundary.
- `backend/requirements.txt` and production lock file -- direct development dependencies plus a fully resolved, hash-checked production dependency set; container builds must not resolve mutable transitive versions.
- `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/versions/` -- authoritative production schema migration chain using `DATABASE_URL`.
- `backend/app/db.py:get_engine,create_schema` -- database engine and request-time schema creation; production must use Alembic without breaking SQLite-backed tests.
- `backend/app/main.py:app,repository` -- FastAPI entrypoint, hard-coded development CORS, and missing liveness/readiness endpoints.
- `frontend/package-lock.json`, `frontend/package.json` -- reproducible Vite build via `npm ci` and `npm run build`; Node 22.12+ is required by the lockfile.
- `frontend/src/api.js:API_URL,connectProjectChat` -- localhost fallback and derived WebSocket URL; same-origin production should work without a baked host.
- `README.md` -- local-only operating instructions and verification commands; add deployment, migration, backup/update, and rollback guidance.

## Tasks & Acceptance

**Execution:**
- [x] `backend/Dockerfile`, `frontend/Dockerfile`, `.dockerignore`, backend production lock file -- add small reproducible production images using immutable base references and fully locked runtime dependencies, with non-root runtime where practical and no source secrets.
- [x] `docker-compose.yml` plus production proxy configuration -- define health-ordered services, private networking, persistent database storage, migration-before-start behavior, static SPA delivery, same-origin API/WebSocket proxying, upload capacity matching the API contract, and restart policies while preserving a usable local workflow.
- [x] `backend/app/db.py`, `backend/app/main.py`, backend tests -- disable implicit production schema creation, retain local Vite CORS when the sourced deployment variable is empty outside production, and add liveness plus database-aware readiness probes.
- [x] `frontend/src/api.js` and focused tests -- default production requests to the current origin while retaining an explicit Vite API override for local/separate-origin use.
- [x] `.env.example`, `README.md` -- document required secrets/settings, first deploy, DNS/TLS prerequisites, upgrades, migrations, backups, restore/rollback, logs, and verification.

**Acceptance Criteria:**
- Given a clean Docker host and documented environment values, when the deployment command runs, then all services become healthy and the app is available through one public origin.
- Given a redeploy with an existing database volume, when containers are rebuilt and restarted, then migrations apply and prior workspace data remains intact.
- Given no host port exception for PostgreSQL, when inspecting published ports, then only the public web entrypoint is reachable externally.
- Given the documented verification commands, when run, then backend tests, frontend tests/build, image builds, and Compose configuration validation succeed.

## Implementation Notes

- Added digest-pinned multi-stage images and a universal, hash-checked Python lock. FastAPI was raised to `0.118.0` because the previous `0.115.6` pin could not resolve with MCP 2.2.0's Starlette requirement; `greenlet` is explicit so Linux ARM64 builds are complete.
- Added `deploy/smoke-test.sh` to exercise fresh migration/startup, same-origin HTTP and WebSocket traffic, safe missing-key failure, persistent-volume redeployment, and public-port isolation against a uniquely named ephemeral Compose project and port.
- Added production schema safeguards, configurable local/production CORS behavior, liveness/readiness probes, same-origin frontend defaults, and a 3 MiB proxy request boundary so FastAPI remains authoritative for the documented 2 MiB upload limit.

## Plan Change Log

- Review found that the original dependency task treated direct Python pins and mutable base tags as reproducible. Require a fully resolved production lock and immutable base references so rebuilds cannot silently change runtime contents. KEEP the multi-stage frontend, non-root backend, migration gate, health ordering, same-origin proxy, private database, persistence smoke coverage, and operator documentation; also preserve fixes for local empty-value CORS, proxy upload size, and collision-safe smoke isolation during re-derivation.

## Review Triage Log

- `medium` / `patch` -- `.env.example` sets `CORS_ORIGINS=` and the documented local shell sources it, so `os.getenv` suppresses the development default and cross-origin Vite API requests fail; production/local environment handling must distinguish an empty production setting from the local default.
- `medium` / `patch` -- Nginx's default 1 MiB request limit rejects workbook requests that the application explicitly permits up to 2 MiB plus multipart overhead; the proxy limit must exceed the application boundary while FastAPI remains authoritative.
- `medium` / `bad_plan` -- mutable base tags and direct-only Python pins allow the same revision to resolve different runtime contents; the plan incorrectly described these inputs as reproducibly locked and now explicitly requires immutable bases and a fully resolved production lock.
- `medium` / `patch` -- the fixed `ganttai-smoke` Compose project lets concurrent or pre-existing runs stop containers and delete a shared volume; every smoke run needs a unique project name and cleanup scoped to it.
- `low` / `patch` -- the plan's backend verification command lacked the required backend working directory and collected unrelated repository tests; corrected the command to match the verified invocation.
- `medium` / `patch` -- the README's Node 22.12 minimum was below the `22.22.2` engine floor in the committed npm lock; raised the documented local prerequisite.
- `medium` / `patch` -- deriving a smoke port from PID modulo 10,000 could still collide with a host process; Docker now assigns an available ephemeral port and the script discovers it after startup.

## Design Notes

Use a multi-stage frontend image and a dedicated reverse-proxy runtime so `VITE_API_URL` can be empty/current-origin in production. Keep migration execution serialized before API startup rather than allowing every web worker to race migrations. Liveness must not depend on PostgreSQL; readiness must verify database connectivity.

## Verification

**Commands:**
- `cd backend && ./.venv/bin/python -m pytest` -- expected: backend suite passes.
- `npm test -- --run` in `frontend/` -- expected: frontend suite passes.
- `npm run build` in `frontend/` -- expected: production bundle builds.
- `docker compose config` -- expected: deployment configuration resolves without errors and does not expose secret values in committed files.
- `docker compose build` -- expected: production images build from a clean context.

**Results (2026-10-02):** backend 101 passed/1 optional PostgreSQL test skipped; frontend 62 passed; frontend production build passed; Compose config and digest-pinned image builds passed; isolated production Compose smoke test passed all deployment matrix scenarios including persistent redeployment and WebSocket proxying.
