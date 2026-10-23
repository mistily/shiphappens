from __future__ import annotations

import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from run import app

client = TestClient(app)

response = client.get("/health")
assert response.status_code == 200, response.text
assert response.json()["status"] == "ok", response.json()

response = client.get("/agents")
assert response.status_code == 200, response.text

payload = {
    "prompt": "Example orchestration request",
    "context": {"demo": True},
    "agents": ["planner", "researcher", "executor"],
}
response = client.post("/run", json=payload)
assert response.status_code == 200, response.text
print("validation passed")
