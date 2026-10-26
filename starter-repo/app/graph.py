from __future__ import annotations

import json
from typing import Any, Dict, List

from langchain_core.prompts import PromptTemplate

from app.mock_sources import get_provider_inventory, get_provider_snapshot
from app.schemas import ProviderScore, ProviderSignal, RunRequest, RunResponse


def _normalize(value: float, low: float, high: float) -> float:
    if high == low:
        return 0.5
    return max(0.0, min(1.0, (value - low) / (high - low)))


def score_provider(provider_name: str, request: RunRequest) -> ProviderScore:
    snapshot = get_provider_snapshot(provider_name)

    latency_score = _normalize(1000 / max(snapshot["latency_ms"], 1), 0.0, 6.0)
    reliability_score = float(snapshot["reliability"])
    coverage_score = float(snapshot["coverage"])
    cost_score = float(snapshot["cost_efficiency"])
    sustainability_score = float(snapshot["sustainability"])
    quality_score = float(snapshot["data_quality"])

    if request.priority == "cost_sensitive":
        weight_map = {
            "latency": 0.10,
            "reliability": 0.20,
            "coverage": 0.15,
            "cost": 0.35,
            "sustainability": 0.10,
            "quality": 0.10,
        }
    elif request.priority == "low_latency":
        weight_map = {
            "latency": 0.25,
            "reliability": 0.20,
            "coverage": 0.15,
            "cost": 0.15,
            "sustainability": 0.10,
            "quality": 0.15,
        }
    else:
        weight_map = {
            "latency": 0.15,
            "reliability": 0.20,
            "coverage": 0.15,
            "cost": 0.20,
            "sustainability": 0.15,
            "quality": 0.15,
        }

    overall = (
        latency_score * weight_map["latency"]
        + reliability_score * weight_map["reliability"]
        + coverage_score * weight_map["coverage"]
        + cost_score * weight_map["cost"]
        + sustainability_score * weight_map["sustainability"]
        + quality_score * weight_map["quality"]
    )

    overall = round(overall, 4)
    if overall >= 0.82:
        recommendation = "strong choice"
    elif overall >= 0.7:
        recommendation = "viable option"
    else:
        recommendation = "watchlist"

    prompt = PromptTemplate(
        input_variables=["provider", "region", "priority", "overall"],
        template=(
            "For {region} operations with {priority} priority, {provider} scored {overall:.3f}. "
            "This deterministic recommendation is based on latency, reliability, coverage, cost, sustainability, and quality."
        ),
    )
    rationale = prompt.format(
        provider=provider_name.title(),
        region=request.region,
        priority=request.priority,
        overall=overall,
    )

    return ProviderScore(
        provider=provider_name,
        category=snapshot["category"],
        total_score=overall,
        weighted_breakdown={
            "latency": round(latency_score, 4),
            "reliability": round(reliability_score, 4),
            "coverage": round(coverage_score, 4),
            "cost_efficiency": round(cost_score, 4),
            "sustainability": round(sustainability_score, 4),
            "data_quality": round(quality_score, 4),
        },
        recommendation=recommendation,
        rationale=rationale,
    )


def build_visual_payload(scores: List[ProviderScore]) -> Dict[str, Any]:
    return {
        "labels": [item.provider for item in scores],
        "series": [round(item.total_score, 4) for item in scores],
        "chart_type": "bar",
        "title": "Mock provider score ranking",
    }


def run_det_model(request: RunRequest) -> RunResponse:
    provider_scores = [score_provider(name, request) for name in request.sources]
    provider_scores.sort(key=lambda item: item.total_score, reverse=True)
    winner = provider_scores[0]

    summary_prompt = PromptTemplate(
        input_variables=["winner", "prompt", "scores"],
        template=(
            "Request: {prompt}\nWinner: {winner}\nRanked providers: {scores}\n"
            "Summary: Use the winner as the preferred provider for the current operating context, "
            "with the remaining providers held as fallback or comparison options."
        ),
    )
    summary = summary_prompt.format(
        winner=winner.provider,
        prompt=request.prompt,
        scores=", ".join(f"{item.provider}:{item.total_score}" for item in provider_scores),
    )

    return RunResponse(
        request_id=f"mock-{abs(hash(request.prompt + ''.join(request.sources))) % 10000}",
        provider_scores=provider_scores,
        winner=winner,
        summary=summary,
        visual_payload=build_visual_payload(provider_scores),
        source_status={
            provider: {"status": "mock", "provider": provider}
            for provider in request.sources
        },
    )
