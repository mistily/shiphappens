from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from app.generator import generator
from app.logger import emit_jsonl, get_manifest


async def agent_step(task: Dict[str, Any], *, runId: str, agentId: str, signal: Optional[Any] = None) -> Dict[str, Any]:
    from app.hmem import hmem_store
    from app.markovian import markovian
    from app.world_model import world_model

    brief = task.get("brief") or task.get("prompt") or ""
    mem = hmem_store.retrieve(brief, topN=5, tags=task.get("tags") or [])
    world = world_model.build_context(task.get("intent") or brief, budget=1500)
    injected = {
        "memoryContext": json.dumps(mem, sort_keys=True),
        "worldModelContext": json.dumps(world, sort_keys=True),
    }

    if task.get("isLong"):
        out = markovian.run(
            prompt=brief,
            memoryContext=json.dumps(injected, sort_keys=True),
            mode="ARCHITECT",
            maxChunks=8,
            signal=signal,
            generator_fn=generator,
        )
    else:
        out = generator(withContext(brief, injected), [], task.get("system") or "You are a planner.", None, signal)

    result = {"status": "completed", "output": out.get("text", ""), "agentId": agentId, "runId": runId}

    world_model.ingest(result, agentId=agentId, runId=runId, taskId=str(task.get("id") or "task_1"))
    hmem_store.mine(
        event="tool_result",
        payload={
            "summary": result["output"],
            "source": "agent_step",
            "tags": ["agent_step", "tool_result"],
            "entities": [agentId],
            "confidence": 0.7,
        },
        agentId=agentId,
        runId=runId,
        taskId=str(task.get("id") or "task_1"),
    )
    emit_jsonl("agent_step_done.jsonl", {"event": "agent_step_done", "runId": runId, "agentId": agentId, "taskId": task.get("id")})
    return result


def withContext(prompt: str, injected: Dict[str, Any]) -> str:
    return (
        f"{prompt}\n\n"
        f"[memoryContext]\n{injected.get('memoryContext', '')}\n[/memoryContext]\n"
        f"[worldModelContext]\n{injected.get('worldModelContext', '')}\n[/worldModelContext]\n"
    )
