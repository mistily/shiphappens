from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class BrightDataAdapter:
    def __init__(self, fixture_mode: bool = True):
        self.fixture_mode = fixture_mode

    def retrieve(self, query: str, context: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        context = context or {}
        now = datetime.now(timezone.utc).isoformat()
        if self.fixture_mode:
            return [
                {
                    "url": "https://mock.example.com/evidence/brightdata/one",
                    "timestamp": now,
                    "title": "External evidence reference",
                    "snippet": "A synthetic external source confirming the task objective and expected constraints.",
                    "quality_score": 0.84,
                    "region": context.get("region", "emea"),
                },
                {
                    "url": "https://mock.example.com/evidence/brightdata/two",
                    "timestamp": now,
                    "title": "Fallback evidence reference",
                    "snippet": "A secondary reference note for cross-checks and conflict detection.",
                    "quality_score": 0.8,
                    "region": context.get("region", "emea"),
                },
            ]

        return [{
            "url": "",
            "timestamp": now,
            "title": "No live evidence",
            "snippet": "Live BrightData retrieval is disabled in fixture mode.",
            "quality_score": 0.0,
            "region": context.get("region", "emea"),
        }]
