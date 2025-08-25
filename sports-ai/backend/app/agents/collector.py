
from typing import Any, Dict, Tuple, List
# Try relative import first (normal package layout). Fallback to absolute if executed differently.
try:  # pragma: no cover - import robustness
    from ..utils.http_client import get_json  # type: ignore
except Exception:  # noqa: blanket ok here
    try:
        from backend.app.utils.http_client import get_json  # type: ignore
    except Exception as _e:  # final fallback
        raise ImportError("Cannot import get_json from utils.http_client") from _e

# Optional AllSports API client import.  This provides a secondary
# datasource so the collector can fall back if TheSportsDB is unavailable.
try:  # pragma: no cover - import robustness
    from .game_analytics_agent import allsports_client  # type: ignore
except Exception:  # noqa: blanket ok here
    try:
        from backend.app.agents.game_analytics_agent import allsports_client  # type: ignore
    except Exception:  # If even this fails we operate without the fallback.
        allsports_client = None

from dataclasses import dataclass

@dataclass
class Team:
    """Lightweight Team model (avoids separate schemas module).

    Only fields actually used by _norm_team / list_teams_in_league are defined.
    """
    id: str | None = None
    name: str | None = None
    alt_name: str | None = None
    league: str | None = None
    country: str | None = None
    formed_year: int = 0
    stadium: str | None = None
    stadium_thumb: str | None = None
    website: str | None = None
    badge: str | None = None
    banner: str | None = None
    jersey: str | None = None
    description: str | None = None

