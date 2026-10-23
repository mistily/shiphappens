from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger("shiphappens")


class CompassClient:
    def __init__(self, base_url: Optional[str] = None) -> None:
        self.base_url = (base_url or os.getenv("COMPASS_API_URL") or "http://localhost:8000").rstrip("/")

    async def ping(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/health")
                response.raise_for_status()
                return {"status": "ok", "response": response.json()}
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("Compass health check failed: %s", exc)
            return {"status": "degraded", "response": {"message": str(exc)}}

    async def call_tool(self, tool_name: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        params = payload or {}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(f"{self.base_url}/tools/{tool_name}", json=params)
                response.raise_for_status()
                return response.json()
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("Compass tool call %s failed: %s", tool_name, exc)
            return {
                "tool": tool_name,
                "status": "error",
                "message": str(exc),
                "payload": params,
            }


compass_client = CompassClient()
