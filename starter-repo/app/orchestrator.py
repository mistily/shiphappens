from __future__ import annotations

from typing import Any, Dict, List

from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.agents import agents
from app.compass_client import compass_client
from app.logger import emit_trace


class InputPayload(BaseModel):
    prompt: str = Field(..., description="Natural-language prompt for the agent system.")
    context: Dict[str, Any] = Field(default_factory=dict)
    agents: List[str] = Field(default_factory=lambda: ["planner", "researcher", "executor"])


class AgentResult(BaseModel):
    agent: str
    status: str
    summary: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RunResult(BaseModel):
    request_id: str
    status: str
    summary: str
    agents: List[AgentResult]
    metadata: Dict[str, Any] = Field(default_factory=dict)


def create_app() -> FastAPI:
    app = FastAPI(title="Ship Happens API", version="0.1.0")

    @app.get("/health")
    async def health() -> Dict[str, str]:
        emit_trace("healthcheck", {"status": "ok"})
        return {"status": "ok"}

    @app.get("/agents")
    async def list_agents() -> Dict[str, Any]:
        return {"agents": agents.list_agents()}

    @app.post("/run", response_model=RunResult)
    async def run_orchestration(payload: InputPayload) -> RunResult:
        emit_trace("run_orchestration", {"prompt": payload.prompt, "agents": payload.agents})
        agent_results: List[AgentResult] = []

        for agent_name in payload.agents:
            try:
                agent_def = agents.get_agent(agent_name)
            except KeyError:
                agent_results.append(
                    AgentResult(
                        agent=agent_name,
                        status="skipped",
                        summary=f"Unknown agent '{agent_name}' requested.",
                        metadata={"error": "invalid_agent"},
                    )
                )
                continue

            agent_results.append(
                AgentResult(
                    agent=agent_def.name,
                    status="completed",
                    summary=f"{agent_def.description} processed the request.",
                    metadata={"prompts": agent_def.prompts, "context_keys": sorted(payload.context.keys())},
                )
            )

        compass_status = await compass_client.ping()
        return RunResult(
            request_id="req-demo",
            status="success",
            summary="Orchestration request completed successfully.",
            agents=agent_results,
            metadata={
                "context": payload.context,
                "compass": compass_status,
            },
        )

    @app.post("/demo")
    async def demo() -> Dict[str, Any]:
        return {
            "message": "FastAPI starter is running.",
            "environment": "local",
            "features": ["healthcheck", "agent registry", "orchestration stub"],
        }

    return app
