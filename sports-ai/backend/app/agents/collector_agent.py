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
  - h2h                      -> met=H2H
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
from difflib import SequenceMatcher

import requests
import joblib


# -----------------------
# Config
# -----------------------

ALLSPORTS_API_KEY = os.environ.get("ALLSPORTS_API_KEY")
ALLSPORTS_BASE_URL = (os.environ.get("ALLSPORTS_BASE_URL") or "https://apiv2.allsportsapi.com/football/").rstrip("/")

# Cache TTLs (seconds). These provide a good balance between freshness and rate limiting.
ALLSPORTS_COUNTRIES_TTL = max(int(os.environ.get("ALLSPORTS_COUNTRIES_TTL", "3600")), 0)
ALLSPORTS_LEAGUES_TTL = max(int(os.environ.get("ALLSPORTS_LEAGUES_TTL", "3600")), 0)

# Simple in-process caches keyed by request scope.
_COUNTRIES_CACHE: Dict[str, Any] = {"data": None, "exp": 0.0}
_LEAGUES_CACHE: Dict[str, Dict[str, Any]] = {}

LEAGUE_ID_FALLBACK: Dict[str, str] = {
    "premier league": "152",
    "english premier league": "152",
    "la liga": "302",
    "liga": "302",
    "serie a": "207",
    "bundesliga": "175",
    "ligue 1": "168",
    "uefa champions league": "3",
    "champions league": "3",
    "uefa europa league": "4",
    "europa league": "4",
    "major league soccer": "332",
    "mls": "332",
    "eredivisie": "244",
}

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

    def handle(self, request, params=None) -> Dict[str, Any]:
        """
        Handles both router-style: handle({"intent": ..., "args": {...}})
        and legacy style: handle(intent, args)
        """
        trace: list[Dict[str, Any]] = []
        try:
            # Detect call style
            if isinstance(request, dict):
                intent = request.get("intent")
                raw_args = request.get("args") or {}
            else:
                # Legacy: request is intent string, params is args dict
                intent = request
                raw_args = params or {}
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
                # If caller requested augmentation, synthesize a timeline when missing
                try:
                    if a.get('augment_tags') and data:
                        # extract the event dict from various possible shapes
                        ev = None
                        if isinstance(data, dict) and isinstance(data.get('result'), list) and data.get('result'):
                            ev = data['result'][0]
                        elif isinstance(data, dict) and data.get('event') and isinstance(data.get('event'), dict):
                            ev = data.get('event')
                        elif isinstance(data, dict) and (data.get('events') or data.get('fixtures')):
                            # pick first
                            col = data.get('events') or data.get('fixtures')
                            if isinstance(col, list) and col:
                                ev = col[0]
                        elif isinstance(data, dict) and data:
                            # provider sometimes returns the event object directly
                            # pick first dict-like nested value
                            for v in data.values():
                                if isinstance(v, dict) and v.get('event_key'):
                                    ev = v
                                    break

                        if ev is not None:
                            # ensure timeline key exists
                            tl_keys = ('timeline','timeline_items','events','event_timeline')
                            existing = None
                            for k in tl_keys:
                                if isinstance(ev.get(k), list):
                                    existing = ev.get(k)
                                    break
                            if not existing or len(existing) == 0:
                                synthesized = _synthesize_timeline_from_event(ev)
                                if synthesized:
                                    # attach under 'timeline' for consistency
                                    ev['timeline'] = synthesized
                                    # if data.result exists, replace the first element
                                    if isinstance(data, dict) and isinstance(data.get('result'), list) and data.get('result'):
                                        data['result'][0] = ev
                            # run tag augmentation in-place (use provided model_path if supplied)
                            if isinstance(ev.get('timeline'), list):
                                model_obj = None
                                model_path = a.get('model_path') or a.get('model')
                                if model_path:
                                    try:
                                        model_obj = _load_model_cached(model_path)
                                    except Exception:
                                        model_obj = None
                                _augment_timeline_with_tags(ev['timeline'], model=model_obj)
                                # ensure returned data reflects changes
                                if isinstance(data, dict) and isinstance(data.get('result'), list) and data.get('result'):
                                    data['result'][0] = ev
                except Exception:
                    # never fail the intent due to augmentation/synthesis problems
                    pass

                # If caller requested the lightweight best-player heuristic, compute and attach it.
                try:
                    if a.get('include_best_player') and data:
                        ev = None
                        if isinstance(data, dict) and isinstance(data.get('result'), list) and data.get('result'):
                            ev = data['result'][0]
                        elif isinstance(data, dict) and data.get('event') and isinstance(data.get('event'), dict):
                            ev = data.get('event')
                        elif isinstance(data, dict) and (data.get('events') or data.get('fixtures')):
                            col = data.get('events') or data.get('fixtures')
                            if isinstance(col, list) and col:
                                ev = col[0]
                        elif isinstance(data, dict) and data:
                            for v in data.values():
                                if isinstance(v, dict) and v.get('event_key'):
                                    ev = v
                                    break

                        if ev is not None:
                            try:
                                bp = _compute_best_player_from_event(ev)
                                if bp:
                                    ev['best_player'] = bp
                                    if isinstance(data, dict) and isinstance(data.get('result'), list) and data.get('result'):
                                        data['result'][0] = ev
                            except Exception:
                                # non-fatal: best-player is a convenience field
                                pass
                except Exception:
                    # swallow any unexpected errors here
                    pass

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

            elif intent == "h2h":
                # Head-to-head: provider expects param "h2h" as "firstTeamId-secondTeamId".
                # Accept flexible args and compose when missing.
                a = dict(args or {})
                if not a.get("h2h"):
                    fa = a.get("firstTeamId") or a.get("teamA") or a.get("team_a")
                    fb = a.get("secondTeamId") or a.get("teamB") or a.get("team_b")
                    if fa and fb:
                        a["h2h"] = f"{fa}-{fb}"
                meta, data = self._call("H2H", a, trace)

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

    def _countries_cached(self, trace: list[dict]) -> list[dict]:
        """Return Countries payload, reusing cached data when TTL allows."""
        ttl = ALLSPORTS_COUNTRIES_TTL
        now = time.time()
        if ttl > 0:
            cached = _COUNTRIES_CACHE
            if cached.get("data") is not None and cached.get("exp", 0.0) > now:
                trace.append({"step": "countries_cache_hit", "count": len(cached["data"])})
                return cached["data"]
        meta, data = self._call("Countries", {}, trace)
        result = (data or {}).get("result")
        if result is None:
            if ttl > 0 and _COUNTRIES_CACHE.get("data") is not None:
                trace.append({
                    "step": "countries_cache_reuse_stale",
                    "count": len(_COUNTRIES_CACHE["data"]),
                    "reason": "fetch_failed",
                })
                return _COUNTRIES_CACHE["data"]
            trace.append({"step": "countries_cache_fetch_empty"})
            return []
        countries = result or []
        if ttl > 0:
            _COUNTRIES_CACHE["data"] = countries
            _COUNTRIES_CACHE["exp"] = now + ttl
            trace.append({"step": "countries_cache_store", "count": len(countries), "ttl_s": ttl})
        else:
            trace.append({"step": "countries_cache_disabled", "count": len(countries)})
        return countries

    def _leagues_cached(self, trace: list[dict], *, countryId: str | None = None) -> list[dict]:
        """Return Leagues payload (optionally scoped by country), with TTL caching."""
        ttl = ALLSPORTS_LEAGUES_TTL
        now = time.time()
        key = str(countryId) if countryId is not None else "__ALL__"
        if ttl > 0:
            cached = _LEAGUES_CACHE.get(key)
            if cached and cached.get("data") is not None and cached.get("exp", 0.0) > now:
                trace.append({"step": "leagues_cache_hit", "key": key, "count": len(cached["data"])})
                return cached["data"]
        args = {"countryId": countryId} if countryId else {}
        meta, data = self._call("Leagues", args, trace)
        result = (data or {}).get("result")
        if result is None:
            if ttl > 0:
                cached = _LEAGUES_CACHE.get(key)
                if cached and cached.get("data") is not None:
                    trace.append({
                        "step": "leagues_cache_reuse_stale",
                        "key": key,
                        "count": len(cached["data"]),
                        "reason": "fetch_failed",
                    })
                    return cached["data"]
            trace.append({"step": "leagues_cache_fetch_empty", "key": key})
            return []
        leagues = result or []
        if ttl > 0:
            _LEAGUES_CACHE[key] = {"data": leagues, "exp": now + ttl}
            trace.append({"step": "leagues_cache_store", "key": key, "count": len(leagues), "ttl_s": ttl})
        else:
            trace.append({"step": "leagues_cache_disabled", "key": key, "count": len(leagues)})
        return leagues

    # -----------------------
    # Name resolvers (zero normalization — just ID lookup)
    # -----------------------
    def _resolve_country_id(self, country_name: str, trace: list[dict]) -> str | None:
        if not country_name:
            return None
        countries = self._countries_cached(trace)
        name_l = country_name.strip().lower()
        # prefer exact match, fallback to contains
        exact = [c for c in countries if (c.get("country_name") or "").strip().lower() == name_l]
        cand = exact or [c for c in countries if name_l in (c.get("country_name") or "").strip().lower()]
        return (cand[0].get("country_key") if cand and cand[0].get("country_key") else None)

    def _resolve_league_id(self, league_name: str, trace: list[dict], *, countryId: str | None = None) -> str | None:
        if not league_name:
            return None
        leagues = self._leagues_cached(trace, countryId=countryId)
        name_l = league_name.strip().lower()
        exact = [l for l in leagues if (l.get("league_name") or "").strip().lower() == name_l]
        cand = exact or [l for l in leagues if name_l in (l.get("league_name") or "").strip().lower()]
        league_key = (cand[0].get("league_key") if cand and cand[0].get("league_key") else None)
        if league_key:
            return str(league_key)
        fallback = LEAGUE_ID_FALLBACK.get(name_l)
        if fallback:
            trace.append({"step": "league_fallback_id", "leagueName": league_name, "resolved": fallback})
            return fallback
        return None

    def _pick_best_team(self, query: str, teams: list[dict]) -> Optional[dict]:
        q_norm = query.strip().lower()
        if not q_norm:
            return None

        def score_name(name: str) -> float:
            candidate = name.strip().lower()
            if not candidate:
                return 0.0
            if candidate == q_norm:
                return 1.0
            if candidate.startswith(q_norm):
                return 0.94
            if q_norm in candidate:
                # reward matches on word boundaries
                tokens = candidate.split()
                if any(token == q_norm for token in tokens):
                    return 0.92
                return 0.9
            return SequenceMatcher(None, candidate, q_norm).ratio()

        best: Optional[dict] = None
        best_score = -1.0

        name_fields = (
            "team_name",
            "team_name_official",
            "team_name_en",
            "team_name_english",
            "team_name_short",
            "team_name_common",
        )

        for team in teams:
            names = [
                str(team.get(field)).strip()
                for field in name_fields
                if isinstance(team.get(field), str) and str(team.get(field)).strip()
            ]
            if not names:
                continue
            score = max(score_name(name) for name in names)
            if score > best_score:
                best = team
                best_score = score
            elif score == best_score and best is not None:
                # tie-breaker: prefer team with numeric key (provider canonical)
                best_key = best.get("team_key") or best.get("team_id")
                candidate_key = team.get("team_key") or team.get("team_id")
                if candidate_key and not best_key:
                    best = team
        return best

    def _resolve_team_id(
        self,
        team_name: str,
        trace: list[dict],
        *,
        leagueId: str | None = None,
        countryId: str | None = None,
    ) -> tuple[Optional[str], Optional[str]]:
        if not team_name:
            return (None, None)
        query = team_name.strip()
        if not query:
            return (None, None)

        params: Dict[str, Any] = {"teamName": query}
        if leagueId:
            params["leagueId"] = leagueId
        if countryId:
            params["countryId"] = countryId

        meta, data = self._call("Teams", params, trace)
        teams = (data or {}).get("result") or []
        if not teams:
            return (None, None)

        best = self._pick_best_team(query, teams)
        if not best:
            return (None, None)

        team_key = best.get("team_key") or best.get("team_id") or best.get("teamId") or best.get("id")
        if team_key is None:
            return (None, None)

        canonical = (
            best.get("team_name")
            or best.get("team_name_official")
            or best.get("team_name_en")
            or best.get("team_name_english")
            or best.get("team_name_short")
        )

        return str(team_key), canonical

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

        league_id = str(a.get("leagueId")) if a.get("leagueId") else None
        country_id = str(a.get("countryId")) if a.get("countryId") else None
        team_lookup_cache: Dict[tuple[str, Optional[str], Optional[str]], tuple[Optional[str], Optional[str]]] = {}

        def resolve_team_field(field: str) -> tuple[Optional[str], Optional[str]]:
            raw = a.get(field)
            if not isinstance(raw, str) or not raw.strip():
                return (None, None)
            key = (raw.strip().lower(), league_id, country_id)
            if key not in team_lookup_cache:
                team_lookup_cache[key] = self._resolve_team_id(raw, trace, leagueId=league_id, countryId=country_id)
            return team_lookup_cache[key]

        team_name_raw = a.get("teamName") if isinstance(a.get("teamName"), str) else None
        if team_name_raw and not a.get("teamId"):
            team_id, canonical = resolve_team_field("teamName")
            if team_id:
                a["teamId"] = team_id
                if canonical:
                    a["teamName"] = canonical
            else:
                trace.append({
                    "step": "asapi_team_resolve_failed",
                    "teamName": team_name_raw,
                    "leagueId": league_id,
                })

        # Resolve explicit teamA / teamB for head-to-head or dual-team contexts
        team_a_raw = None
        for key in ("teamA", "team_a"):
            if isinstance(a.get(key), str) and a.get(key).strip():
                team_a_raw = a.get(key)
                if key != "teamA":
                    a["teamA"] = a.get(key)
                break
        if team_a_raw:
            team_a_id, team_a_canonical = resolve_team_field("teamA")
            if team_a_id:
                a["firstTeamId"] = team_a_id
                if team_a_canonical:
                    a["teamA"] = team_a_canonical
            else:
                trace.append({
                    "step": "asapi_team_resolve_failed",
                    "teamName": team_a_raw,
                    "context": "teamA",
                    "leagueId": league_id,
                })

        team_b_raw = None
        for key in ("teamB", "team_b"):
            if isinstance(a.get(key), str) and a.get(key).strip():
                team_b_raw = a.get(key)
                if key != "teamB":
                    a["teamB"] = a.get(key)
                break
        if team_b_raw:
            team_b_id, team_b_canonical = resolve_team_field("teamB")
            if team_b_id:
                a["secondTeamId"] = team_b_id
                if team_b_canonical:
                    a["teamB"] = team_b_canonical
            else:
                trace.append({
                    "step": "asapi_team_resolve_failed",
                    "teamName": team_b_raw,
                    "context": "teamB",
                    "leagueId": league_id,
                })

        # Compose h2h param when both ids resolved
        if a.get("firstTeamId") and a.get("secondTeamId") and not a.get("h2h"):
            a["h2h"] = f"{a['firstTeamId']}-{a['secondTeamId']}"

        # playerName: native support exists — we leave it in place.
        return a


