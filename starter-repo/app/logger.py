from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


def configure_logger(name: str = "shiphappens", log_dir: Optional[str] = None) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if logger.handlers:
        return logger

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    log_path = Path(log_dir or os.getenv("LOG_DIR", "logs"))
    log_path.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(log_path / "app.log", encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


logger = configure_logger()


def emit_trace(event: str, payload: Optional[Dict[str, Any]] = None) -> None:
    trace = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "payload": payload or {},
    }
    log_dir = Path(os.getenv("LOG_DIR", "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    trace_path = log_dir / "sample_trace.jsonl"
    with trace_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(trace) + "\n")
    logger.info("Trace event %s: %s", event, json.dumps(payload or {}, default=str))
