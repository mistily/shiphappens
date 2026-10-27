from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.logger import emit_jsonl


@dataclass
class MemoryRecord:
    id: str
    content: str
    type: str
    layer: str
    timestamp: str
    lastAccessed: str
    accessCount: int = 0
    tags: List[str] = field(default_factory=list)
    confidence: float = 0.0
    source: str = "unknown"
    domain: str = "general"
    entities: List[str] = field(default_factory=list)
    supersedes: Optional[str] = None
    derivedFrom: List[str] = field(default_factory=list)
    agentId: str = "system"
    runId: str = "default"
    taskId: str = "default"


class HMemStore:
    """Simple long-term memory store backed by SQLite and warmed from file at startup."""

    def __init__(self, db_path: Optional[str] = None):
        self.base_dir = Path(__file__).resolve().parents[1]
        self.log_dir = self.base_dir / "logs"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = Path(db_path or self.log_dir / "hmem_store.sqlite3")
        self._establish_schema()
        self._warm_start()

    def _establish_schema(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    type TEXT NOT NULL,
                    layer TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    lastAccessed TEXT NOT NULL,
                    accessCount INTEGER NOT NULL DEFAULT 0,
                    tags TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 0.0,
                    source TEXT NOT NULL DEFAULT 'unknown',
                    domain TEXT NOT NULL DEFAULT 'general',
                    entities TEXT NOT NULL,
                    supersedes TEXT,
                    derivedFrom TEXT NOT NULL,
                    agentId TEXT NOT NULL DEFAULT 'system',
                    runId TEXT NOT NULL DEFAULT 'default',
                    taskId TEXT NOT NULL DEFAULT 'default'
                )
                """
            )
            conn.commit()

    def _warm_start(self) -> None:
        self._load_from_jsonl()

    def _load_from_jsonl(self) -> None:
        path = self.log_dir / "hmem_audit.jsonl"
        if not path.exists():
            return
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self.create(record, source="audit_restore")

    def _row_to_record(self, row: sqlite3.Row) -> MemoryRecord:
        return MemoryRecord(
            id=row["id"],
            content=row["content"],
            type=row["type"],
            layer=row["layer"],
            timestamp=row["timestamp"],
            lastAccessed=row["lastAccessed"],
            accessCount=int(row["accessCount"]),
            tags=json.loads(row["tags"]),
            confidence=float(row["confidence"]),
            source=row["source"],
            domain=row["domain"],
            entities=json.loads(row["entities"]),
            supersedes=row["supersedes"],
            derivedFrom=json.loads(row["derivedFrom"]),
            agentId=row["agentId"],
            runId=row["runId"],
            taskId=row["taskId"],
        )

    def _record_to_payload(self, record: MemoryRecord) -> Dict[str, Any]:
        return {
            "id": record.id,
            "content": record.content,
            "type": record.type,
            "layer": record.layer,
            "timestamp": record.timestamp,
            "lastAccessed": record.lastAccessed,
            "accessCount": record.accessCount,
            "tags": record.tags,
            "confidence": record.confidence,
            "source": record.source,
            "domain": record.domain,
            "entities": record.entities,
            "supersedes": record.supersedes,
            "derivedFrom": record.derivedFrom,
            "agentId": record.agentId,
            "runId": record.runId,
            "taskId": record.taskId,
        }

    def create(self, record: Dict[str, Any] | MemoryRecord, source: str = "write") -> MemoryRecord:
        if isinstance(record, MemoryRecord):
            item = record
        else:
            item = MemoryRecord(
                id=str(record.get("id") or record.get("content", "")[:24]),
                content=str(record["content"]),
                type=str(record.get("type", "fact")),
                layer=str(record.get("layer", "short_term")),
                timestamp=str(record.get("timestamp") or datetime.now(timezone.utc).isoformat()),
                lastAccessed=str(record.get("lastAccessed") or datetime.now(timezone.utc).isoformat()),
                accessCount=int(record.get("accessCount", 0)),
                tags=list(record.get("tags") or []),
                confidence=float(record.get("confidence", 0.0)),
                source=str(record.get("source", source)),
                domain=str(record.get("domain", "general")),
                entities=list(record.get("entities") or []),
                supersedes=record.get("supersedes"),
                derivedFrom=list(record.get("derivedFrom") or []),
                agentId=str(record.get("agentId", "system")),
                runId=str(record.get("runId", "default")),
                taskId=str(record.get("taskId", "default")),
            )

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO memories
                (id, content, type, layer, timestamp, lastAccessed, accessCount, tags,
                 confidence, source, domain, entities, supersedes, derivedFrom, agentId, runId, taskId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.id,
                    item.content,
                    item.type,
                    item.layer,
                    item.timestamp,
                    item.lastAccessed,
                    item.accessCount,
                    json.dumps(item.tags),
                    item.confidence,
                    item.source,
                    item.domain,
                    json.dumps(item.entities),
                    item.supersedes,
                    json.dumps(item.derivedFrom),
                    item.agentId,
                    item.runId,
                    item.taskId,
                ),
            )
            conn.commit()

        emit_jsonl(
            "hmem_audit.jsonl",
            {
                "event": "create",
                "record": self._record_to_payload(item),
                "source": source,
            },
        )
        return item

    def read(self, memory_id: str) -> Optional[MemoryRecord]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_record(row)

    def update(self, memory_id: str, **updates: Any) -> Optional[MemoryRecord]:
        existing = self.read(memory_id)
        if existing is None:
            return None
        for key, value in updates.items():
            if hasattr(existing, key):
                setattr(existing, key, value)
        existing.lastAccessed = datetime.now(timezone.utc).isoformat()
        existing.accessCount += 1
        self.create(existing, source="update")
        return existing

    def delete(self, memory_id: str) -> bool:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
            conn.commit()
        emit_jsonl("hmem_audit.jsonl", {"event": "delete", "memory_id": memory_id})
        return cursor.rowcount > 0

    def _keyword_overlap(self, query: str, content: str) -> float:
        q_tokens = {token.lower() for token in query.replace("-", " ").split() if token}
        c_tokens = {token.lower() for token in content.replace("-", " ").split() if token}
        if not q_tokens:
            return 0.0
        if not c_tokens:
            return 0.0
        overlap = len(q_tokens & c_tokens) / len(q_tokens | c_tokens)
        return overlap

    def retrieve(self, query: str, *, topN: int = 5, tags: Optional[List[str]] = None, domain: str = "general") -> Dict[str, Any]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT * FROM memories WHERE domain = ? OR domain = 'general' ORDER BY timestamp DESC", (domain,)).fetchall()

        hits: List[Dict[str, Any]] = []
        for row in rows:
            record = self._row_to_record(row)
            keyword_score = self._keyword_overlap(query, record.content)
            tag_score = len(set(tags or []) & set(record.tags)) / max(1, len(set(tags or []) | set(record.tags)))
            layer_weight = {"short_term": 1.0, "long_term": 0.8, "derived": 0.7}.get(record.layer, 0.6)
            recency_hours = max(0.0, 1.0 - (datetime.now(timezone.utc) - datetime.fromisoformat(record.timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)).total_seconds() / 86400.0)
            superseded_penalty = 0.2 if record.supersedes else 0.0
            score = (keyword_score * 0.45) + (tag_score * 0.25) + (layer_weight * 0.2) + (recency_hours * 0.1) - superseded_penalty

            if score <= 0.0:
                continue
            hits.append({
                "record": self._record_to_payload(record),
                "score": round(max(0.0, min(1.0, score)), 4),
                "retrievalReason": "keyword+tag+recency+layer+superseded_penalty",
            })

        hits.sort(key=lambda item: item["score"], reverse=True)
        selected = hits[: max(1, min(topN, len(hits)))]
        for item in selected:
            item["record"]["accessCount"] = int(item["record"].get("accessCount", 0)) + 1
            item["record"]["lastAccessed"] = datetime.now(timezone.utc).isoformat()

        emit_jsonl(
            "hmem_retrieval_trace.jsonl",
            {
                "event": "retrieval",
                "query": query,
                "tags": tags or [],
                "domain": domain,
                "results": selected,
            },
        )

        return {
            "retrievalReason": "keyword plus tag overlap, layer weight, recency and superseded penalty",
            "results": selected,
            "strategy": "top_n_keyword_tag_overlap",
            "threshold": 0.35,
            "topN": topN,
        }

    def mine(self, *, event: str, payload: Dict[str, Any], agentId: str, runId: str, taskId: str) -> MemoryRecord:
        summary = payload.get("summary") or payload.get("message") or json.dumps(payload, default=str, sort_keys=True)
        tags = payload.get("tags") or []
        record = MemoryRecord(
            id=f"mem_{abs(hash(summary + agentId + runId + taskId)) % 1000000}",
            content=str(summary)[:1000],
            type=str(event),
            layer="short_term",
            timestamp=datetime.now(timezone.utc).isoformat(),
            lastAccessed=datetime.now(timezone.utc).isoformat(),
            accessCount=1,
            tags=list(tags),
            confidence=float(payload.get("confidence", 0.6)),
            source=str(payload.get("source", event)),
            domain=str(payload.get("domain", "general")),
            entities=list(payload.get("entities") or []),
            supersedes=payload.get("supersedes"),
            derivedFrom=list(payload.get("derivedFrom") or []),
            agentId=str(agentId),
            runId=str(runId),
            taskId=str(taskId),
        )
        return self.create(record, source=f"mine:{event}")


hmem_store = HMemStore()
