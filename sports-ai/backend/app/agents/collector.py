from typing import Any, Dict, Tuple
from ..utils.http_client import get_json   # go up one level, then into utils
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

    def _resolve_team_id(self, name: str, trace: list[Dict[str, Any]]) -> str:
        data = self._http("/searchteams.php", {"t": name}, trace)
        teams = data.get("teams") or []
        if not teams:
            raise NotFoundError("NOT_FOUND", f"No team found for '{name}'")
        exact, allc = self._first_exact_or_single(teams, "strTeam", name)
        pick = exact or (allc[0] if len(allc) == 1 else None)
        if not pick:
            raise AmbiguousError("AMBIGUOUS", f"Multiple teams match '{name}'", {"choices": allc})
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

    # -----------------------
    # Capabilities (raw JSON)
    # -----------------------
    def _cap_leagues_list(self, args, trace):
        # Use /all_leagues.php then filter to Soccer; alternatively /search_all_leagues.php?s=Soccer
        data = self._http("/all_leagues.php", {}, trace)
        leagues = [L for L in (data.get("leagues") or []) if (L.get("strSport") or "").lower() == "soccer"]
        name = args.get("name")
        country = args.get("country")
        if name:
            leagues = [L for L in leagues if name.lower() in (L.get("strLeague") or "").lower()]
        if country:
            leagues = [L for L in leagues if (L.get("strCountry") or "").lower() == str(country).lower()]
        return {"leagues": leagues}, args

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
            data = self._http("/searchteams.php", {"t": args["teamName"]}, trace)
            return {"teams": data.get("teams") or []}, {"teamName": args["teamName"]}

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
            try:
                data = self._http("/search_all_teams.php", params_primary, trace)
            except Exception:
                data = self._http("/search_all_teams.php", {"l": league_name}, trace)
            teams = data.get("teams") or []
            return {"teams": teams}, {"leagueName": league_name}

        # 3) Country search (still via search_all_teams)
        if args.get("country"):
            data = self._http("/search_all_teams.php", {"c": args["country"], "s": "Soccer"}, trace)
            return {"teams": data.get("teams") or []}, {"country": args["country"]}

        raise CollectorError("MISSING_ARG", "Need teamName | leagueId/leagueName | country")

    def _cap_team_get(self, args, trace):
        team_id = args.get("teamId") or self._resolve_team_id(args.get("teamName"), trace)
        data = self._http("/lookupteam.php", {"id": team_id}, trace)
        return {"team": (data.get("teams") or [None])[0]}, {"teamId": team_id}

    def _cap_players_list(self, args, trace):
        if args.get("playerName"):
            data = self._http("/searchplayers.php", {"p": args["playerName"]}, trace)
            return {"players": data.get("player") or []}, {"playerName": args["playerName"]}
        team_id = args.get("teamId")
        if args.get("teamName") and not team_id:
            team_id = self._resolve_team_id(args["teamName"], trace)
        if team_id:
            data = self._http("/lookup_all_players.php", {"id": team_id}, trace)
            return {"players": data.get("player") or []}, {"teamId": team_id}
        raise CollectorError("MISSING_ARG", "Need teamId/teamName or playerName")

    def _cap_player_get(self, args, trace):
        player_id = args.get("playerId") or self._resolve_player_id(args.get("playerName"), trace)
        data = self._http("/lookupplayer.php", {"id": player_id}, trace)
        return {"player": (data.get("players") or [None])[0]}, {"playerId": player_id}

    def _cap_events_list(self, args, trace):
        if args.get("date"):
            data = self._http("/eventsday.php", {"d": args["date"], "s": "Soccer"}, trace)
            return {"events": data.get("events") or []}, {"date": args["date"]}
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
        if not args.get("eventId"):
            raise CollectorError("MISSING_ARG", "Need eventId")
        event_id = args["eventId"]
        detail = self._http("/lookupevent.php", {"id": event_id}, trace)
        ev = (detail.get("events") or [None])[0] or {}
        out = {"event": ev}
        expand = args.get("expand") or []
        if "timeline" in expand:
            tl = self._http("/lookuptimeline.php", {"id": event_id}, trace)
            out["timeline"] = tl.get("timeline") or []
        if "stats" in expand:
            st = self._http("/lookupeventstats.php", {"id": event_id}, trace)
            out["stats"] = st.get("eventstats") or []
        if "lineup" in expand:
            lu = self._http("/lookuplineup.php", {"id": event_id}, trace)
            out["lineup"] = lu.get("lineup") or []
        return out, {"eventId": event_id, "expand": expand}

    def _cap_seasons_list(self, args, trace):
        league_id = args.get("leagueId") or self._resolve_league_id(args.get("leagueName"), trace)
        data = self._http("/search_all_seasons.php", {"id": league_id}, trace)
        return {"seasons": data.get("seasons") or []}, {"leagueId": league_id}