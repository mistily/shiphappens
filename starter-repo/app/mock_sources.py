from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "mock_provider_catalog.json"


def _load_catalog() -> Dict[str, Any]:
    if not CATALOG_PATH.exists():
        return {
            "zetaris": {
                "category": "Data lake",
                "status": "mock",
                "notes": "Best for structured enterprise datasets.",
                "metrics": {"latency_ms": 180, "reliability": 0.96, "coverage": 0.88, "cost_efficiency": 0.82, "sustainability": 0.84, "data_quality": 0.9, "freshness_hours": 9},
            },
            "meterless": {
                "category": "Inference routing",
                "status": "mock",
                "notes": "Fastest response profile with low-latency inference.",
                "metrics": {"latency_ms": 120, "reliability": 0.9, "coverage": 0.78, "cost_efficiency": 0.74, "sustainability": 0.93, "data_quality": 0.82, "freshness_hours": 6},
            },
            "brightdata": {
                "category": "Web intelligence",
                "status": "mock",
                "notes": "Strong discovery and source breadth for web intelligence tasks.",
                "metrics": {"latency_ms": 210, "reliability": 0.91, "coverage": 0.94, "cost_efficiency": 0.79, "sustainability": 0.76, "data_quality": 0.88, "freshness_hours": 12},
            },
        }
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def get_provider_inventory() -> List[Dict[str, Any]]:
    catalog = _load_catalog()
    items: List[Dict[str, Any]] = []
    for name, meta in catalog.items():
        items.append({
            "name": name,
            "category": meta.get("category", "unknown"),
            "status": meta.get("status", "mock"),
            "notes": meta.get("notes", "mock data only"),
        })
    return items


def get_provider_snapshot(provider_name: str) -> Dict[str, Any]:
    catalog = _load_catalog()
    provider = catalog.get(provider_name.lower())
    if not provider:
        raise KeyError(f"Provider not found: {provider_name}")
    metrics = provider.get("metrics", {})
    return {
        "provider": provider_name.lower(),
        "category": provider.get("category", "unknown"),
        "status": provider.get("status", "mock"),
        "notes": provider.get("notes", "mock data only"),
        "latency_ms": int(metrics.get("latency_ms", 0)),
        "reliability": float(metrics.get("reliability", 0.0)),
        "coverage": float(metrics.get("coverage", 0.0)),
        "cost_efficiency": float(metrics.get("cost_efficiency", 0.0)),
        "sustainability": float(metrics.get("sustainability", 0.0)),
        "data_quality": float(metrics.get("data_quality", 0.0)),
        "freshness_hours": int(metrics.get("freshness_hours", 0)),
    }