def _synthesize_timeline_from_event(ev: Dict[str, Any]) -> list:
    """Create a lightweight timeline from available event data when provider doesn't supply one.
    This inspects common fields like scorers/players/goals and comments and synthesizes simple
    minute/description entries. Returns a list of timeline items or empty list.
    """
    out = []
    try:
        # 1) Scorers (common shapes)
        if isinstance(ev.get('scorers'), list) and ev.get('scorers'):
            for s in ev.get('scorers'):
                minute = s.get('minute') or s.get('time') or s.get('comments_time') or s.get('minute_played')
                player = s.get('name') or s.get('player') or s.get('player_name')
                desc = s.get('text') or s.get('description') or (f"Goal by {player}" if player else 'Goal')
                out.append({'minute': minute or '', 'description': desc})

        # 2) AllSports often has home/away scorers lists
        if not out:
            for key in ('scorers_home','home_scorers','goals_home'):
                arr = ev.get(key)
                if isinstance(arr, list) and arr:
                    for s in arr:
                        minute = s.get('minute') if isinstance(s, dict) else None
                        player = (s.get('name') if isinstance(s, dict) else s) or ''
                        desc = f"Goal by {player}" if player else 'Goal'
                        out.append({'minute': minute or '', 'description': desc})

        # 2b) Substitutions: providers may include structured objects or simple strings
        # Try to capture player_in / player_out when possible to make UI richer.
        subs_keys = ('substitutes', 'substitutions', 'substitute', 'subs')
        for sk in subs_keys:
            arr = ev.get(sk)
            if isinstance(arr, list) and arr:
                for s in arr:
                    try:
                        minute = None
                        player_in = None
                        player_out = None
                        desc = ''
                        if isinstance(s, dict):
                            minute = s.get('minute') or s.get('time') or ''
                            # common shapes: player_in/player_out or player_on/player_off
                            player_in = s.get('player_in') or s.get('player_on') or s.get('on') or s.get('in')
                            player_out = s.get('player_out') or s.get('player_off') or s.get('off') or s.get('out')
                            desc = s.get('description') or s.get('text') or ''
                        else:
                            # sometimes it's a plain string like "Player A ON for Player B"
                            txt = str(s)
                            desc = txt
                            # try to extract "X on for Y" or "Substitution: X on, Y off"
                            import re
                            m = re.search(r"(?P<in>[^,]+?)\s+on\s+for\s+(?P<out>.+)", txt, flags=re.I)
                            if not m:
                                m = re.search(r"(?P<out>[^,]+?)\s+off\s+for\s+(?P<in>.+)", txt, flags=re.I)
                            if m:
                                player_in = (m.group('in') or '').strip()
                                player_out = (m.group('out') or '').strip()

                        item = {'minute': minute or '', 'description': desc or 'Substitution'}
                        if player_in:
                            item['player_in'] = player_in
                        if player_out:
                            item['player_out'] = player_out
                        out.append(item)
                    except Exception:
                        # ignore malformed substitution entries
                        pass

        if not out:
            # 3) Try a generic 'goals' or 'scorers' mapping where keys map to minutes
            for k in ('goals','scorers_map'):
                g = ev.get(k)
                if isinstance(g, dict):
                    for player, m in g.items():
                        out.append({'minute': m or '', 'description': f"Goal by {player}"})

        # 4) Fallback: if we have final scores, synthesize a summary event
        if not out and (ev.get('home_score') is not None or ev.get('away_score') is not None):
            h = ev.get('event_home_team') or ev.get('strHomeTeam') or 'Home'
            a = ev.get('event_away_team') or ev.get('strAwayTeam') or 'Away'
            score = f"{ev.get('home_score','-')} - {ev.get('away_score','-')}"
            out.append({'minute': 'FT', 'description': f'Full time: {h} {score} {a}'})
    except Exception:
        return []

    return out


