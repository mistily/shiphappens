from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)


def ensure_jsonl(name: str) -> None:
    path = LOG_DIR / name
    if not path.exists():
        path.touch()


def emit_jsonl(name: str, payload: Dict[str, Any]) -> None:
    ensure_jsonl(name)
    record = {"ts": datetime.now(timezone.utc).isoformat(), **payload}
    with (LOG_DIR / name).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, default=str, sort_keys=True) + "\n")


def refresh_manifest() -> Dict[str, Any]:
    manifest = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "engines": {
            "hmem": {"status": "live"},
            "markovian": {"status": "live"},
            "world_model": {"status": "live"},
            "generator": {"status": "live"},
        },
        "helpers": {
            "logger": {"status": "live"},
            "generator_sample_mode": {"status": "live"},
            "hmem_retrieval": {"status": "live"},
            "world_model_context_builder": {"status": "live"},
        },
        "dormant": ["dreaming", "sleep", "enrichment", "supervisor_agent"],
    }
    (LOG_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest


def get_manifest() -> Dict[str, Any]:
    path = LOG_DIR / "manifest.json"
    if not path.exists():
        return refresh_manifest()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return refresh_manifest()


for _name in [
    "hmem_audit.jsonl",
    "hmem_retrieval_trace.jsonl",
    "markovian_runs.jsonl",
    "world_ingest.jsonl",
    "sample_trace.jsonl",
]:
    ensure_jsonl(_name)

refresh_manifest()


def emit_trace(event: str, payload: Optional[Dict[str, Any]] = None) -> None:
    emit_jsonl("sample_trace.jsonl", {"event": event, "payload": payload or {}})
