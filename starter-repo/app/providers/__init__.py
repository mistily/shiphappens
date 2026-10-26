from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class NightshiftConfig:
    model: str = "nightshift-mini"
    api_base: str = "https://mock.example.com/nightshift/v1"
    fixture_mode: bool = True
    temperature: float = 0.2
    max_tokens: int = 512
    timeout_seconds: int = 30
    headers: Dict[str, str] = field(default_factory=lambda: {"x-fixture-mode": "true"})


class NightshiftProvider:
    def __init__(self, config: Optional[NightshiftConfig] = None):
        self.config = config or NightshiftConfig()

    def call(self, prompt: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        context = context or {}
        return {
            "provider": "nightshift",
            "model": self.config.model,
            "mode": "fixture" if self.config.fixture_mode else "live",
            "prompt": prompt,
            "output": (
                "Nightshift fixture output: use the task objective, available evidence, and explicit constraints "
                "to generate a conservative execution plan with source provenance."
            ),
            "metadata": {
                "api_base": self.config.api_base,
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
                "context": context,
            },
        }
