from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents import agents
from app.graph import run_workflow
from app.schemas import PlannerInput, PlannerOutput

app = FastAPI(title="Ship Happens Planner API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "shiphappens-planner"}


@app.get("/agents")
async def list_agents() -> dict:
    return {"agents": agents.list_agents()}


@app.post("/planner/run", response_model=PlannerOutput)
async def planner_run(payload: PlannerInput) -> PlannerOutput:
    result = run_workflow(payload.task, payload.context)
    plan = PlannerOutput(**result)
    return plan


@app.post("/run", response_model=PlannerOutput)
async def run(payload: PlannerInput) -> PlannerOutput:
    return await planner_run(payload)


@app.get("/demo")
async def demo() -> dict:
    return {
        "message": "Planner and optimization pipeline is running in fixture mode.",
        "mode": "fixture",
        "features": ["evidence ingestion", "LangGraph flow", "deterministic optimization"],
    }
