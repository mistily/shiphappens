from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class ProviderSignal(BaseModel):
    provider: str
    category: str
    latency_ms: int
    reliability: float
    coverage: float
    cost_efficiency: float
    sustainability: float
    data_quality: float
    freshness_hours: int


class ProviderScore(BaseModel):
    provider: str
    category: str
    total_score: float
    weighted_breakdown: Dict[str, float]
    recommendation: str
    rationale: str


class RunRequest(BaseModel):
    prompt: str = Field(..., min_length=4)
    region: str = Field(default="emea")
    priority: str = Field(default="balanced")
    sources: List[str] = Field(default_factory=lambda: ["zetaris", "meterless", "brightdata"]) 


class RunResponse(BaseModel):
    request_id: str
    provider_scores: List[ProviderScore]
    winner: ProviderScore
    summary: str
    visual_payload: Dict[str, Any]
    source_status: Dict[str, Any]


class ProviderInventoryItem(BaseModel):
    name: str
    category: str
    status: str
    notes: str
