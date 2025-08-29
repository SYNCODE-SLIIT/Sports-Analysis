"""
AllSports RAW agent — zero normalization, zero filtering.

This module exposes a tiny pass-through client and an agent that mirrors a broad
set of AllSportsAPI Football endpoints. It ALWAYS returns the provider's raw
JSON object under "data" (including keys like "success", "result", "error", etc.).
No schema shaping, no field picking, no client-side filtering.

Supported intents (pass-through):
  - countries.list           -> met=Countries
  - leagues.list             -> met=Leagues (optional: countryId)
  - fixtures.list            -> met=Fixtures (supports provider params as-is)
  - events.list              -> alias to fixtures.list
  - events.live              -> met=Livescore
  - livescore.list           -> alias to events.live
  - event.get                -> met=Fixtures (matchId=eventId)
  - teams.list               -> met=Teams
  - team.get                 -> met=Teams (same as list; no picking)
  - players.list             -> met=Players
  - player.get               -> met=Players (same as list; no picking)
  - league.table             -> met=Standings
  - video.highlights         -> met=Videos
  - odds.list                -> met=Odds
  - odds.live                -> met=OddsLive
  - probabilities.list       -> met=Probabilities
  - comments.list            -> met=Comments
  - seasons.list             -> met=Leagues (raw; caller may filter by leagueId/Name if desired)
  - Name-based args supported: countryName -> countryId, leagueName -> leagueId, teamName (native), playerName (native).

Design notes:
  • Absolutely no normalization. We just add `APIkey` and forward `args` as query params.
  • We return *everything the provider returns* under response["data"].
  • Minimal tracing is included for debugging (last request meta).
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

import requests


# -----------------------
# Config
# -----------------------

ALLSPORTS_API_KEY = os.environ.get("ALLSPORTS_API_KEY")
ALLSPORTS_BASE_URL = (os.environ.get("ALLSPORTS_BASE_URL") or "https://apiv2.allsportsapi.com/football/").rstrip("/")


# -----------------------
# Errors
# -----------------------

class CollectorError(Exception):
    def __init__(self, code: str, message: str, details: Dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


# -----------------------
# Raw HTTP helper
# -----------------------

def _raw_get(params: Dict[str, Any], timeout: int = 30) -> Dict[str, Any]:
    """Perform a GET to AllSports with the given params (plus APIkey + cache-buster).
    Returns: a dict with keys {ok, status, data, text_head} where `data` is the parsed JSON or None.
    """
    q = dict(params or {})
    q["APIkey"] = ALLSPORTS_API_KEY or ""  # allow empty for clearer errors
    q["_ts"] = str(time.time())
    try:
        r = requests.get(ALLSPORTS_BASE_URL, params=q, timeout=timeout)
        head = (r.text or "")[:200]
        try:
            data = r.json()
        except Exception:
            data = None
        return {"ok": r.status_code == 200, "status": r.status_code, "data": data, "text_head": head, "sent": q}
    except Exception as e:
        return {"ok": False, "status": 0, "data": None, "text_head": f"exc: {e}", "sent": q}


# -----------------------
# Agent (pass-through)
# -----------------------

class AllSportsRawAgent:
    """JSON-only, pass-through agent for AllSportsAPI football endpoints."""

    def handle(self, request: Dict[str, Any]) -> Dict[str, Any]:
        trace: list[Dict[str, Any]] = []
        try:
            if not isinstance(request, dict):
                raise CollectorError("BAD_REQUEST", "Request must be a JSON object")
            intent = request.get("intent")
            raw_args = request.get("args") or {}
            # Best-effort: augment args with IDs when only names were provided
            args = self._ensure_ids_from_names(raw_args, trace)
            if not intent or not isinstance(intent, str):
                raise CollectorError("BAD_REQUEST", "Missing 'intent' (string)")
            if not isinstance(args, dict):
                raise CollectorError("BAD_REQUEST", "'args' must be an object")
            if not ALLSPORTS_API_KEY:
                raise CollectorError("NO_API_KEY", "ALLSPORTS_API_KEY is not configured")

            # Route → provider method + passthrough args
            if intent == "countries.list":
                meta, data = self._call("Countries", args, trace)

            elif intent == "leagues.list":
                # Optional passthrough: countryId
                meta, data = self._call("Leagues", args, trace)

            elif intent in ("fixtures.list", "events.list"):
                # Provider params we simply pass through if present:
                # from, to, date, timezone, countryId, leagueId, matchId, teamId, leagueGroup, withPlayerStats
                meta, data = self._call("Fixtures", args, trace)

            elif intent in ("events.live", "livescore.list"):
                # Optional: timezone, countryId, leagueId, matchId, withPlayerStats
                meta, data = self._call("Livescore", args, trace)

            elif intent == "event.get":
                # Expect eventId -> matchId
                a = dict(args)
                if a.get("eventId") and not a.get("matchId"):
                    a["matchId"] = a["eventId"]
                meta, data = self._call("Fixtures", a, trace)

            elif intent == "teams.list":
                # Accept leagueId, teamId, teamName
                meta, data = self._call("Teams", args, trace)

            elif intent == "team.get":
                # Same as list, no picking — caller decides
                meta, data = self._call("Teams", args, trace)

            elif intent == "players.list":
                # Accept playerId, playerName, leagueId, teamId
                meta, data = self._call("Players", args, trace)

            elif intent == "player.get":
                # Same as list
                meta, data = self._call("Players", args, trace)

            elif intent == "league.table":
                # Accept leagueId (+ optional league_season/season)
                # If 'season' was provided, map to provider's 'league_season' transparently.
                a = dict(args)
                if a.get("season") and not a.get("league_season"):
                    a["league_season"] = a["season"]
                meta, data = self._call("Standings", a, trace)

            elif intent == "video.highlights":
                # Requires eventId
                a = dict(args)
                if a.get("eventId"):
                    a.setdefault("matchId", a["eventId"])  # provider sometimes accepts either
                meta, data = self._call("Videos", a, trace)

            elif intent == "odds.list":
                # from, to, countryId, leagueId, matchId
                meta, data = self._call("Odds", args, trace)

            elif intent == "odds.live":
                meta, data = self._call("OddsLive", args, trace)

            elif intent == "probabilities.list":
                meta, data = self._call("Probabilities", args, trace)

            elif intent == "comments.list":
                # from, to, live, countryId, leagueId, matchId, timezone
                meta, data = self._call("Comments", args, trace)

            elif intent == "seasons.list":
                # No dedicated endpoint; return raw Leagues so caller can inspect seasons.
                meta, data = self._call("Leagues", args, trace)

            else:
                raise CollectorError("UNKNOWN_INTENT", f"Unsupported intent '{intent}'")

            return {
                "ok": True,
                "intent": intent,
                "args_resolved": args,
                "data": data,                 # RAW provider body
                "meta": {"trace": trace, "base_url": ALLSPORTS_BASE_URL},
            }

        except CollectorError as e:
            return {
                "ok": False,
                "error": {"code": e.code, "message": e.message, "details": e.details},
                "meta": {"trace": trace, "base_url": ALLSPORTS_BASE_URL},
            }
        except Exception as e:
            return {
                "ok": False,
                "error": {"code": "INTERNAL", "message": str(e)},
                "meta": {"trace": trace, "base_url": ALLSPORTS_BASE_URL},
            }

    # ------------- internals -------------

    def _call(self, met: str, args: Dict[str, Any], trace: list[Dict[str, Any]]):
        params = dict(args or {})
        params["met"] = met
        res = _raw_get(params)
        trace.append({
            "step": "allsports_call",
            "met": met,
            "status": res.get("status"),
            "sent": {k: v for k, v in (res.get("sent") or {}).items() if k != "APIkey"},
            "ok": res.get("ok"),
        })
        # Return the provider body exactly under "data"
        return {"met": met, "status": res.get("status")}, (res.get("data") if res else None)

    # -----------------------
    # Name resolvers (zero normalization — just ID lookup)
    # -----------------------
    def _resolve_country_id(self, country_name: str, trace: list[dict]) -> str | None:
        if not country_name:
            return None
        meta, data = self._call("Countries", {}, trace)
        countries = (data or {}).get("result") or []
        name_l = country_name.strip().lower()
        # prefer exact match, fallback to contains
        exact = [c for c in countries if (c.get("country_name") or "").strip().lower() == name_l]
        cand = exact or [c for c in countries if name_l in (c.get("country_name") or "").strip().lower()]
        return (cand[0].get("country_key") if cand and cand[0].get("country_key") else None)

    def _resolve_league_id(self, league_name: str, trace: list[dict], *, countryId: str | None = None) -> str | None:
        if not league_name:
            return None
        args = {}
        if countryId:
            args["countryId"] = countryId
        meta, data = self._call("Leagues", args, trace)
        leagues = (data or {}).get("result") or []
        name_l = league_name.strip().lower()
        exact = [l for l in leagues if (l.get("league_name") or "").strip().lower() == name_l]
        cand = exact or [l for l in leagues if name_l in (l.get("league_name") or "").strip().lower()]
        return (cand[0].get("league_key") if cand and cand[0].get("league_key") else None)

    def _ensure_ids_from_names(self, args: Dict[str, Any], trace: list[dict]) -> Dict[str, Any]:
        """
        Best-effort: if caller provided *Name fields, resolve to corresponding IDs for AllSports.
        Does not remove the name fields; just augments with IDs so provider can filter.
        Supported:
          - countryName -> countryId
          - leagueName  -> leagueId   (optionally uses countryId if available)
          - teamName    -> teamId     (native endpoint supports it; we leave it as-is but also try resolving to a specific teamId when useful)
          - playerName  -> playerId   (left as-is; endpoint supports it)
          - eventId is also mirrored into matchId where appropriate elsewhere.
        """
        a = dict(args or {})

        # countryName → countryId
        if a.get("countryName") and not a.get("countryId"):
            cid = self._resolve_country_id(a["countryName"], trace)
            if cid:
                a["countryId"] = cid

        # leagueName → leagueId (optionally scoped by countryId if we have it)
        if a.get("leagueName") and not a.get("leagueId"):
            lid = self._resolve_league_id(a["leagueName"], trace, countryId=str(a.get("countryId")) if a.get("countryId") else None)
            if lid:
                a["leagueId"] = lid

        # teamName: AllSports Teams/Players endpoints already accept teamName,
        # but for Fixtures/Livescore it requires teamId. We'll try to resolve to teamId using Teams.
        if a.get("teamName") and not a.get("teamId"):
            # Try Teams with teamName (+ optional leagueId) to find a precise id
            q = {"teamName": a["teamName"]}
            if a.get("leagueId"):
                q["leagueId"] = a["leagueId"]
            meta, data = self._call("Teams", q, trace)
            teams = (data or {}).get("result") or []
            name_l = a["teamName"].strip().lower()
            exact = [t for t in teams if (t.get("team_name") or "").strip().lower() == name_l]
            pick = (exact[0] if exact else (teams[0] if teams else None))
            if pick and pick.get("team_key"):
                a["teamId"] = pick["team_key"]

        # Trace when teamName could not be resolved to an id (helps router fallback decisions)
        if a.get("teamName") and not a.get("teamId"):
            trace.append({
                "step": "asapi_team_resolve_failed",
                "teamName": a.get("teamName"),
                "leagueId": a.get("leagueId")
            })

        # playerName: native support exists — we leave it in place.
        return a


# Backwards-compat export names (if other modules import these)
AllSportsClient = None            # not needed in RAW version
allsports_client = None           # no global client in RAW version
AllSportsCollectorAgent = AllSportsRawAgent