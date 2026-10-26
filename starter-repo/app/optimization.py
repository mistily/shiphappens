from __future__ import annotations

import math
from typing import Any, Dict, List

from app.schemas import EvidenceRecord, OptimizationResult


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def deterministic_feasibility(evidence: List[EvidenceRecord], load_profile: Dict[str, Any]) -> OptimizationResult:
    if not evidence:
        return OptimizationResult(
            feasible=False,
            feasibility_score=0.0,
            energy_kwh=0.0,
            co2_kg=0.0,
            recommendation="Infeasible: no evidence was collected.",
            notes=["No evidence fragments were available for planning."],
        )

    source_factor = min(1.0, len(evidence) / 5.0)
    quality_factor = sum(
        float(item.payload.get("quality_score", 0.5))
        for item in evidence
    ) / max(len(evidence), 1)

    load = float(load_profile.get("estimated_load", 10.0))
    workload = float(load_profile.get("workload_hours", 8.0))
    energy_kwh = round(max(0.0, load * workload * 0.15), 4)
    co2_kg = round(max(0.0, energy_kwh * 0.42), 4)

    feasibility_score = _clamp((source_factor * 0.45) + (quality_factor * 0.55))

    feasible = feasibility_score >= 0.5
    recommendation = (
        "Feasible: deterministic scoring indicates the plan can be executed with the available evidence."
        if feasible
        else "Not feasible: evidence coverage or quality is too weak to support a reliable plan."
    )

    notes = [
        f"Evidence fragments: {len(evidence)}",
        f"Quality factor: {quality_factor:.2f}",
        f"Energy estimate: {energy_kwh} kWh",
        f"CO2 estimate: {co2_kg} kg",
    ]

    return OptimizationResult(
        feasible=feasible,
        feasibility_score=round(feasibility_score, 4),
        energy_kwh=energy_kwh,
        co2_kg=co2_kg,
        recommendation=recommendation,
        notes=notes,
    )


def calculate_energy_kwh(load: float, hours: float) -> float:
    return round(max(0.0, load * hours * 0.15), 4)


def calculate_co2_kg(energy_kwh: float) -> float:
    return round(max(0.0, energy_kwh * 0.42), 4)
