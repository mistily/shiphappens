from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class AgentDefinition:
    name: str
    description: str
    prompts: List[str] = field(default_factory=list)


class AgentRegistry:
    def __init__(self) -> None:
        self._agents: Dict[str, AgentDefinition] = {
            "planner": AgentDefinition(
                name="planner",
                description="Breaks the user request into a concrete execution plan based on evidence and constraints.",
                prompts=[
                    "Normalize fragmented evidence into a single dataset.",
                    "Extract objective, constraints, assumptions, and risks.",
                    "Return a strict structured plan with execution steps and final recommendation.",
                ],
            ),
            "researcher": AgentDefinition(
                name="researcher",
                description="Collects and normalizes external evidence and source metadata.",
                prompts=["Collect evidence, preserve source URLs and timestamps, and identify conflicts."],
            ),
            "optimizer": AgentDefinition(
                name="optimizer",
                description="Runs deterministic feasibility, energy, and CO2 calculations to rank candidate options.",
                prompts=["Apply deterministic scoring and explain trade-offs using numeric evidence."],
            ),
            "evaluator": AgentDefinition(
                name="evaluator",
                description="Validates the plan against constraints, feasibility thresholds, and confidence requirements.",
                prompts=["Reject low-quality plans, note gaps, and require revisions when evidence is weak."],
            ),
        }

    def list_agents(self) -> List[Dict[str, Any]]:
        return [
            {"name": agent.name, "description": agent.description, "prompts": agent.prompts}
            for agent in self._agents.values()
        ]

    def get_agent(self, agent_name: str) -> AgentDefinition:
        if agent_name not in self._agents:
            raise KeyError(f"Unknown agent: {agent_name}")
        return self._agents[agent_name]


agents = AgentRegistry()
