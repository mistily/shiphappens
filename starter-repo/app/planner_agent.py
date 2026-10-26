# name=starter-repo/app/planner_agent.py
from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_openai import ChatOpenAI

# -----------------------------
# 1) Structured output schema
# -----------------------------
class TaskStep(BaseModel):
    step_number: int
    action: str
    owner: str
    dependencies: List[str] = Field(default_factory=list)
    output: str
    risk: Optional[str] = None

class PlannerPlan(BaseModel):
    objective: str
    use_case: str
    constraints: List[str]
    assumptions: List[str]
    evidence_sources: List[str]
    execution_plan: List[TaskStep]
    success_criteria: List[str]
    risks: List[str]
    provider_recommendation: str
    final_answer_summary: str

# -----------------------------
# 2) Fragment parser
# -----------------------------
def load_fragments(data_dir: str) -> List[Dict[str, Any]]:
    fragments: List[Dict[str, Any]] = []
    root = Path(data_dir)

    for file_path in sorted(root.rglob("*")):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in {".json", ".csv", ".txt", ".md"}:
            continue

        try:
            raw = file_path.read_text(encoding="utf-8")
            if file_path.suffix.lower() == ".json":
                parsed = json.loads(raw)
                fragments.append({
                    "source": str(file_path),
                    "type": "json",
                    "content": parsed,
                })
            else:
                fragments.append({
                    "source": str(file_path),
                    "type": file_path.suffix.lower().lstrip("."),
                    "content": raw[:2000],
                })
        except Exception:
            fragments.append({
                "source": str(file_path),
                "type": "unparsed",
                "content": raw[:2000],
            })

    return fragments

# -----------------------------
# 3) Normalization layer
# -----------------------------
def normalize_fragments(fragments: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized = {
        "total_files": len(fragments),
        "sources": [],
        "summary": [],
    }

    for frag in fragments:
        normalized["sources"].append({
            "source": frag["source"],
            "type": frag["type"],
        })
        normalized["summary"].append(
            f"{frag['source']} ({frag['type']})"
        )

    return normalized

# -----------------------------
# 4) Planner agent
# -----------------------------
class PlannerAgent:
    def __init__(self, model_name: str = "gpt-4.1-mini"):
        self.model = ChatOpenAI(
            model=model_name,
            temperature=0.2,
            api_key=None,  # set via environment in real use
        )

    def build_prompt(self, task: str, context: Dict[str, Any]) -> str:
        return f"""
You are the Planner Agent for a fragmented intelligence system.

Your job is to:
1. Read all provided evidence fragments.
2. Extract facts, constraints, and dependencies.
3. Infer the likely objective and risks.
4. Produce a high-quality execution plan.
5. Return strict JSON matching the schema exactly.

Task:
{task}

Context:
{json.dumps(context, indent=2, ensure_ascii=False)}

Rules:
- Never invent missing provider credentials.
- Clearly separate facts from assumptions.
- Prefer deterministic reasoning over vague statements.
- Include execution steps, dependencies, risk, and success criteria.
- If a source is missing, mark it as assumption, not fact.
- Output must be valid JSON only.
"""

    def plan(self, task: str, context: Dict[str, Any]) -> PlannerPlan:
        parser = PydanticOutputParser(pydantic_object=PlannerPlan)

        prompt = ChatPromptTemplate.from_messages([
            ("system", """
You are an expert systems planner for agentic workflows.
Follow the instructions exactly.
Return valid structured JSON.
"""),
            ("user", self.build_prompt(task, context)),
        ])

        chain = prompt | self.model | parser
        return chain.invoke({})

# -----------------------------
# 5) Deterministic fallback
# -----------------------------
def build_fallback_plan(task: str, context: Dict[str, Any], fragments: List[Dict[str, Any]]) -> PlannerPlan:
    sources = [f["source"] for f in fragments]
    return PlannerPlan(
        objective="Create a decision-ready execution plan from fragmented evidence.",
        use_case=context.get("use_case", "general"),
        constraints=[
            "Must respect the task objective",
            "Must use evidence from available fragments",
            "Must identify assumptions and risks",
        ],
        assumptions=[
            "The task is evaluated in a mock or local environment",
            "Some source metadata may be incomplete",
        ],
        evidence_sources=sources,
        execution_plan=[
            TaskStep(
                step_number=1,
                action="Normalize incoming evidence fragments",
                owner="PlannerAgent",
                dependencies=[],
                output="Unified evidence summary",
                risk="Missing data may reduce confidence",
            ),
            TaskStep(
                step_number=2,
                action="Identify decision constraints and dependencies",
                owner="PlannerAgent",
                dependencies=["step_1"],
                output="Constraint and dependency list",
                risk="Conflicting source signals",
            ),
            TaskStep(
                step_number=3,
                action="Draft execution strategy and recommendations",
                owner="PlannerAgent",
                dependencies=["step_2"],
                output="Actionable implementation plan",
                risk="Assumption-heavy decisions",
            ),
        ],
        success_criteria=[
            "Structured plan is generated",
            "Evidence sources are cited",
            "Risks and assumptions are explicit",
        ],
        risks=[
            "Fragment coverage may be incomplete",
            "Some data may conflict",
        ],
        provider_recommendation="Use a deterministic mock ranking or vendor scoring layer until live provider data is available.",
        final_answer_summary="The planner created a structured, evidence-grounded execution plan based on normalized fragmented inputs.",
    )
