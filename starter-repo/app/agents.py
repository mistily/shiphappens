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
                description="Breaks the user request into a concrete execution plan.",
                prompts=["Identify goals, constraints, and required steps."],
            ),
            "researcher": AgentDefinition(
                name="researcher",
                description="Gathers context and relevant facts from the available data sources.",
                prompts=["Gather the most relevant facts and cite assumptions."],
            ),
            "executor": AgentDefinition(
                name="executor",
                description="Executes the selected actions and formulates a final result.",
                prompts=["Produce a concise, actionable response."],
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