# -----------------------
# Errors
# -----------------------
class CollectorError(Exception):
    def __init__(self, code: str, message: str, details: Dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

class AmbiguousError(CollectorError):
    pass

class NotFoundError(CollectorError):
    pass


# -----------------------
# Collector Agent
# -----------------------
class CollectorAgentV2:
    """JSON-only rule-based collector for TheSportsDB (Soccer only)."""

    def handle(self, request: Dict[str, Any]) -> Dict[str, Any]:
        trace: list[Dict[str, Any]] = []
        try:
            if not isinstance(request, dict):
                raise CollectorError("BAD_REQUEST", "Request must be a JSON object")
            intent = request.get("intent")
            args = request.get("args") or {}
            if not intent or not isinstance(intent, str):
                raise CollectorError("BAD_REQUEST", "Missing 'intent' (string)")
            if not isinstance(args, dict):
                raise CollectorError("BAD_REQUEST", "'args' must be an object")

            if intent == "leagues.list":
                data, resolved = self._cap_leagues_list(args, trace)
            elif intent == "league.get":
                data, resolved = self._cap_league_get(args, trace)
            elif intent == "teams.list":
                data, resolved = self._cap_teams_list(args, trace)
            elif intent == "team.get":
                data, resolved = self._cap_team_get(args, trace)
            elif intent == "players.list":
                data, resolved = self._cap_players_list(args, trace)
            elif intent == "player.get":
                data, resolved = self._cap_player_get(args, trace)
            elif intent == "events.list":
                data, resolved = self._cap_events_list(args, trace)
            elif intent == "event.get":
                data, resolved = self._cap_event_get(args, trace)
            elif intent == "seasons.list":
                data, resolved = self._cap_seasons_list(args, trace)
            else:
                raise CollectorError("UNKNOWN_INTENT", f"Unsupported intent '{intent}'")

            return {
                "ok": True,
                "intent": intent,
                "args_resolved": resolved,
                "data": data,
                "meta": {"trace": trace},
            }
        except CollectorError as e:
            return {
                "ok": False,
                "error": {"code": e.code, "message": e.message, "details": e.details},
                "meta": {"trace": trace},
            }
        except Exception as e:
            return {
                "ok": False,
                "error": {"code": "INTERNAL", "message": str(e)},
                "meta": {"trace": trace},
            }

    # -----------------------
    # Helpers
    # -----------------------
    def _http(self, path: str, params: dict | None, trace: list[Dict[str, Any]]) -> dict:
        import time
        p = dict(params or {})
        p["_ts"] = str(time.time())  # cache-buster
        data = get_json(path, p)
        trace.append({"step": "http_get", "path": path, "params": p})
        return data or {}

    def _first_exact_or_single(self, candidates: list[dict], key: str, value: str) -> Tuple[dict | None, list[dict]]:
        v = (value or "").strip().lower()
        exact = [c for c in candidates if (c.get(key) or "").strip().lower() == v]
        if exact:
            return exact[0], candidates
        return None, candidates

    # -----------------------
    # Resolvers
    # -----------------------
    def _resolve_league_id(self, name: str, trace: list[Dict[str, Any]]) -> str:
        # TheSportsDB free tier does not expose /search_leagues.php.
        # Resolve league names by listing soccer leagues and matching locally.
        if not name:
            raise CollectorError("MISSING_ARG", "Provide leagueName or leagueId")

        # 1) Try search_all_leagues for Soccer (some payloads return key 'countries').
        data = self._http("/search_all_leagues.php", {"s": "Soccer"}, trace)
        leagues = data.get("countries") or data.get("leagues") or []

        name_l = name.strip().lower()
        candidates = [L for L in leagues if name_l in ((L.get("strLeague") or "").strip().lower())]

        # 2) Fallback to all_leagues then filter soccer + match by name.
        if not candidates:
            data_all = self._http("/all_leagues.php", {}, trace)
            all_leagues = [L for L in (data_all.get("leagues") or []) if (L.get("strSport") or "").lower() == "soccer"]
            candidates = [L for L in all_leagues if name_l in ((L.get("strLeague") or "").strip().lower())]

        if not candidates:
            raise NotFoundError("NOT_FOUND", f"No league found for '{name}'")

        # Prefer exact match if available.
        exact = [L for L in candidates if (L.get("strLeague") or "").strip().lower() == name_l]
        pick = exact[0] if exact else candidates[0]
        if not pick.get("idLeague"):
            raise NotFoundError("NOT_FOUND", f"Found league '{pick.get('strLeague')}' but missing idLeague")
        return str(pick.get("idLeague"))

    def _resolve_league_name(self, league_id: str, trace: list[Dict[str, Any]]) -> str:
        """Resolve leagueId -> canonical strLeague using lookupleague.php."""
        if not league_id:
            raise CollectorError("MISSING_ARG", "Provide leagueId")
        data = self._http("/lookupleague.php", {"id": league_id}, trace)
        league = (data.get("leagues") or [None])[0] or {}
        name = (league.get("strLeague") or "").strip()
        if not name:
            raise NotFoundError("NOT_FOUND", f"No league name found for id '{league_id}'")
        return name

    def _resolve_team_id(
        self,
        name: str,
        trace: list[Dict[str, Any]],
        *,
        leagueName: str | None = None,
        leagueId: str | None = None,
    ) -> str:
        """
        Resolve a team by name, optionally constrained by league.
        Strategy:
          1) /searchteams.php?t={name}
             - prefer exact strTeam match
             - if leagueName/leagueId provided, prefer candidates that match that league
          2) If still ambiguous and leagueName is given, query
             /search_all_teams.php?l={leagueName} and pick exact strTeam
        """
        if not name:
            raise CollectorError("MISSING_ARG", "Provide teamName or teamId")

        # Normalize leagueName if only leagueId provided
        if leagueId and not leagueName:
            try:
                leagueName = self._resolve_league_name(str(leagueId), trace)
            except Exception:
                leagueName = None

        # 1) search by team name
        data = self._http("/searchteams.php", {"t": name}, trace)
        candidates = data.get("teams") or []
        if not candidates:
            raise NotFoundError("NOT_FOUND", f"No team found for '{name}'")

        name_l = (name or "").strip().lower()
        exact_name = [t for t in candidates if (t.get("strTeam") or "").strip().lower() == name_l]

        # Apply league filter if available
        def match_league(t: dict) -> bool:
            if leagueName and (t.get("strLeague") or "").strip().lower() == leagueName.strip().lower():
                return True
            if leagueId and str(t.get("idLeague") or "").strip() == str(leagueId):
                return True
            return False

        filtered = [t for t in (exact_name or candidates) if (match_league(t) if (leagueName or leagueId) else True)]

        if len(filtered) == 1:
            return str(filtered[0].get("idTeam"))

        # 2) fallback: search within league roster by name
        if leagueName:
            try:
                data2 = self._http("/search_all_teams.php", {"l": leagueName, "s": "Soccer"}, trace)
            except Exception:
                data2 = self._http("/search_all_teams.php", {"l": leagueName}, trace)
            teams_in_league = data2.get("teams") or []
            league_exact = [t for t in teams_in_league if (t.get("strTeam") or "").strip().lower() == name_l]
            if len(league_exact) == 1:
                return str(league_exact[0].get("idTeam"))

        # If multiple remain, raise Ambiguous with choices
        if filtered:
            raise AmbiguousError("AMBIGUOUS", f"Multiple teams match '{name}'", {"choices": filtered})

        # Otherwise, pick the first exact-name candidate if exists, else first candidate
        pick = (exact_name[0] if exact_name else candidates[0])
        return str(pick.get("idTeam"))

    def _resolve_player_id(self, name: str, trace: list[Dict[str, Any]]) -> str:
        data = self._http("/searchplayers.php", {"p": name}, trace)
        players = data.get("player") or []
        if not players:
            raise NotFoundError("NOT_FOUND", f"No player found for '{name}'")
        exact, allc = self._first_exact_or_single(players, "strPlayer", name)
        pick = exact or (allc[0] if len(allc) == 1 else None)
        if not pick:
            raise AmbiguousError("AMBIGUOUS", f"Multiple players match '{name}'", {"choices": allc})
        return str(pick.get("idPlayer"))

    def _select_event_candidate(
        self,
        candidates: list[dict],
        *,
        eventId: str | None = None,
        dateEvent: str | None = None,
        season: str | None = None,
    ) -> tuple[dict | None, dict]:
        """Choose the most plausible event from a list based on optional constraints.
        Returns (picked_event_or_none, resolution_metadata).
        The resolution has keys: {"reason": str, "candidates": int, "matched": {..}}.
        """
        res = {"reason": "none", "candidates": len(candidates), "matched": {}}
        if not candidates:
            return None, res

        # 1) If an exact id is provided, prefer it
        if eventId:
            for ev in candidates:
                if str(ev.get("idEvent") or "").strip() == str(eventId):
                    res["reason"] = "id_match"
                    res["matched"] = {"idEvent": eventId}
                    return ev, res

        # 2) If date and/or season are provided, try to match both
        def fits(ev: dict) -> int:
            score = 0
            if dateEvent and (ev.get("dateEvent") == dateEvent or ev.get("dateEventLocal") == dateEvent):
                score += 1
            if season and (ev.get("strSeason") == season):
                score += 1
            return score

        if dateEvent or season:
            best = None
            best_score = -1
            for ev in candidates:
                sc = fits(ev)
                if sc > best_score:
                    best, best_score = ev, sc
            if best is not None and best_score > 0:
                res["reason"] = "date_season_match"
                res["matched"] = {k: v for k, v in {"dateEvent": dateEvent, "strSeason": season}.items() if v}
                return best, res

        # 3) Fallback: if only one candidate, take it
        if len(candidates) == 1:
            res["reason"] = "single_candidate"
            return candidates[0], res

        # 4) Otherwise, no deterministic choice
        res["reason"] = "ambiguous"
        return None, res

    # -----------------------
    # Capabilities (raw JSON)
    # -----------------------
    def _cap_leagues_list(self, args, trace):
        # Use /all_leagues.php then filter to Soccer; alternatively /search_all_leagues.php?s=Soccer
        leagues: List[Dict[str, Any]] = []
        try:
            data = self._http("/all_leagues.php", {}, trace)
            leagues = [L for L in (data.get("leagues") or []) if (L.get("strSport") or "").lower() == "soccer"]
        except Exception as e:
            trace.append({"step": "tsdb_leagues_error", "error": str(e)})
        name = args.get("name")
        country = args.get("country")
        if leagues:
            if name:
                leagues = [L for L in leagues if name.lower() in (L.get("strLeague") or "").lower()]
            if country:
                leagues = [L for L in leagues if (L.get("strCountry") or "").lower() == str(country).lower()]
        # Fallback to AllSports API if TheSportsDB provided no leagues
        if not leagues and allsports_client:
            try:
                resp = allsports_client.leagues()
                if isinstance(resp, dict) and resp.get("success") == 1:
                    leagues = [
                        {
                            "idLeague": str(L.get("league_key")),
                            "strLeague": L.get("league_name"),
                            "strCountry": L.get("country_name"),
                        }
                        for L in (resp.get("result") or [])
                    ]
                    if name:
                        leagues = [L for L in leagues if name.lower() in (L.get("strLeague") or "").lower()]
                    if country:
                        leagues = [L for L in leagues if (L.get("strCountry") or "").lower() == str(country).lower()]
                    trace.append({"step": "allsports_leagues", "count": len(leagues)})
            except Exception as e:
                trace.append({"step": "allsports_leagues_error", "error": str(e)})
        return {"leagues": leagues, "count": len(leagues)}, args

    def _cap_league_get(self, args, trace):
        league_id = args.get("leagueId") or self._resolve_league_id(args.get("leagueName"), trace)
        data = self._http("/lookupleague.php", {"id": league_id}, trace)
        return {"league": (data.get("leagues") or [None])[0]}, {"leagueId": league_id}

    def _cap_teams_list(self, args, trace):
        """List teams by teamName | leagueName/leagueId | country.
        IMPORTANT: Use name-based lookup via /search_all_teams.php because
        /lookup_all_teams.php can return incorrect/irrelevant teams for many IDs.
        """
        # 1) Direct team search by name
        if args.get("teamName"):
            teams: List[Dict[str, Any]] = []
            try:
                data = self._http("/searchteams.php", {"t": args["teamName"]}, trace)
                teams = data.get("teams") or []
            except Exception as e:
                trace.append({"step": "tsdb_team_search_error", "error": str(e)})
            if not teams and allsports_client:
                try:
                    resp = allsports_client.teams(teamName=args["teamName"])
                    if isinstance(resp, dict) and resp.get("success") == 1:
                        teams = [
                            {
                                "idTeam": str(t.get("team_key")),
                                "strTeam": t.get("team_name"),
                                "strTeamBadge": t.get("team_logo"),
                            }
                            for t in (resp.get("result") or [])
                        ]
                        trace.append({"step": "allsports_team_search", "count": len(teams)})
                except Exception as e:
                    trace.append({"step": "allsports_team_search_error", "error": str(e)})
            return {"teams": teams, "count": len(teams)}, {"teamName": args["teamName"]}

        # 2) Resolve a league name, then use search_all_teams.php?l={strLeague}&s=Soccer
        league_name = (args.get("leagueName") or "").strip()
        league_id = args.get("leagueId")
        if league_id and not league_name:
            # Convert id -> name first
            league_name = self._resolve_league_name(str(league_id), trace)
        if league_name:
            # Prefer name-based lookup. Some responses can occasionally be non-JSON (HTML splash).
            # Try with sport filter first; if it fails, retry without it.
            params_primary = {"l": league_name, "s": "Soccer"}
            teams: List[Dict[str, Any]] = []
            try:
                data = self._http("/search_all_teams.php", params_primary, trace)
                teams = data.get("teams") or []
            except Exception:
                try:
                    data = self._http("/search_all_teams.php", {"l": league_name}, trace)
                    teams = data.get("teams") or []
                except Exception as e:
                    trace.append({"step": "tsdb_league_team_error", "error": str(e)})

            # If the name-based search returned no teams but we have a league_id,
            # Regardless of name-based results, if a league_id is present attempt
            # lookup by id (lookup_all_teams.php) as an additional fallback/source.
            if league_id:
                trace.append({"step": "attempt_lookup_all_teams_by_id", "league_id": league_id})
                try:
                    raw = self.list_teams_in_league(str(league_id), league_name)
                    teams_from_lookup = [
                        {
                            "idTeam": t.id,
                            "strTeam": t.name,
                            "strAlternate": t.alt_name,
                            "strTeamBadge": t.badge,
                        }
                        for t in raw
                    ]
                    # prefer name-based teams if present, otherwise use lookup results
                    if not teams:
                        teams = teams_from_lookup
                    # record what we got
                    trace.append({"step": "lookup_all_teams_result", "count": len(teams_from_lookup)})
                except Exception as e:
                    # record failure but don't fail the whole intent
                    trace.append({"step": "lookup_all_teams_failed", "error": str(e)})
                    # leave teams as-is (could be empty or name-based results)
            # Fallback to AllSports if still empty
            if not teams and allsports_client:
                try:
                    resp = allsports_client.teams(leagueId=str(league_id) if league_id else None)
                    if isinstance(resp, dict) and resp.get("success") == 1:
                        teams = [
                            {
                                "idTeam": str(t.get("team_key")),
                                "strTeam": t.get("team_name"),
                                "strAlternate": t.get("team_name", None),
                                "strTeamBadge": t.get("team_logo"),
                            }
                            for t in (resp.get("result") or [])
                        ]
                        trace.append({"step": "allsports_league_teams", "count": len(teams)})
                except Exception as e:
                    trace.append({"step": "allsports_league_teams_error", "error": str(e)})

            return {"teams": teams, "count": len(teams)}, {"leagueName": league_name}

        # 3) Country search (still via search_all_teams)
        if args.get("country"):
            teams: List[Dict[str, Any]] = []
            try:
                data = self._http("/search_all_teams.php", {"c": args["country"], "s": "Soccer"}, trace)
                teams = data.get("teams") or []
            except Exception as e:
                trace.append({"step": "tsdb_country_team_error", "error": str(e)})
            if not teams and allsports_client:
                try:
                    resp = allsports_client.teams()
                    if isinstance(resp, dict) and resp.get("success") == 1:
                        raw = [t for t in (resp.get("result") or []) if (t.get("team_country") or "").lower() == str(args["country"]).lower()]
                        teams = [
                            {
                                "idTeam": str(t.get("team_key")),
                                "strTeam": t.get("team_name"),
                                "strTeamBadge": t.get("team_logo"),
                            }
                            for t in raw
                        ]
                        trace.append({"step": "allsports_country_teams", "count": len(teams)})
                except Exception as e:
                    trace.append({"step": "allsports_country_teams_error", "error": str(e)})
            return {"teams": teams, "count": len(teams)}, {"country": args["country"]}

        raise CollectorError("MISSING_ARG", "Need teamName | leagueId/leagueName | country")

    def _cap_team_get(self, args, trace):
        team_id = args.get("teamId")
        if not team_id and args.get("teamName"):
            team_id = self._resolve_team_id(
                args["teamName"],
                trace,
                leagueName=args.get("leagueName"),
                leagueId=(str(args.get("leagueId")) if args.get("leagueId") else None),
            )
        if not team_id:
            raise CollectorError("MISSING_ARG", "Need teamId or teamName")
        data = self._http("/lookupteam.php", {"id": team_id}, trace)
        resolved = {"teamId": str(team_id)}
        if args.get("teamName"):
            resolved["teamName"] = args["teamName"]
        if args.get("leagueName"):
            resolved["leagueName"] = args["leagueName"]
        if args.get("leagueId"):
            resolved["leagueId"] = str(args["leagueId"])
        return {"team": (data.get("teams") or [None])[0]}, resolved

    def _cap_players_list(self, args, trace):
        if args.get("playerName"):
            players: List[Dict[str, Any]] = []
            try:
                data = self._http("/searchplayers.php", {"p": args["playerName"]}, trace)
                players = data.get("player") or []
            except Exception as e:
                trace.append({"step": "tsdb_player_search_error", "error": str(e)})
            if not players and allsports_client:
                try:
                    resp = allsports_client.players(playerName=args["playerName"])
                    if isinstance(resp, dict) and resp.get("success") == 1:
                        players = [
                            {
                                "idPlayer": str(p.get("player_key")),
                                "strPlayer": p.get("player_name"),
                                "strTeam": p.get("team_name"),
                            }
                            for p in (resp.get("result") or [])
                        ]
                        trace.append({"step": "allsports_player_search", "count": len(players)})
                except Exception as e:
                    trace.append({"step": "allsports_player_search_error", "error": str(e)})
            return {"players": players, "count": len(players)}, {"playerName": args["playerName"]}
        team_id = args.get("teamId")
        if args.get("teamName") and not team_id:
            team_id = self._resolve_team_id(
                args["teamName"],
                trace,
                leagueName=args.get("leagueName"),
                leagueId=(str(args.get("leagueId")) if args.get("leagueId") else None),
            )
        if team_id:
            players: List[Dict[str, Any]] = []
            try:
                data = self._http("/lookup_all_players.php", {"id": team_id}, trace)
                players = data.get("player") or []
            except Exception as e:
                trace.append({"step": "tsdb_team_players_error", "error": str(e)})
            if not players and allsports_client:
                try:
                    resp = allsports_client.players(teamId=str(team_id))
                    if isinstance(resp, dict) and resp.get("success") == 1:
                        players = [
                            {
                                "idPlayer": str(p.get("player_key")),
                                "strPlayer": p.get("player_name"),
                            }
                            for p in (resp.get("result") or [])
                        ]
                        trace.append({"step": "allsports_team_players", "count": len(players)})
                except Exception as e:
                    trace.append({"step": "allsports_team_players_error", "error": str(e)})
            return {"players": players, "count": len(players)}, {"teamId": team_id}
        raise CollectorError("MISSING_ARG", "Need teamId/teamName or playerName")

    def _cap_player_get(self, args, trace):
        player_id = args.get("playerId") or self._resolve_player_id(args.get("playerName"), trace)
        data = self._http("/lookupplayer.php", {"id": player_id}, trace)
        return {"player": (data.get("players") or [None])[0]}, {"playerId": player_id}

    def _cap_events_list(self, args, trace):
        if args.get("date"):
            data = self._http("/eventsday.php", {"d": args["date"], "s": "Soccer"}, trace)
            return {"events": data.get("events") or []}, {"date": args["date"]}
        if args.get("eventName"):
            data = self._http("/searchevents.php", {"e": args["eventName"]}, trace)
            return {"events": data.get("event") or []}, {"eventName": args["eventName"]}
        league_id = args.get("leagueId")
        if args.get("leagueName") and not league_id:
            league_id = self._resolve_league_id(args["leagueName"], trace)
        if league_id:
            if args.get("season"):
                data = self._http("/eventsseason.php", {"id": league_id, "s": args["season"]}, trace)
                return {"events": data.get("events") or []}, {"leagueId": league_id, "season": args["season"]}
            if args.get("kind") == "next":
                data = self._http("/eventsnextleague.php", {"id": league_id}, trace)
                return {"events": data.get("events") or []}, {"leagueId": league_id, "kind": "next"}
            data = self._http("/eventspastleague.php", {"id": league_id}, trace)
            return {"events": data.get("events") or []}, {"leagueId": league_id, "kind": "past"}
        team_id = args.get("teamId")
        if args.get("teamName") and not team_id:
            team_id = self._resolve_team_id(args["teamName"], trace)
        if team_id:
            if args.get("kind") == "next":
                data = self._http("/eventsnext.php", {"id": team_id}, trace)
                return {"events": data.get("events") or []}, {"teamId": team_id, "kind": "next"}
            data = self._http("/eventslast.php", {"id": team_id}, trace)
            return {"events": data.get("results") or []}, {"teamId": team_id, "kind": "last"}
        raise CollectorError("MISSING_ARG", "Need date | leagueId/leagueName | teamId/teamName")

    def _cap_event_get(self, args, trace):
        """Fetch event details using **name-based** search, with optional ID filtering.
        Behaviors:
          • If only eventName is provided: search via /searchevents.php and return candidates. If exactly one, include detail (+expansions).
          • If eventName and eventId are provided: search by name, then **filter candidates by idEvent == eventId**. If that yields one, return it (+expansions). Always include the full candidate list as well.
          • If only eventId is provided: fall back to lookupevent.php for compatibility.
        Expand supports {"timeline","stats","lineup"} when a concrete id is selected.
        """
        expand = args.get("expand") or []
        event_name = (args.get("eventName") or "").strip()
        event_id = (args.get("eventId") or "").strip() or None

        def _attach_expansions(out: dict, chosen_id: str):
            if not chosen_id:
                return out
            if "timeline" in expand:
                tl = self._http("/lookuptimeline.php", {"id": chosen_id}, trace)
                out["timeline"] = tl.get("timeline") or []
            if "stats" in expand:
                st = self._http("/lookupeventstats.php", {"id": chosen_id}, trace)
                out["stats"] = st.get("eventstats") or []
            if "lineup" in expand:
                lu = self._http("/lookuplineup.php", {"id": chosen_id}, trace)
                out["lineup"] = lu.get("lineup") or []
            return out

        # --- NAME-FIRST PATH ---
        if event_name:
            data = self._http("/searchevents.php", {"e": event_name}, trace)
            candidates = data.get("event") or []

            picked = None
            resolution = {"by": "name", "candidates": len(candidates)}

            # If an ID is supplied as well, filter candidates by that ID
            if event_id:
                filtered = [ev for ev in candidates if str(ev.get("idEvent") or "").strip() == str(event_id)]
                if len(filtered) == 1:
                    picked = filtered[0]
                    resolution = {"by": "name_id_filter", "candidates": len(candidates), "matched_id": str(event_id)}
                else:
                    # keep candidates; no unique pick
                    resolution = {"by": "name_id_filter_ambiguous", "candidates": len(candidates), "matched_id": str(event_id)}
            else:
                # No ID filter: if there is exactly one candidate, pick it
                if len(candidates) == 1:
                    picked = candidates[0]
                    resolution = {"by": "name_unique", "candidates": 1}

            out: dict = {"candidates": candidates, "resolution": resolution}

            # If we selected one, RETURN THE PICKED CANDIDATE (no extra lookupevent.php)
            chosen_id = str(picked.get("idEvent")) if picked else None
            if chosen_id:
                out["event"] = picked  # keep original candidate to avoid incorrect fallback payloads
                _attach_expansions(out, chosen_id)

            resolved = {k: v for k, v in {
                "eventName": event_name,
                "eventId": (chosen_id or event_id),
                "expand": expand,
            }.items() if v}
            return out, resolved

        # --- ID-ONLY PATH DISABLED ---
        # We intentionally do not call /lookupevent.php here due to upstream inconsistencies
        # where the endpoint can return the wrong event payload. Require a name-based search.
        if not event_id:
            raise CollectorError("MISSING_ARG", "Need eventName or eventId")
        raise CollectorError(
            "UNSUPPORTED",
            "ID-only event lookups are disabled. Provide eventName (optionally with eventId/date/season) so we can resolve via searchevents.php and then expand by the chosen id."
        )

    def _cap_seasons_list(self, args, trace):
        league_id = args.get("leagueId") or self._resolve_league_id(args.get("leagueName"), trace)
        data = self._http("/search_all_seasons.php", {"id": league_id}, trace)
        return {"seasons": data.get("seasons") or []}, {"leagueId": league_id}

    def list_teams_in_league(self, league_id: str, league_name: str = None) -> List[Team]:
        """Return teams for a given league id by calling lookup_all_teams.php."""
        data = get_json("lookup_all_teams.php", {"id": league_id}) or {}
        raw = data.get("teams") or []
        self._sleep()
        return [self._norm_team(x) for x in raw]

    def _sleep(self):
        import time
        time.sleep(1)  # Polite pause to avoid rate limits

    def _norm_team(self, raw_team: dict) -> Team:
        return Team(
            id=raw_team.get("idTeam"),
            name=raw_team.get("strTeam"),
            alt_name=raw_team.get("strAlternate"),
            league=raw_team.get("strLeague"),
            country=raw_team.get("strCountry"),
            formed_year=int(raw_team.get("intFormedYear") or 0),
            stadium=raw_team.get("strStadium"),
            stadium_thumb=raw_team.get("strStadiumThumb"),
            website=raw_team.get("strWebsite"),
            badge=raw_team.get("strTeamBadge"),
            banner=raw_team.get("strTeamBanner"),
            jersey=raw_team.get("strTeamJersey"),
            description=raw_team.get("strDescriptionEN"),
        )