# Simple model cache to avoid repeated disk loads
_MODEL_CACHE: Dict[str, Any] = {}

def _load_model_cached(path: str):
    """Load a joblib model from path and cache it by path+mtime.
    Returns the loaded model or raises if not loadable.
    """
    if not path:
        raise FileNotFoundError('empty model path')
    p = os.path.abspath(path)
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    mtime = os.path.getmtime(p)
    key = f"{p}:{mtime}"
    cached = _MODEL_CACHE.get(key)
    if cached:
        return cached
    model = joblib.load(p)
    # keep only the latest entry to avoid memory growth
    _MODEL_CACHE.clear()
    _MODEL_CACHE[key] = model
    return model


# Backwards-compat export names (if other modules import these)
AllSportsClient = None            # not needed in RAW version
allsports_client = None           # no global client in RAW version
AllSportsCollectorAgent = AllSportsRawAgent


# -----------------------
# Minimal analytics helpers (used by unit tests)
# These are intentionally small, dependency-free implementations that
# provide predictable behavior for tests and demo usage. They can be
# replaced with richer ML or rule-based logic later.
# -----------------------

def _compute_player_hot_streak(events: list, recent_games: int = 5) -> dict:
    """Compute a tiny hot-streak signal from a list of event dicts.
    Expects events as a list of dicts with a numeric 'player_goals' field when available.
    Returns a dict with keys: label, recent_goals, z_score, recent_games_used.
    """
    if not events:
        return {"label": "NO_DATA", "recent_goals": 0, "z_score": 0.0, "recent_games_used": 0}

    # collect goal counts
    goals = [int(e.get("player_goals") or 0) for e in events]
    n = len(goals)
    mean = sum(goals) / n if n > 0 else 0.0
    # overall population std (population, not sample)
    var = sum((g - mean) ** 2 for g in goals) / n if n > 0 else 0.0
    std = var ** 0.5

    used = min(recent_games, n)
    recent_slice = goals[-used:]
    recent_goals = sum(recent_slice)
    recent_avg = (recent_goals / used) if used > 0 else 0.0

    # simple z-like score for tests (safe when std==0)
    z = (recent_avg - mean) / std if std > 0 else 0.0

    # heuristic labeling
    if recent_avg >= max(1.5, mean * 1.5):
        label = "HOT_STREAK"
    else:
        label = "NORMAL"

    return {
        "label": label,
        "recent_goals": recent_goals,
        "z_score": float(z),
        "recent_games_used": used,
    }


