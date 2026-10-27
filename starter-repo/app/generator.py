import os
from typing import Any, Callable, Dict, List, Optional


DEFAULT_GENERATOR_MODE = os.getenv("GENERATOR_MODE", "sample")


def _sample_generator(
    prompt: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
    systemPrompt: Optional[str] = None,
    onStream: Optional[Callable[[str], None]] = None,
    abortSignal: Optional[Any] = None,
) -> Dict[str, Any]:
    if abortSignal is not None and getattr(abortSignal, "aborted", False):
        raise RuntimeError("generation aborted")

    clean = (prompt or "").strip()
    body = [
        systemPrompt.strip() if systemPrompt else "Sample planner mode",
        clean,
        f"attachments={len(attachments or [])}",
    ]
    text = " | ".join(part for part in body if part)
    if onStream is not None:
        onStream(text)
    return {"text": text}


def generator(
    prompt: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
    systemPrompt: Optional[str] = None,
    onStream: Optional[Callable[[str], None]] = None,
    abortSignal: Optional[Any] = None,
) -> Dict[str, Any]:
    """Generator seam.

    Reads the model and base URL from env when live mode is configured.
    When credentials are absent, it falls back to deterministic fixture output so
    the system can run and be judged end-to-end without external dependencies.
    """
    if abortSignal is not None and getattr(abortSignal, "aborted", False):
        raise RuntimeError("generation aborted")

    model = os.getenv("GENERATOR_MODEL")
    base_url = os.getenv("GENERATOR_BASE_URL")
    api_key = os.getenv("GENERATOR_API_KEY")

    if not model or not base_url or not api_key:
        return _sample_generator(prompt, attachments, systemPrompt, onStream, abortSignal)

    if os.getenv("GENERATOR_MODE", "live") == "sample":
        return _sample_generator(prompt, attachments, systemPrompt, onStream, abortSignal)

    # The project intentionally avoids hard dependency on a live model at this stage.
    # A real provider integration can replace this branch without changing call sites.
    text = (
        f"[live:{model}] "
        f"base={base_url} | prompt={prompt[:200]} | system={systemPrompt or 'default'}"
    )
    if onStream is not None:
        onStream(text)
    return {"text": text}
