"""
RouterCollector — single front door that decides which provider agent to call.

Policy (initial, simple):
  • TSDB (CollectorAgentV2) is PRIMARY for: leagues.*, seasons.list, teams.*, events.list, event.get,
    league.table, video.highlights, venue.get
  • AllSports (AllSportsRawAgent) is PRIMARY for: players.*, odds.*, probabilities.*, comments.*, events.live / livescore.list
  • Fallback: if PRIMARY returns ok=False or "empty-ish" data, try the other provider when it has a near-equivalent.
  • Absolutely no normalization: we return the chosen provider's raw "data" payload.

This module exposes a single class: RouterCollector, with .handle({intent, args}).
"""

from __future__ import annotations
from typing import Any, Dict, Tuple

# --- Adapters (thin wrappers around your existing agents) ---
from ..adapters.tsdb_adapter import TSDBAdapter
from ..adapters.allsports_adapter import AllSportsAdapter


class RouterError(Exception):
    def __init__(self, code: str, message: str, details: Dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class RouterCollector:
    def __init__(self) -> None:
        self.tsdb = TSDBAdapter()
        self.asapi = AllSportsAdapter()

    # ---- public entry ----
    def handle(self, request: Dict[str, Any]) -> Dict[str, Any]:
        trace: list[Dict[str, Any]] = []
        try:
            if not isinstance(request, dict):
                raise RouterError("BAD_REQUEST", "Request must be a JSON object")
            intent = request.get("intent")
            args = request.get("args") or {}
            if not intent or not isinstance(intent, str):
                raise RouterError("BAD_REQUEST", "Missing 'intent' (string)")
            if not isinstance(args, dict):
                raise RouterError("BAD_REQUEST", "'args' must be an object")

            primary, fallback = self._route(intent)

            # 1) Call primary
            primary_name = primary[0]
            primary_call = primary[1]
            p_resp = primary_call(intent, args)
            trace.append({"step": "primary", "provider": primary_name, "ok": p_resp.get("ok"), "intent": intent})

            # 2) Decide if we need fallback
            if p_resp.get("ok") and not self._is_empty(p_resp.get("data")):
                return {
                    "ok": True,
                    "intent": intent,
                    "args_resolved": args,
                    "data": p_resp.get("data"),
                    "meta": {
                        "source": {"primary": primary_name, "fallback": None},
                        "trace": trace + (p_resp.get("meta", {}).get("trace") or []),
                    },
                }

            # If no fallback available, return primary result as-is
            if not fallback:
                return {
                    "ok": p_resp.get("ok", False),
                    "intent": intent,
                    "args_resolved": args,
                    "data": p_resp.get("data"),
                    "error": p_resp.get("error"),
                    "meta": {
                        "source": {"primary": primary_name, "fallback": None},
                        "trace": trace + (p_resp.get("meta", {}).get("trace") or []),
                    },
                }

            # 3) Fallback attempt
            fb_name = fallback[0]
            fb_call = fallback[1]
            f_resp = fb_call(intent, args)
            trace.append({"step": "fallback", "provider": fb_name, "ok": f_resp.get("ok"), "intent": intent})

            ok = f_resp.get("ok") and not self._is_empty(f_resp.get("data"))
            if ok:
                return {
                    "ok": True,
                    "intent": intent,
                    "args_resolved": args,
                    "data": f_resp.get("data"),
                    "meta": {
                        "source": {"primary": primary_name, "fallback": fb_name},
                        "trace": trace + (p_resp.get("meta", {}).get("trace") or []) + (f_resp.get("meta", {}).get("trace") or []),
                    },
                }

            # Both failed/empty — return primary result (more likely what caller expects)
            return {
                "ok": p_resp.get("ok", False),
                "intent": intent,
                "args_resolved": args,
                "data": p_resp.get("data"),
                "error": p_resp.get("error") or f_resp.get("error"),
                "meta": {
                    "source": {"primary": primary_name, "fallback": fb_name},
                    "trace": trace + (p_resp.get("meta", {}).get("trace") or []) + (f_resp.get("meta", {}).get("trace") or []),
                },
            }

        except RouterError as e:
            return {"ok": False, "error": {"code": e.code, "message": e.message, "details": e.details}, "meta": {"trace": trace}}
        except Exception as e:
            return {"ok": False, "error": {"code": "INTERNAL", "message": str(e)}, "meta": {"trace": trace}}

    # ---- routing rules ----
    def _route(self, intent: str) -> Tuple[Tuple[str, callable], Tuple[str, callable] | None]:
        """
        Returns (primary tuple, fallback tuple|None)
        Each tuple: (provider_name, call_fn)
        """
        tsdb_first = {
            "leagues.list", "league.get", "seasons.list",
            "teams.list", "team.get",
            "events.list", "event.get",
            "league.table",
            "venue.get", "event.results", "event.tv",
        }
        allsports_first = {
            "players.list", "player.get",
            "odds.list", "odds.live",
            "probabilities.list",
            "comments.list",
            "events.live", "livescore.list",
            "video.highlights",
            # you can add "fixtures.list" here if you want ASAPI-by-date to be primary
        }

        if intent in allsports_first:
            return (("allsports", self._call_allsports), ("tsdb", self._call_tsdb))
        if intent in tsdb_first:
            return (("tsdb", self._call_tsdb), ("allsports", self._call_allsports))

        # Unknown → default to TSDB then fallback to ASAPI
        return (("tsdb", self._call_tsdb), ("allsports", self._call_allsports))

    # ---- empty heuristics (RAW-friendly) ----
    def _is_empty(self, data: Any) -> bool:
        if data is None:
            return True
        # AllSports shapes
        if isinstance(data, dict):
            if "success" in data:
                # Treat success==1 without a usable 'result' as EMPTY so router can fallback
                if data.get("success") == 1:
                    if "result" not in data:
                        return True
                    res = data.get("result")
                    if isinstance(res, list):
                        return len(res) == 0
                    if isinstance(res, dict):
                        return len(res) == 0
                    return res is None
                # If success==0, check result as well
                if data.get("success") == 0:
                    res = data.get("result")
                    if isinstance(res, list):
                        return len(res) == 0
                    if isinstance(res, dict):
                        return len(res) == 0
                    return res is None
            # Generic provider shapes
            if "result" in data:
                res = data.get("result")
                if isinstance(res, list):
                    return len(res) == 0
                if isinstance(res, dict):
                    return len(res) == 0
                return res is None
            # TSDB shapes (events, teams, players, table)
            for k in ("events", "teams", "players", "table"):
                if k in data:
                    v = data.get(k)
                    if isinstance(v, list):
                        return len(v) == 0
                    return v is None
        if isinstance(data, list):
            return len(data) == 0
        return False

    # ---- adapter bridges ----
    def _call_tsdb(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        return self.tsdb.call(intent, args)

    def _call_allsports(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        return self.asapi.call(intent, args)