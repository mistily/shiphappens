from __future__ import annotations

from typing import Any, Dict, List, Optional

from langgraph.graph import END, START, StateGraph

from app.schemas import EvidenceRecord, PlannerInput, PlannerOutput
from app.state import GraphState
from app.optimization import deterministic_feasibility
from tools.brightdata import BrightDataAdapter
from tools.zetaris import ZetarisQueryAdapter


def load_evidence(state: GraphState) -> GraphState:
    task = state["task"]
    context = state.get("context", {})

    zetaris = ZetarisQueryAdapter(fixture_mode=True)
    brightdata = BrightDataAdapter(fixture_mode=True)

    rows = zetaris.query(task=task, filters=context)
    external = brightdata.retrieve(query=task, context=context)

    evidence = [
        EvidenceRecord(
            source="zetaris",
            source_type="fixture",
            url="https://mock.example.com/zetaris/query",
            timestamp="2026-10-26T00:00:00Z",
            payload={"quality_score": 0.9, "rows": rows},
        ),
        EvidenceRecord(
            source="brightdata",
            source_type="fixture",
            url=external[0]["url"] if external else "https://mock.example.com/brightdata",
            timestamp=external[0]["timestamp"] if external else "2026-10-26T00:00:00Z",
            payload={"quality_score": 0.8, "rows": external},
        ),
    ]

    return {**state, "evidence": [item.model_dump() for item in evidence], "status": "evidence_loaded"}


def normalize_evidence(state: GraphState) -> GraphState:
    evidence = state.get("evidence", [])
    normalized = []
    for item in evidence:
        normalized.append({
            "source": item["source"],
            "source_type": item["source_type"],
            "url": item.get("url"),
            "timestamp": item.get("timestamp"),
            "payload": item.get("payload", {}),
        })
    return {**state, "evidence": normalized, "status": "normalized"}


def score_feasibility(state: GraphState) -> GraphState:
    evidence = [EvidenceRecord(**item) for item in state.get("evidence", [])]
    optimization = deterministic_feasibility(
        evidence,
        load_profile={"estimated_load": state.get("context", {}).get("estimated_load", 10), "workload_hours": 8},
    )
    return {**state, "optimization": optimization.model_dump(), "status": "scored"}


def finalize_plan(state: GraphState) -> GraphState:
    if state.get("optimization", {}).get("feasible") is False:
        status = "rejected"
        warnings = ["Plan rejected by deterministic feasibility gate."]
    else:
        status = "finalized"
        warnings = []

    final_response = {
        "objective": "Convert fragmented evidence into a usable execution plan.",
        "constraints": ["Use the available evidence only", "Preserve provenance", "Return structured output"],
        "assumptions": ["Fixture-mode providers are used for demonstration and reproducibility."],
        "evidence_sources": [item["source"] for item in state.get("evidence", [])],
        "execution_plan": [
            {
                "step_number": 1,
                "action": "Normalize and de-duplicate evidence.",
                "owner": "PlannerAgent",
                "dependencies": [],
                "output": "Unified evidence summary",
                "risk": "None",
            },
            {
                "step_number": 2,
                "action": "Score feasibility and risk.",
                "owner": "Optimizer",
                "dependencies": ["step_1"],
                "output": "Ranked decision-ready plan",
                "risk": "Low-quality evidence may lower confidence",
            },
        ],
        "success_criteria": ["Plan is deterministic", "Evidence is traceable", "Output is structured"],
        "risks": ["Mock environment only"],
        "provider_recommendation": "Use the best-scoring provider with a deterministic fallback strategy.",
        "final_answer_summary": "Evidence was normalized, scored, and converted into a structured execution plan.",
        "confidence": state.get("optimization", {}).get("feasibility_score", 0.0),
    }

    return {
        **state,
        "plan": final_response,
        "final_response": final_response,
        "status": status,
        "warnings": warnings,
    }


def route_after_load(state: GraphState) -> str:
    if state.get("retry_count", 0) >= 3:
        return "finalize"
    return "normalize"


def build_graph():
    builder = StateGraph(GraphState)
    builder.add_node("load", load_evidence)
    builder.add_node("normalize", normalize_evidence)
    builder.add_node("score", score_feasibility)
    builder.add_node("finalize", finalize_plan)

    builder.add_edge(START, "load")
    builder.add_conditional_edges(
        "load",
        route_after_load,
        {
            "normalize": "normalize",
            "finalize": "finalize",
        },
    )
    builder.add_edge("normalize", "score")
    builder.add_edge("score", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile()


graph = build_graph()


def run_workflow(task: str, context: Dict[str, Any]) -> Dict[str, Any]:
    initial_state: GraphState = {
        "task": task,
        "context": context,
        "evidence": [],
        "retry_count": 0,
        "status": "ready",
        "warnings": [],
        "provider_snapshot": {},
        "plan": {},
        "optimization": {},
        "final_response": {},
    }
    result = graph.invoke(initial_state)
    return result["final_response"]
