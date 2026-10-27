from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.generator import generator
from app.logger import emit_jsonl


@dataclass
class MarkovianConfig:
    chunkSize: int = 8000
    maxChunks: int = 12
    carryoverTokens: int = 256
    mode: str = "ARCHITECT"
    lowerMaxChunksForDev: int = 4


class MarkovianChain:
    def __init__(self, config: Optional[MarkovianConfig] = None):
        self.config = config or MarkovianConfig()

    @staticmethod
    def approx_tokens(text: str) -> int:
        return max(1, (len(text) + 3) // 4)

    @staticmethod
    def _clean_markers(text: str) -> str:
        return text.replace("[STATE_CHECKPOINT]", "").replace("[TASK_COMPLETE]", "")

    @staticmethod
    def _chunk_text(text: str, chunk_size: int) -> List[str]:
        if not text:
            return [""]
        return [text[i : i + chunk_size] for i in range(0, len(text), chunk_size)]

    @staticmethod
    def _build_prompt(prompt: str, chunk: str, mode: str, memoryContext: Optional[str] = None) -> str:
        intro = "ARCHITECT mode: produce a concrete structured answer with precedence for constraints and evidence." if mode == "ARCHITECT" else "RESEARCH mode: compile evidence and identify missing facts."
        context_block = ""
        if memoryContext:
            context_block = f"\n[memoryContext]\n{memoryContext}\n[/memoryContext]\n"
        return f"{intro}\n{context_block}\nTask:\n{prompt}\n\nChunk:\n{chunk}\n"

    def run(
        self,
        *,
        prompt: str,
        memoryContext: Optional[str] = None,
        mode: str = "ARCHITECT",
        maxChunks: Optional[int] = None,
        signal: Optional[Any] = None,
        generator_fn: Optional[Any] = None,
    ) -> Dict[str, Any]:
        generator_fn = generator_fn or generator
        chunk_limit = maxChunks or self.config.maxChunks
        if os.getenv("DEV_MODE") == "1":
            chunk_limit = min(chunk_limit, self.config.lowerMaxChunksForDev)

        chunks = self._chunk_text(prompt, self.config.chunkSize)
        chunks = chunks[: min(len(chunks), chunk_limit)]

        output_parts: List[str] = []
        preserved_partial: List[str] = []
        projected = {
            "chunkCount": len(chunks),
            "carryoverTokens": self.config.carryoverTokens,
            "projectedTotalTokens": len(chunks) * self.config.carryoverTokens,
        }

        for index, chunk in enumerate(chunks):
            if signal is not None and getattr(signal, "aborted", False):
                preserved_partial.append("[ABORTED: partial output preserved]")
                break

            carryover = ""
            if index > 0:
                carryover = "\n".join(output_parts[-3:])[-self.config.carryoverTokens :]
            final_prompt = self._build_prompt(prompt, chunk, mode, memoryContext if index == 0 else None)
            if carryover:
                final_prompt += f"\n[carryover]\n{carryover}\n[/carryover]\n"

            try:
                result = generator_fn(final_prompt, [], "You are operating in Markovian chain mode.", None, signal)
                text = result.get("text", "")
            except Exception as exc:
                text = f"[PARTIAL_OUTPUT_ERROR: {exc}]"

            text = self._clean_markers(text)
            output_parts.append(text)
            preserved_partial.append(text)

            if "[STATE_CHECKPOINT]" in text:
                emit_jsonl("markovian_runs.jsonl", {"event": "checkpoint", "chunk_index": index, "text": text})
            if "[TASK_COMPLETE]" in text:
                break

        final_text = "\n".join(preserved_partial)
        run_record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "engine": "markovian",
            "event": "run",
            "mode": mode,
            "chunkCount": len(chunks),
            "projected": projected,
            "actualTokens": self.approx_tokens(final_text),
            "status": "ok" if not signal or not getattr(signal, "aborted", False) else "aborted",
            "summary": final_text[:500],
        }
        emit_jsonl("markovian_runs.jsonl", run_record)

        return {
            "text": final_text,
            "chunks": len(chunks),
            "projected": projected,
            "actualTokens": self.approx_tokens(final_text),
            "status": run_record["status"],
        }


markovian = MarkovianChain()