def _compute_best_player_from_event(ev: Dict[str, Any]) -> Dict[str, Any] | None:
    """Compute a simple best-player heuristic from an event dict.

    Heuristic: 3 points per goal, 1 point per assist.
    Scans common provider fields (scorers/goals/goal lists and common keys)
    and returns a dict: {name, score, reason} or None when no candidates.
    """
    if not isinstance(ev, dict):
        return None

    def _coalesce(*vals):
        for v in vals:
            if v is not None and v != "":
                return v
        return None

    players: dict = {}

    def add_goal(name: str | None):
        if not name:
            return
        n = str(name).strip()
        if not n:
            return
        st = players.setdefault(n, {"goals": 0, "assists": 0})
        st["goals"] += 1

    def add_assist(name: str | None):
        if not name:
            return
        n = str(name).strip()
        if not n:
            return
        st = players.setdefault(n, {"goals": 0, "assists": 0})
        st["assists"] += 1

    # Candidate lists/keys to examine 
    list_keys = (
        "scorers",
        "scorers_home",
        "scorers_away",
        "home_scorers",
        "away_scorers",
        "goals",
        "goalscorers",
        "goal_scorers",
        "scorers_map",
    )

    for k in list_keys:
        arr = ev.get(k)
        if isinstance(arr, list) and arr:
            for entry in arr:
                try:
                    if isinstance(entry, dict):
                        # common shapes
                        hs = _coalesce(entry.get("home_scorer"), entry.get("scorer"), entry.get("player"), entry.get("name"))
                        asst = _coalesce(entry.get("assist"), entry.get("home_assist"), entry.get("assist_name"), entry.get("assist_player"))
                        # away variants
                        away = _coalesce(entry.get("away_scorer"), entry.get("away_player"))
                        away_assist = _coalesce(entry.get("away_assist"))
                        # add whichever present
                        if hs:
                            add_goal(hs)
                        if asst:
                            add_assist(asst)
                        if away:
                            add_goal(away)
                        if away_assist:
                            add_assist(away_assist)
                    else:
                        # plain string entries like "Player Name"
                        add_goal(str(entry))
                except Exception:
                    # skip malformed entries
                    continue

    # As a fallback, inspect timeline items for tagged goals (description contains 'goal')
    tl = ev.get("timeline") or ev.get("timeline_items") or ev.get("events") or ev.get("event_timeline")
    if isinstance(tl, list) and tl:
        for item in tl:
            try:
                txt = (item.get("description") or item.get("event") or "") if isinstance(item, dict) else str(item)
                if not txt:
                    continue
                low = str(txt).lower()
                if "goal" in low:
                    # try to extract a player name via common patterns "Goal by X" or "X scores"
                    import re

                    m = re.search(r"goal by\s+([A-Z][\w .'-]+)", txt, flags=re.I)
                    if not m:
                        m = re.search(r"([A-Z][\w .'-]+)\s+(?:scores|scored)", txt, flags=re.I)
                    if m:
                        add_goal(m.group(1).strip())
            except Exception:
                pass

    # No players collected
    if not players:
        return None

    # Score and pick best
    best = None
    best_score = -1
    for name, st in players.items():
        score = int(st.get("goals", 0)) * 3 + int(st.get("assists", 0)) * 1
        if score > best_score:
            best_score = score
            best = {"name": name, "score": score, "reason": f"{st.get('goals',0)} goals, {st.get('assists',0)} assists"}

    return best


