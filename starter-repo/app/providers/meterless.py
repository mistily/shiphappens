from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.providers.meterless import NightshiftConfig, NightshiftClient


@dataclass
class ProviderModelConfig:
    provider: str
    model: str
    api_base: str
    fixture_mode: bool = True
    timeout_seconds: int = 30
    parameters: Dict[str, Any] = field(default_factory=dict)


@dataclass
class NightshiftResult:
    provider: str
    model: str
    mode: str
    prompt: str
    output: str
    metadata: Dict[str, Any] = field(default_factory=dict)


class NightshiftModel:
    def __init__(self, config: Optional[NightshiftConfig] = None):
        self.config = config or NightshiftConfig()

    def call(self, prompt: str, context: Optional[Dict[str, Any]] = None) -> dict:
        context = context or {}
        if self.config.fixture_mode:
            return {
                "provider": "nightshift",
                "model": self.config.model,
                "mode": "fixture",
                "prompt": prompt,
                "output": (
                    "Structured evidence summary: the system should prioritize deterministic scoring, "
                    "evidence provenance, and a conservative fallback strategy."
                ),
                "metadata": {
                    "context": context,
                    "temperature": self.config.temperature,
                    "max_tokens": self.config.max_tokens,
                },
            }

        return {
            "provider": "nightshift",
            "model": self.config.model,
            "mode": "live",
            "prompt": prompt,
            "output": "Live Nightshift call would be sent here.",
            "metadata": {"context": context},
        }


class NightshiftClient:
    def __init__(self, config: Optional[NightshiftConfig] = None):
        self.config = config or NightshiftConfig()
        self.model = NightshiftModel(self.config)

    def prompt(self, task: str, context: Optional[Dict[str, Any]] = None) -> NightshiftResult:
        payload = self.model.call(task, context or {})
        return NightshiftResult(
            provider=payload["provider"],
            model=payload["model"],
            mode=payload["mode"],
            prompt=payload["prompt"],
            output=payload["output"],
            metadata=payload["metadata"],
        )
