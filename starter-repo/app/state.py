from __future__ import annotations

from typing import Any, Dict, List, Literal, TypedDict


class EvidenceRecordDict(TypedDict):
    source: str
    source_type: str
    url: str | None
    timestamp: str | None
    payload: Dict[str, Any]


class PlannerStepState(TypedDict):
    step_number: int
    action: str
    owner: str
    dependencies: List[str]
    output: str
    risk: str | None


class GraphState(TypedDict):
    task: str
    context: Dict[str, Any]
    evidence: List[EvidenceRecordDict]
    retry_count: int
    status: str
    warnings: List[str]
    provider_snapshot: Dict[str, Any]
    plan: Dict[str, Any]
    optimization: Dict[str, Any]
    final_response: Dict[str, Any]


class AgentOutput(TypedDict):
    name: str
    status: str
    message: str
    metadata: Dict[str, Any]


class ToolResult(TypedDict):
    provider: str
    mode: Literal["fixture", "live"]
    query: str
    rows: List[Dict[str, Any]]
    warnings: List[str]
