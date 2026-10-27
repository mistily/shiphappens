from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.generator import generator
from app.hmem import hmem_store
from app.logger import emit_jsonl


class WorldModelStore:
    """Timeline-based world model that preserves provenance and ingests through H-MEM."""

    def __init__(self, base_dir: Optional[str] = None):
        self.base_dir = Path(base_dir or Path(__file__).resolve().parents[1])
        self.log_dir = self.base_dir / "logs"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.entities: Dict[str, Dict[str, Any]] = {}
        self.timeline: List[Dict[str, Any]] = []
        self.edge_store: List[Dict[str, Any]] = []
        self._seen_hashes: set[str] = set()
        self._load_state()

    @staticmethod
    def stable_hash(value: str) -> str:
        return hashlib.sha1(value.lower().encode("utf-8")).hexdigest()[:12]

    @staticmethod
    def entity_id(name: str) -> str:
        return f"ent_{WorldModelStore.stable_hash(name)}"

    def _load_state(self) -> None:
        path = self.log_dir / "world_ingest.jsonl"
        if not path.exists():
            return
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if payload.get("event") == "ingest":
                    self._seen_hashes.add(payload["payloadHash"])
                    self.timeline.append(payload)
        self._rebuild_aggregates()

    def _persist_aggregate(self, entity: Dict[str, Any]) -> None:
        self.entities[entity["id"]] = entity

    def _rebuild_aggregates(self) -> None:
        by_id: Dict[str, Dict[str, Any]] = {}
        for record in self.timeline:
            entity_id = record.get("entityId")
            if not entity_id:
                continue
            by_id.setdefault(entity_id, {"id": entity_id, "aggregates": [], "edges": []})
            by_id[entity_id]["aggregates"].append(record)
        self.entities = by_id

    def ingest(self, payload: Dict[str, Any], *, agentId: str, runId: str, taskId: str) -> Dict[str, Any]:
        payload_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()
        if payload_hash in self._seen_hashes:
            return {"status": "idempotent_noop", "payloadHash": payload_hash}

        ts = datetime.now(timezone.utc).isoformat()
        entity_name = str(payload.get("entity") or payload.get("source") or "unspecified")
        entity_id = self.entity_id(entity_name)
        event = {
            "ts": ts,
            "engine": "world_model",
            "event": "ingest",
            "agentId": agentId,
            "runId": runId,
            "taskId": taskId,
            "entityId": entity_id,
            "entity_name": entity_name,
            "payload": payload,
            "payloadHash": payload_hash,
        }
        self.timeline.append(event)
        self._seen_hashes.add(payload_hash)
        self._persist_aggregate({
            "id": entity_id,
            "name": entity_name,
            "aggregates": [event],
            "provenance": payload.get("source") or "tool_result",
            "lifecycle": ["persist_aggregates", "persist_edges", "rebuild_aggregates"],
        })
        self.edge_store.append({
            "from": entity_id,
            "to": "run:%s" % runId,
            "type": "observed_in_run",
            "ts": ts,
        })

        # World Model memory seam: H-MEM is the memory substrate; World Model only consumes it.
        hmem_store.mine(
            event="world_model_ingest",
            payload={
                "source": "world_model",
                "summary": f"Ingested {entity_name} for run {runId}",
                "confidence": 0.75,
                "entities": [entity_id],
                "tags": ["world_model", entity_name],
            },
            agentId=agentId,
            runId=runId,
            taskId=taskId,
        )

        emit_jsonl("world_ingest.jsonl", {"event": "ingest", "payloadHash": payload_hash, "entityId": entity_id, "payload": payload})
        self._rebuild_aggregates()
        return {"status": "ingested", "entityId": entity_id, "payloadHash": payload_hash}

    def build_context(self, intent: str, *, budget: int = 1500) -> Dict[str, Any]:
        recent = self.timeline[-10:]
        trace = {
            "intent": intent,
            "entity_count": len(self.entities),
            "aggregate_count": len(self.timeline),
            "budget": budget,
        }
        context = {
            "entities": [
                {
                    "id": item["id"],
                    "name": item.get("name"),
                    "aggregates": item.get("aggregates", [])[:3],
                    "provenance": item.get("provenance"),
                    "lifecycle": item.get("lifecycle", []),
                }
                for item in self.entities.values()
            ],
            "timeline": [entry for entry in recent],
            "trace_metadata": trace,
        }
        serialized = json.dumps(context, default=str, sort_keys=True)
        if len(serialized) > budget:
            serialized = serialized[:budget]
            context["truncated"] = True
        return context


world_model = WorldModelStore()
