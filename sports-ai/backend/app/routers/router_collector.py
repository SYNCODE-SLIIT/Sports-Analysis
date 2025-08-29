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

    # ---- added utility (non-breaking) ----
    def get_live_and_finished(self, *, date: str | None = None) -> Dict[str, Any]:
        """Helper used by UI: returns a merged structure of live matches (AllSports primary)
        and finished matches (from AllSports livescore payload OR TSDB events.list fallback).

        We DO NOT change routing policy; we just orchestrate two existing intents under the hood.
        Args:
            date: optional ISO date (YYYY-MM-DD). If omitted uses today's UTC date.
        Returns shape:
            { ok, date, live: [...], finished: [...], meta: {source: {...}, trace: [...]}}
        """
        from datetime import datetime, timezone

        target_date = date or datetime.now(timezone.utc).strftime('%Y-%m-%d')
        trace: list[Dict[str, Any]] = []

        # 1. Live matches via router (events.live) -> AllSports primary
        live_req = {"intent": "events.live", "args": {}}
        live_resp = self.handle(live_req)
        trace.append({"step": "live_fetch", "ok": live_resp.get("ok")})
        live_list = []
        if live_resp.get("ok"):
            data = live_resp.get("data") or {}
            # AllSports livescore shape uses 'result'
            live_list = data.get("result") or data.get("events") or []

        # 2. Finished matches: we will call events.list for the date (TSDB primary)
        finished_req = {"intent": "events.list", "args": {"date": target_date}}
        finished_resp = self.handle(finished_req)
        trace.append({"step": "finished_fetch", "ok": finished_resp.get("ok"), "date": target_date})
        finished_list = []
        if finished_resp.get("ok"):
            fdata = finished_resp.get("data") or {}
            finished_list = (
                fdata.get("events") or  # TSDB shape
                fdata.get("result") or  # AllSports fallback shape
                fdata.get("results") or []
            )

        # Separate out any still-live matches from finished list if provider mixed them
        def is_live(m: Dict[str, Any]) -> bool:
            status = str(m.get('event_status') or m.get('status') or '').lower()
            live_flag = str(m.get('event_live') or m.get('live') or '') in ('1', 'true')
            # consider statuses that indicate in-progress
            return live_flag or any(k in status for k in ('live', '1st half', '2nd half', 'half time', 'ht', 'paused'))

        # Build final finished list excluding those recognized as live (avoid duplication)
        finished_pruned = [m for m in finished_list if not is_live(m)]

        # Order: live already on top (we keep order by start time ascending), finished ordered by date+time desc
        def parse_dt(m: Dict[str, Any]):
            d = m.get('event_date') or m.get('dateEvent') or ''
            t = m.get('event_time') or m.get('strTime') or ''
            return f"{d} {t}".strip()
        live_list.sort(key=parse_dt)
        finished_pruned.sort(key=parse_dt, reverse=True)

        return {
            "ok": True,
            "date": target_date,
            "live": live_list,
            "finished": finished_pruned,
            "counts": {"live": len(live_list), "finished": len(finished_pruned)},
            "meta": {"trace": trace},
        }

    # ---- history aggregation (added) ----
    def get_history(self, *, days: int = 7, to_date: str | None = None) -> Dict[str, Any]:
        """Aggregate matches for a range of dates (inclusive) ending at to_date (UTC today default).
        For each day calls events.list (router logic preserved) and groups by league.
        Returned structure groups matches by league, with per-date buckets ordered newest->oldest.
        Args:
            days: number of days (including final) to look back. Capped at 31 for safety.
            to_date: final ISO date (YYYY-MM-DD). If None uses today UTC.
        """
        from datetime import datetime, timedelta, timezone
        if days < 1:
            days = 1
        days = min(days, 31)  # safety cap
        end_dt = datetime.strptime(to_date, '%Y-%m-%d') if to_date else datetime.now(timezone.utc)
        # Normalize to date (strip time)
        end_date = end_dt.strftime('%Y-%m-%d')
        date_list = [(end_dt - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(days)]
        # Ensure uniqueness & order newest -> oldest
        date_list = list(dict.fromkeys(date_list))

        leagues: Dict[str, Dict[str, Any]] = {}
        overall_trace: list[Dict[str, Any]] = []

        for d in date_list:
            resp = self.handle({"intent": "events.list", "args": {"date": d}})
            overall_trace.append({"step": "history_fetch", "date": d, "ok": resp.get("ok")})
            if not resp.get("ok"):
                continue
            data = resp.get("data") or {}
            events = data.get("events") or data.get("result") or data.get("results") or []
            for ev in events:
                league_name = ev.get('league_name') or ev.get('strLeague') or 'Unknown League'
                league_key = str(ev.get('league_key') or ev.get('idLeague') or '')
                lid = league_key + '|' + league_name
                bucket = leagues.setdefault(lid, {
                    "league_name": league_name,
                    "league_key": league_key or None,
                    "country_name": ev.get('country_name') or ev.get('strCountry'),
                    "dates": {},  # temp mapping date -> list
                })
                bucket['dates'].setdefault(d, []).append(ev)

        # Transform date buckets to ordered list (newest->oldest) & compute totals
        league_list = []
        for lid, info in leagues.items():
            dates_map = info.pop('dates')
            ordered_dates = []
            for d in sorted(dates_map.keys(), reverse=True):
                # Sort matches within a date by time descending then home team
                def time_key(m):
                    return (m.get('event_time') or m.get('strTime') or '')
                day_matches = dates_map[d]
                day_matches.sort(key=time_key, reverse=True)
                ordered_dates.append({"date": d, "matches": day_matches, "count": len(day_matches)})
            total = sum(x['count'] for x in ordered_dates)
            league_list.append({**info, "dates": ordered_dates, "total_matches": total})

        # Order leagues by total matches desc
        league_list.sort(key=lambda x: x['total_matches'], reverse=True)

        return {
            "ok": True,
            "end_date": end_date,
            "days": days,
            "dates": date_list,
            "leagues": league_list,
            "league_count": len(league_list),
            "match_count": sum(l['total_matches'] for l in league_list),
            "meta": {"trace": overall_trace},
        }

    # ---- dual-provider history (TSDB + AllSports independent, merged) ----
    def get_history_dual(self, *, days: int = 7, to_date: str | None = None) -> Dict[str, Any]:
        """Fetch events from BOTH providers per date (without relying on fallback heuristics) and merge.
        This ensures we don't lose leagues when TSDB returns a partial (non-empty) day blocking fallback.
        """
        from datetime import datetime, timedelta, timezone
        if days < 1:
            days = 1
        days = min(days, 31)
        end_dt = datetime.strptime(to_date, '%Y-%m-%d') if to_date else datetime.now(timezone.utc)
        end_date = end_dt.strftime('%Y-%m-%d')
        date_list = [(end_dt - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(days)]
        date_list = list(dict.fromkeys(date_list))

        leagues: Dict[str, Dict[str, Any]] = {}
        trace: list[Dict[str, Any]] = []

        def extract_events(provider_resp: Dict[str, Any]) -> list[Dict[str, Any]]:
            if not provider_resp:
                return []
            data = provider_resp.get('data') or {}
            return (
                data.get('events') or
                data.get('result') or
                data.get('results') or []
            )

        for d in date_list:
            # Direct provider calls bypass router fallback to get raw sets
            tsdb_resp = self._call_tsdb('events.list', {'date': d})
            as_resp = self._call_allsports('events.list', {'date': d})
            trace.append({"step": "history_dual_fetch", "date": d, "tsdb_ok": tsdb_resp.get('ok'), "allsports_ok": as_resp.get('ok')})
            tsdb_events = extract_events(tsdb_resp)
            as_events = extract_events(as_resp)

            # Merge with preference to keep both; dedupe by composite key
            combined: Dict[str, Dict[str, Any]] = {}
            def add_events(ev_list: list[Dict[str, Any]], source: str):
                for ev in ev_list:
                    ek = str(ev.get('event_key') or ev.get('idEvent') or ev.get('id') or '')
                    if not ek:
                        # fallback synthetic key
                        ek = f"{source}:{ev.get('event_date')}-{ev.get('event_time')}-{ev.get('event_home_team')}-{ev.get('event_away_team')}"
                    if ek not in combined:
                        ev_copy = dict(ev)
                        ev_copy['_sources'] = [source]
                        combined[ek] = ev_copy
                    else:
                        combined[ek]['_sources'].append(source)
            add_events(tsdb_events, 'tsdb')
            add_events(as_events, 'allsports')

            for ev in combined.values():
                league_name = ev.get('league_name') or ev.get('strLeague') or 'Unknown League'
                league_key = str(ev.get('league_key') or ev.get('idLeague') or '')
                lid = league_key + '|' + league_name
                bucket = leagues.setdefault(lid, {
                    'league_name': league_name,
                    'league_key': league_key or None,
                    'country_name': ev.get('country_name') or ev.get('strCountry'),
                    'dates': {},
                })
                bucket['dates'].setdefault(d, []).append(ev)

        # Format output like single-provider version
        league_list = []
        for lid, info in leagues.items():
            dates_map = info.pop('dates')
            ordered_dates = []
            for d in sorted(dates_map.keys(), reverse=True):
                matches = dates_map[d]
                matches.sort(key=lambda m: (m.get('event_time') or m.get('strTime') or ''), reverse=True)
                ordered_dates.append({'date': d, 'matches': matches, 'count': len(matches)})
            total = sum(x['count'] for x in ordered_dates)
            league_list.append({**info, 'dates': ordered_dates, 'total_matches': total})

        league_list.sort(key=lambda x: x['total_matches'], reverse=True)

        return {
            'ok': True,
            'mode': 'dual',
            'end_date': end_date,
            'days': days,
            'dates': date_list,
            'leagues': league_list,
            'league_count': len(league_list),
            'match_count': sum(l['total_matches'] for l in league_list),
            'meta': {'trace': trace},
        }