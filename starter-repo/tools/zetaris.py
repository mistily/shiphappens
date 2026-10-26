from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class ZetarisQueryResult:
    rows: List[Dict[str, Any]]
    query: str
    fixture_mode: bool = True
    generated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ZetarisQueryAdapter:
    def __init__(self, fixture_mode: bool = True):
        self.fixture_mode = fixture_mode

    def query(self, task: str, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        filters = filters or {}
        if self.fixture_mode:
            return [
                {
                    "provider": "zetaris",
                    "source": "fixture",
                    "task": task,
                    "filter_region": filters.get("region", "emea"),
                    "quality_score": 0.92,
                    "notes": "Structured enterprise evidence fixture.",
                },
                {
                    "provider": "zetaris",
                    "source": "fixture",
                    "task": task,
                    "filter_region": filters.get("region", "emea"),
                    "quality_score": 0.88,
                    "notes": "Comparable fallback dataset for validation.",
                },
            ]

        return [{
            "provider": "zetaris",
            "source": "live",
            "task": task,
            "quality_score": 0.0,
            "notes": "Live query not available in this environment.",
        }]
