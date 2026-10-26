from __future__ import annotations

from typing import Annotated, TypedDict

from langchain_core.prompts import PromptTemplate
from langgraph.graph import END, START, StateGraph

from app.mock_sources import build_visual_payload, get_provider_inventory, get_provider_snapshot, run_det_model
from app.schemas import RunRequest


class GraphState(TypedDict):
    prompt: str
    region: str
    priority: str
    sources: list[str]
    provider_data: list[dict]
    ranked_scores: list[dict]
    recommendation: dict
    summary: str


def _load_provider_data(state: GraphState) -> GraphState:
    selected = state.get("sources") or ["zetaris", "meterless", "brightdata"]
    provider_data = [get_provider_snapshot(source) for source in selected]
    return {**state, "provider_data": provider_data}


def _score_providers(state: GraphState) -> GraphState:
    request = RunRequest(
        prompt=state["prompt"],
        region=state["region"],
        priority=state["priority"],
        sources=state["sources"],
    )
    response = run_det_model(request)
    ranked = [
        {
            "provider": item.provider,
            "category": item.category,
            "total_score": item.total_score,
            "recommendation": item.recommendation,
            "rationale": item.rationale,
            "weighted_breakdown": item.weighted_breakdown,
        }
        for item in response.provider_scores
    ]
    return {**state, "ranked_scores": ranked, "recommendation": ranked[0]}


def _make_summary(state: GraphState) -> GraphState:
    prompt = PromptTemplate(
        input_variables=["prompt", "winner", "region", "priority", "ranked"],
        template=(
            "Task: {prompt}\n"
            "Region: {region}\n"
            "Priority: {priority}\n"
            "Preferred provider: {winner}\n"
            "Ranking: {ranked}\n"
            "Summary: {winner} is the most suitable mock provider for this situation because it balances latency, reliability, coverage, cost, sustainability, and data quality."
        ),
    )
    ranked_text = ", ".join(f"{item['provider']}={item['total_score']}" for item in state["ranked_scores"])
    summary = prompt.format(
        prompt=state["prompt"],
        winner=state["recommendation"]["provider"],
        region=state["region"],
        priority=state["priority"],
        ranked=ranked_text,
    )
    return {**state, "summary": summary}


def build_graph():
    builder = StateGraph(GraphState)
    builder.add_node("load_provider_data", _load_provider_data)
    builder.add_node("score_providers", _score_providers)
    builder.add_node("make_summary", _make_summary)
    builder.add_edge(START, "load_provider_data")
    builder.add_edge("load_provider_data", "score_providers")
    builder.add_edge("score_providers", "make_summary")
    builder.add_edge("make_summary", END)
    return builder.compile()


workflow = build_graph()


def run_langgraph(request: RunRequest) -> dict:
    state = {
        "prompt": request.prompt,
        "region": request.region,
        "priority": request.priority,
        "sources": request.sources,
        "provider_data": [],
        "ranked_scores": [],
        "recommendation": {},
        "summary": "",
    }
    result = workflow.invoke(state)
    return {
        "provider_data": result["provider_data"],
        "ranked_scores": result["ranked_scores"],
        "recommendation": result["recommendation"],
        "summary": result["summary"],
        "visual": build_visual_payload([
            type("Score", (), {"provider": item["provider"], "total_score": item["total_score"]})()
            for item in result["ranked_scores"]
        ]),
    }
