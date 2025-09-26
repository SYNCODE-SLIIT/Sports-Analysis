"""
AllSportsAdapter — thin wrapper around AllSportsRawAgent (AllSports API agent).
Adds consistent return shape and meta.provider="allsports".
"""

from __future__ import annotations
from typing import Any, Dict

# Robust import to your RAW agent
try:
    from ..agents.game_analytics_agent import AllSportsRawAgent  # type: ignore
except Exception:
    from backend.app.agents.game_analytics_agent import AllSportsRawAgent  # type: ignore


class AllSportsAdapter:
    def __init__(self) -> None:
        self.agent = AllSportsRawAgent()

    def call(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        req = {"intent": intent, "args": args or {}}
        resp = self.agent.handle(req)
        out = {
            "ok": bool(resp.get("ok")),
            "data": resp.get("data"),
            "error": resp.get("error"),
            "meta": {"provider": "allsports", "trace": (resp.get("meta") or {}).get("trace")},
        }
        return out