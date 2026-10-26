from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class EvidenceRecord(BaseModel):
    source: str
    source_type: str
    url: Optional[str] = None
    timestamp: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class TaskStep(BaseModel):
    step_number: int
    action: str
    owner: str
    dependencies: List[str] = Field(default_factory=list)
    output: str
    risk: Optional[str] = None


class PlannerInput(BaseModel):
    task: str = Field(..., min_length=4)
    context: Dict[str, Any] = Field(default_factory=dict)
    evidence: List[EvidenceRecord] = Field(default_factory=list)


class PlannerOutput(BaseModel):
    objective: str
    constraints: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    evidence_sources: List[str] = Field(default_factory=list)
    execution_plan: List[TaskStep] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    provider_recommendation: str
    final_answer_summary: str
    confidence: float = 0.0


class ProviderSnapshot(BaseModel):
    provider: str
    category: str
    status: str
    notes: str
    latency_ms: int
    reliability: float
    coverage: float
    cost_efficiency: float
    sustainability: float
    data_quality: float
    freshness_hours: int


class OptimizationResult(BaseModel):
    feasible: bool
    feasibility_score: float
    energy_kwh: float
    co2_kg: float
    recommendation: str
    notes: List[str] = Field(default_factory=list)


class WorkflowState(BaseModel):
    task: str
    context: Dict[str, Any] = Field(default_factory=dict)
    evidence: List[EvidenceRecord] = Field(default_factory=list)
    status: str = "ready"
    retry_count: int = 0
    warnings: List[str] = Field(default_factory=list)
    provider_snapshot: Optional[ProviderSnapshot] = None
    plan: Optional[PlannerOutput] = None
    optimization: Optional[OptimizationResult] = None