def _augment_timeline_with_tags(timeline: list, model=None) -> None:
    """Rule-based augmentation: add `predicted_tags` list to each timeline entry.
    This is intentionally lightweight for tests and demo purposes.
    Operates in-place and returns None.
    """
    if not isinstance(timeline, list):
        return
    for item in timeline:
        txt = (item.get("event") or item.get("description") or "")
        t = str(txt).lower()
        tags = []
        if "goal" in t:
            tags.append("GOAL")
        if "header" in t or "headed" in t:
            tags.append("HEADER")
        if "penalty" in t:
            tags.append("PENALTY")
        if "yellow" in t:
            tags.append("YELLOW_CARD")
        if "red" in t:
            tags.append("RED_CARD")
        if "substit" in t:
            tags.append("SUBSTITUTION")

        # Model-based prediction: if a sklearn-like pipeline is provided, call predict
        try:
            if model is not None:
                if hasattr(model, 'predict'):
                    pred = model.predict([str(txt)])
                    if isinstance(pred, (list, tuple)) and len(pred) > 0:
                        lab = pred[0]
                        if lab:
                            tags.append(str(lab).upper())
                elif callable(model):
                    lab = model(str(txt))
                    if lab:
                        tags.append(str(lab).upper())
        except Exception:
            # Do not let model errors break augmentation; fallback to rule-based tags
            pass

        # ensure unique and upper-cased
        item["predicted_tags"] = list(dict.fromkeys([str(x).upper() for x in tags]))


def _extract_multimodal_highlights(youtube_url: str, clip_duration: int = 30, **kwargs) -> dict:
    """Wrapper that delegates to a pluggable extractor (youtube_highlight_shorts_extractor).
    The extractor should expose `extract_youtube_shorts(youtube_url, output_dir, clip_duration, **kw)`
    and return a list of file paths. This wrapper returns a dict with `count` and `clips`.
    """
    try:
        # dynamic import so tests can inject a stub into sys.modules
        from backend.app.models import youtube_highlight_shorts_extractor as extractor
        clips = extractor.extract_youtube_shorts(youtube_url, clip_duration=clip_duration)
    except Exception:
        # fallback: return empty
        clips = []

    out_clips = []
    for p in clips:
        out_clips.append({"path": p, "scores": {"combined": 1.0}})

    return {"count": len(out_clips), "clips": out_clips}
