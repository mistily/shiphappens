from __future__ import annotations

from typing import Any, Dict, List


def run_fixture_query(task: str, filters: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    filters = filters or {}
    return [
        {
            "source": "zetaris",
            "mode": "fixture",
            "task": task,
            "region": filters.get("region", "emea"),
            "metric": "coverage",
            "value": 0.9,
        },
        {
            "source": "zetaris",
            "mode": "fixture",
            "task": task,
            "region": filters.get("region", "emea"),
            "metric": "quality",
            "value": 0.92,
        },
    ]
