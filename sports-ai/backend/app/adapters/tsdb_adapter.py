"""
TSDBAdapter — thin wrapper around CollectorAgentV2 (TheSportsDB agent).
Adds consistent return shape and meta.provider="tsdb".
"""

from __future__ import annotations
from typing import Any, Dict

try:
    from ..agents.collector import CollectorAgentV2  # type: ignore
except Exception:
    from backend.app.agents.collector import CollectorAgentV2  # type: ignore


class TSDBAdapter:
    def __init__(self) -> None:
        self.agent = CollectorAgentV2()

    def call(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        req = {"intent": intent, "args": dict(args or {})}  # defensive copy
        resp = self.agent.handle(req)

        # Normalize trace to a list and prepend adapter marker
        inner_meta = (resp.get("meta") or {})
        trace = list(inner_meta.get("trace") or [])
        trace.insert(0, {"step": "adapter_in", "provider": "tsdb", "intent": intent})

        out = {
            "ok": bool(resp.get("ok")),
            "intent": resp.get("intent", intent),                 # passthrough for quick logs
            "args_resolved": resp.get("args_resolved"),           # handy for router/UI
            "data": resp.get("data"),
            "error": resp.get("error"),
            "meta": {
                "provider": "tsdb",
                "trace": trace,
            },
        }
        return out