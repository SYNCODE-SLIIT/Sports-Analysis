
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
            elif intent == "countries.list":
                data, resolved = self._cap_countries_list(args, trace)
            elif intent == "sports.list":
                data, resolved = self._cap_sports_list(args, trace)
            elif intent == "league.get":
                data, resolved = self._cap_league_get(args, trace)
            elif intent == "league.table":
                data, resolved = self._cap_league_table(args, trace)
            elif intent == "teams.list":
                data, resolved = self._cap_teams_list(args, trace)
            elif intent == "team.get":
                data, resolved = self._cap_team_get(args, trace)
            elif intent == "team.equipment":
                data, resolved = self._cap_team_equipment(args, trace)
            elif intent == "player.honours":
                data, resolved = self._cap_player_honours(args, trace)
            elif intent == "player.former_teams":
                data, resolved = self._cap_player_former_teams(args, trace)
            elif intent == "player.milestones":
                data, resolved = self._cap_player_milestones(args, trace)
            elif intent == "player.contracts":
                data, resolved = self._cap_player_contracts(args, trace)
            elif intent == "player.results":
                data, resolved = self._cap_player_results(args, trace)
            elif intent == "players.list":
                data, resolved = self._cap_players_list(args, trace)
            elif intent == "player.get":
                data, resolved = self._cap_player_get(args, trace)
            elif intent == "events.list":
                data, resolved = self._cap_events_list(args, trace)
            elif intent == "event.get":
                data, resolved = self._cap_event_get(args, trace)
            elif intent == "event.results":
                data, resolved = self._cap_event_results(args, trace)
            elif intent == "event.tv":
                data, resolved = self._cap_event_tv(args, trace)
            elif intent == "video.highlights":
                data, resolved = self._cap_video_highlights(args, trace)
            elif intent == "venue.get":
                data, resolved = self._cap_venue_get(args, trace)
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
        if "country" in args:
            trace.append({"step": "leagues_country_filter_ignored", "reason": "TSDB all_leagues lacks reliable per-league country"})
        if leagues:
            if name:
                leagues = [L for L in leagues if name.lower() in (L.get("strLeague") or "").lower()]
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
                    if "country" in args:
                        trace.append({"step": "leagues_country_filter_ignored", "reason": "TSDB all_leagues lacks reliable per-league country"})
                    trace.append({"step": "allsports_leagues", "count": len(leagues)})
            except Exception as e:
                trace.append({"step": "allsports_leagues_error", "error": str(e)})
        return {"leagues": leagues, "count": len(leagues)}, args

    def _cap_countries_list(self, args, trace):
        """Return the raw countries payload from TheSportsDB (no normalization).
        Endpoint: /all_countries.php
        Args are ignored; we simply proxy the response as-is.
        """
        data = self._http("/all_countries.php", {}, trace)
        # Keep raw shape; some responses use key 'countries'
        countries = data.get("countries") if isinstance(data, dict) else None
        # If the upstream ever returns a different top-level structure, just pass it through
        if countries is None:
            return {"raw": data}, args
        return {"countries": countries}, args

    def _cap_league_get(self, args, trace):
        league_id = args.get("leagueId") or self._resolve_league_id(args.get("leagueName"), trace)
        data = self._http("/lookupleague.php", {"id": league_id}, trace)
        return {"league": (data.get("leagues") or [None])[0]}, {"leagueId": league_id}

    def _cap_league_table(self, args, trace):
        """Return raw league standings for a given league + season.
        Endpoint: /lookuptable.php
        Accepts: leagueId | leagueName, and required `season` (e.g., "2014-2015").
        """
        league_id = args.get("leagueId") or self._resolve_league_id(args.get("leagueName"), trace)
        season = args.get("season")
        if not season:
            raise CollectorError("MISSING_ARG", "Provide season for league.table")
        data = self._http("/lookuptable.php", {"l": league_id, "s": season}, trace)
        return {"table": data.get("table") or []}, {"leagueId": str(league_id), "season": season}

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
            resolved_league_id: str | None = None
            try:
                data = self._http("/search_all_teams.php", params_primary, trace)
                teams = data.get("teams") or []
                trace.append({"step": "search_all_teams_name", "count": len(teams)})
            except Exception as e:
                trace.append({"step": "tsdb_league_team_error_primary", "error": str(e)})

            if not teams:
                try:
                    data = self._http("/search_all_teams.php", {"l": league_name}, trace)
                    teams = data.get("teams") or []
                    trace.append({"step": "search_all_teams_name_nosport", "count": len(teams)})
                except Exception as e:
                    trace.append({"step": "tsdb_league_team_error_secondary", "error": str(e)})

            # If name-based lookup produced nothing, derive leagueId from name and fall back to ID lookup
            if not teams:
                try:
                    resolved_league_id = self._resolve_league_id(league_name, trace)
                    trace.append({"step": "resolved_league_id_from_name", "league_id": resolved_league_id})
                    raw = self.list_teams_in_league(str(resolved_league_id), league_name)
                    teams_from_lookup = [
                        {
                            "idTeam": t.get("idTeam"),
                            "strTeam": t.get("strTeam"),
                            "strAlternate": t.get("strAlternate"),
                            "strTeamBadge": (t.get("strTeamBadge") or t.get("strBadge")),
                        }
                        for t in raw
                    ]
                    teams = teams_from_lookup
                    trace.append({"step": "lookup_all_teams_via_id_fallback", "count": len(teams_from_lookup)})
                except Exception as e:
                    trace.append({"step": "league_id_fallback_failed", "error": str(e)})

            # Fallback to AllSports if still empty
            if not teams and allsports_client:
                try:
                    resp = allsports_client.teams(leagueId=str(resolved_league_id) if resolved_league_id else None)
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

            resolved = {"leagueName": league_name}
            if league_id:
                resolved["leagueId"] = str(league_id)
            if resolved_league_id and not league_id:
                resolved["leagueId"] = str(resolved_league_id)
            return {"teams": teams, "count": len(teams)}, resolved

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
        """
        Team detail (RAW). Prefer lookup by id, but guard against upstream cache issues
        where /lookupteam.php may return the wrong team payload (e.g., always Arsenal).
        If the lookup result's id does not match the requested id, fall back to:
          1) searchteams.php?t={teamName} and pick the candidate with the requested id (or exact name)
          2) if league is known, fetch teams in league and select by id/name
        """
        requested_team_id = args.get("teamId")
        team_name = (args.get("teamName") or "").strip() or None

        # Resolve id from name if needed
        if not requested_team_id and team_name:
            requested_team_id = self._resolve_team_id(
                team_name,
                trace,
                leagueName=args.get("leagueName"),
                leagueId=(str(args.get("leagueId")) if args.get("leagueId") else None),
            )

        if not requested_team_id and not team_name:
            raise CollectorError("MISSING_ARG", "Need teamId or teamName")

        requested_team_id = str(requested_team_id) if requested_team_id is not None else None

        # --- Primary: lookup by id ---
        team_payload = None
        lookup_ok = False
        if requested_team_id:
            data = self._http("/lookupteam.php", {"id": requested_team_id}, trace)
            team_payload = (data.get("teams") or [None])[0]
            returned_id = str(team_payload.get("idTeam")) if team_payload else None
            if team_payload and requested_team_id and returned_id == requested_team_id:
                lookup_ok = True
            else:
                trace.append({
                    "step": "lookupteam_mismatch",
                    "requested_id": requested_team_id,
                    "returned_id": returned_id,
                    "note": "Falling back to name/league search due to upstream inconsistency"
                })

        # --- Fallback A: name search and pick matching id / exact name ---
        if not lookup_ok and team_name:
            try:
                s = self._http("/searchteams.php", {"t": team_name}, trace)
                cand = s.get("teams") or []
                # 1) prefer exact id match if we have an id
                if requested_team_id:
                    picks = [t for t in cand if str(t.get("idTeam") or "").strip() == requested_team_id]
                    if len(picks) == 1:
                        team_payload = picks[0]
                        lookup_ok = True
                # 2) else prefer exact name match
                if not lookup_ok:
                    name_l = team_name.lower()
                    exact = [t for t in cand if (t.get("strTeam") or "").strip().lower() == name_l]
                    if len(exact) == 1:
                        team_payload = exact[0]
                        lookup_ok = True
                    elif cand:
                        # last resort: first candidate
                        team_payload = cand[0]
                        lookup_ok = True
            except Exception as e:
                trace.append({"step": "team_name_fallback_error", "error": str(e)})

        # --- Fallback B: search within league roster when league known ---
        if not lookup_ok and (args.get("leagueName") or args.get("leagueId")):
            # normalize leagueName if only id provided
            league_name = (args.get("leagueName") or "").strip()
            league_id = args.get("leagueId")
            if league_id and not league_name:
                try:
                    league_name = self._resolve_league_name(str(league_id), trace)
                except Exception:
                    league_name = None
            # try name-based league listing, then id-based
            roster = []
            try:
                if league_name:
                    try:
                        d1 = self._http("/search_all_teams.php", {"l": league_name, "s": "Soccer"}, trace)
                    except Exception:
                        d1 = self._http("/search_all_teams.php", {"l": league_name}, trace)
                    roster = d1.get("teams") or []
                    trace.append({"step": "league_roster_name", "count": len(roster)})
                if not roster and league_id:
                    raw = self.list_teams_in_league(str(league_id), league_name, trace)
                    roster = raw or []
                    trace.append({"step": "league_roster_id", "count": len(roster)})
            except Exception as e:
                trace.append({"step": "league_roster_error", "error": str(e)})

            if roster:
                # Match by id first, then by exact name
                if requested_team_id:
                    by_id = [t for t in roster if str(t.get("idTeam") or "").strip() == requested_team_id]
                    if len(by_id) == 1:
                        team_payload = by_id[0]
                        lookup_ok = True
                if not lookup_ok and team_name:
                    name_l = team_name.lower()
                    by_name = [t for t in roster if (t.get("strTeam") or "").strip().lower() == name_l]
                    if len(by_name) == 1:
                        team_payload = by_name[0]
                        lookup_ok = True
                if not lookup_ok:
                    # take first as last resort
                    team_payload = roster[0]
                    lookup_ok = True

        # As a final guard, if nothing worked but we at least have something from the primary call, return it.
        if not lookup_ok and team_payload is None and requested_team_id:
            data = self._http("/lookupteam.php", {"id": requested_team_id}, trace)
            team_payload = (data.get("teams") or [None])[0]

        resolved = {}
        if requested_team_id:
            resolved["teamId"] = str(requested_team_id)
        if team_name:
            resolved["teamName"] = team_name
        if args.get("leagueName"):
            resolved["leagueName"] = args["leagueName"]
        if args.get("leagueId"):
            resolved["leagueId"] = str(args["leagueId"])

        return {"team": team_payload}, resolved

    def _cap_team_equipment(self, args, trace):

        team_id = args.get("teamId")
        if not team_id and args.get("teamName"):
            team_id = self._resolve_team_id(
                args["teamName"],
                trace,
                leagueName=args.get("leagueName"),
                leagueId=(str(args.get("leagueId")) if args.get("leagueId") else None),
            )
        if not team_id:
            raise CollectorError("MISSING_ARG", "Need teamId or teamName for team.equipment")

        data = self._http("/lookupequipment.php", {"id": team_id}, trace)
        equipment = data.get("equipment") or []

        resolved = {"teamId": str(team_id)}
        if args.get("teamName"):
            resolved["teamName"] = args["teamName"]
        if args.get("leagueName"):
            resolved["leagueName"] = args["leagueName"]
        if args.get("leagueId"):
            resolved["leagueId"] = str(args["leagueId"])

        return {"equipment": equipment, "count": len(equipment)}, resolved

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

    def list_teams_in_league(
        self,
        league_id: str,
        league_name: str | None = None,
        trace: List[Dict[str, Any]] | None = None,
    ) -> List[Dict[str, Any]]:
        """Return RAW teams for a given league id via /lookup_all_teams.php (no normalization).
        Uses _http so calls are cache-busted and traced.
        """
        t = trace if trace is not None else []
        data = self._http("/lookup_all_teams.php", {"id": league_id}, t) or {}
        raw = data.get("teams") or []
        self._sleep()
        return raw

    def _sleep(self):
        import time
        time.sleep(1)  # Polite pause to avoid rate limits

    def _cap_sports_list(self, args, trace):
        """Proxy /all_sports.php (raw)."""
        data = self._http("/all_sports.php", {}, trace)
        sports = data.get("sports") if isinstance(data, dict) else None
        if sports is None:
            return {"raw": data}, args
        return {"sports": sports, "count": len(sports)}, args

    def _cap_player_honours(self, args, trace):
        pid = args.get("playerId") or self._resolve_player_id(args.get("playerName"), trace)
        data = self._http("/lookuphonours.php", {"id": pid}, trace)
        return {"honours": data.get("honours") or [], "count": len(data.get("honours") or [])}, {"playerId": str(pid)}

    def _cap_player_former_teams(self, args, trace):
        pid = args.get("playerId") or self._resolve_player_id(args.get("playerName"), trace)
        data = self._http("/lookupformerteams.php", {"id": pid}, trace)
        return {"formerteams": data.get("formerteams") or [], "count": len(data.get("formerteams") or [])}, {"playerId": str(pid)}

    def _cap_player_milestones(self, args, trace):
        pid = args.get("playerId") or self._resolve_player_id(args.get("playerName"), trace)
        data = self._http("/lookupmilestones.php", {"id": pid}, trace)
        return {"milestones": data.get("milestones") or [], "count": len(data.get("milestones") or [])}, {"playerId": str(pid)}

    def _cap_player_contracts(self, args, trace):
        pid = args.get("playerId") or self._resolve_player_id(args.get("playerName"), trace)
        data = self._http("/lookupcontracts.php", {"id": pid}, trace)
        return {"contracts": data.get("contracts") or [], "count": len(data.get("contracts") or [])}, {"playerId": str(pid)}

    def _cap_player_results(self, args, trace):
        pid = args.get("playerId") or self._resolve_player_id(args.get("playerName"), trace)
        data = self._http("/playerresults.php", {"id": pid}, trace)
        return {"results": data.get("results") or [], "count": len(data.get("results") or [])}, {"playerId": str(pid)}

    def _cap_event_results(self, args, trace):
        """Return past events for a league or a team (raw)."""
        league_id = args.get("leagueId")
        team_id = args.get("teamId")

        if args.get("leagueName") and not league_id:
            league_id = self._resolve_league_id(args.get("leagueName"), trace)
        if args.get("teamName") and not team_id:
            team_id = self._resolve_team_id(args.get("teamName"), trace)

        if league_id:
            data = self._http("/eventspastleague.php", {"id": league_id}, trace)
            return {"events": data.get("events") or []}, {"leagueId": str(league_id)}
        if team_id:
            data = self._http("/eventslast.php", {"id": team_id}, trace)
            return {"events": data.get("results") or []}, {"teamId": str(team_id)}

        raise CollectorError("MISSING_ARG", "Need leagueId/leagueName or teamId/teamName for event.results")

    def _cap_event_tv(self, args, trace):

        event_name = (args.get("eventName") or "").strip()
        event_id = (args.get("eventId") or "").strip() or None

        chosen_id = None
        candidates = []

        if event_name:
            data = self._http("/searchevents.php", {"e": event_name}, trace)
            candidates = data.get("event") or []
            if event_id:
                filt = [ev for ev in candidates if str(ev.get("idEvent") or "").strip() == str(event_id)]
                if len(filt) == 1:
                    chosen_id = str(filt[0].get("idEvent"))
                # if ambiguous, leave chosen_id None and just return candidates
            elif len(candidates) == 1:
                chosen_id = str(candidates[0].get("idEvent"))
        else:
            chosen_id = event_id  # fallback support

        out = {"candidates": candidates}
        if chosen_id:
            tv = self._http("/lookuptv.php", {"id": chosen_id}, trace)
            out["tv"] = tv.get("tvchannels") or tv.get("tv") or []

        resolved = {}
        if event_name:
            resolved["eventName"] = event_name
        if event_id or chosen_id:
            resolved["eventId"] = chosen_id or event_id
        return out, resolved

    def _cap_video_highlights(self, args, trace):
        """Search YouTube/highlights metadata for an event by name, optional eventId filter.
        Endpoint: /searcheventsvideos.php?e={name}
        """
        event_name = (args.get("eventName") or "").strip()
        event_id = (args.get("eventId") or "").strip() or None
        if not event_name:
            raise CollectorError("MISSING_ARG", "Provide eventName for video.highlights")

        data = self._http("/searcheventsvideos.php", {"e": event_name}, trace)
        videos = data.get("event") or []
        if event_id:
            videos = [v for v in videos if str(v.get("idEvent") or "").strip() == str(event_id)]
        return {"videos": videos, "count": len(videos)}, {"eventName": event_name, **({"eventId": event_id} if event_id else {})}

    def _cap_venue_get(self, args, trace):
        """Return venue details by venueId, or resolve from an event name (+optional eventId)."""
        venue_id = args.get("venueId")
        if venue_id:
            data = self._http("/lookupvenue.php", {"id": venue_id}, trace)
            return {"venue": (data.get("venues") or [None])[0]}, {"venueId": str(venue_id)}

        event_name = (args.get("eventName") or "").strip()
        event_id = (args.get("eventId") or "").strip() or None
        if not event_name:
            raise CollectorError("MISSING_ARG", "Provide venueId or eventName (+optional eventId) for venue.get")

        data = self._http("/searchevents.php", {"e": event_name}, trace)
        candidates = data.get("event") or []
        picked, _res = self._select_event_candidate(candidates, eventId=event_id)
        if not picked:
            raise AmbiguousError("AMBIGUOUS", f"Multiple or zero events for '{event_name}'", {"candidates": candidates[:10]})
        v_id = picked.get("idVenue")
        if not v_id:
            return {"venue": None}, {"eventName": event_name, **({"eventId": event_id} if event_id else {})}
        v = self._http("/lookupvenue.php", {"id": v_id}, trace)
        return {"venue": (v.get("venues") or [None])[0]}, {"venueId": str(v_id), "eventName": event_name}