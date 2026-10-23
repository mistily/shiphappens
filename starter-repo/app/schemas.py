from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TaskInput(BaseModel):
    prompt: str = Field(..., min_length=1)
    category: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TaskOutput(BaseModel):
    status: str = "accepted"
    summary: str
    steps: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PromptEnvelope(BaseModel):
    message: str
    source: str = "api"


class AgentTrace(BaseModel):
    agent: str
    result: str


class WorkflowResult(BaseModel):
    request_id: str
    outputs: List[AgentTrace] = Field(default_factory=list)
    final_status: str = "ok"
