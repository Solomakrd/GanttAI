#!/bin/sh
set -eu

project="ganttai-smoke-$(date +%s)-$$"
response_file=$(mktemp)
export POSTGRES_DB=ganttai
export POSTGRES_USER=ganttai
export POSTGRES_PASSWORD=smoke-test-password
export DATABASE_URL=postgresql+psycopg://ganttai:smoke-test-password@postgres:5432/ganttai
export OPENROUTER_API_KEY=
export HTTP_PORT=0

cleanup() {
  docker compose --project-name "$project" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$response_file"
}
trap cleanup EXIT

if env -u POSTGRES_PASSWORD -u DATABASE_URL docker compose --env-file /dev/null config --quiet >/dev/null 2>&1; then
  printf '%s\n' "Compose accepted missing database credentials" >&2
  exit 1
fi

docker compose --project-name "$project" up --detach --build --wait
published_address=$(docker compose --project-name "$project" port web 80)
HTTP_PORT=${published_address##*:}
base_url="http://127.0.0.1:$HTTP_PORT"
curl --fail --silent "$base_url/" >/dev/null
curl --fail --silent --request POST "$base_url/api/projects" > "$response_file"

RESPONSE_FILE="$response_file" HTTP_PORT="$HTTP_PORT" backend/.venv/bin/python - <<'PY'
import json
import os

from websockets.sync.client import connect

with open(os.environ["RESPONSE_FILE"], encoding="utf-8") as response:
    project = json.load(response)

with connect(f"ws://127.0.0.1:{os.environ['HTTP_PORT']}/api/projects/{project['project_id']}/chat") as socket:
    socket.send(json.dumps({"type": "auth", "token": project["workspace_token"]}))
    connected = json.loads(socket.recv())
    assert connected == {"type": "connected", "version": project["version"]}
    socket.send(json.dumps({"type": "message", "content": "Move a task", "expected_version": project["version"]}))
    while True:
        event = json.loads(socket.recv())
        if event.get("type") == "error":
            assert event["code"] == "configuration"
            assert "smoke-test-password" not in event["message"]
            break
PY

docker compose --project-name "$project" down
docker compose --project-name "$project" up --detach --wait

RESPONSE_FILE="$response_file" HTTP_PORT="$HTTP_PORT" backend/.venv/bin/python - <<'PY'
import json
import os
import urllib.request

with open(os.environ["RESPONSE_FILE"], encoding="utf-8") as response:
    project = json.load(response)

request = urllib.request.Request(
    f"http://127.0.0.1:{os.environ['HTTP_PORT']}/api/workspace",
    headers={"X-Workspace-Token": project["workspace_token"]},
)
with urllib.request.urlopen(request) as response:
    workspace = json.load(response)
assert workspace["active_project"]["project_id"] == project["project_id"]
PY

published=$(docker compose --project-name "$project" ps --format json)
PUBLISHED="$published" backend/.venv/bin/python - <<'PY'
import json
import os

rows = [json.loads(line) for line in os.environ["PUBLISHED"].splitlines() if line]
published = {
    row["Service"] for row in rows
    if any(binding.get("PublishedPort", 0) for binding in row.get("Publishers", []))
}
assert published == {"web"}, published
PY

printf '%s\n' "Production Compose smoke test passed"
