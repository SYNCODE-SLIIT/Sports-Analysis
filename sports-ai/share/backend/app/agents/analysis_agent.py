# backend/app/agents/analysis_agent.py
# -*- coding: utf-8 -*-

"""
Analysis Agent (AllSports-only)
--------------
Match-level insights built solely on AllSports raw endpoints.

Intents:
  - analysis.winprob        (eventId)
  - analysis.form           (eventId, lookback=5)
  - analysis.h2h            (eventId, lookback=10)
  - analysis.match_insights (eventId)

Data source:
  - self.sports: AllSportsRawAgent (from game_analytics_agent.py)

Response envelope matches existing agents:
  {
    "ok": bool,
    "intent": str,
    "args_resolved": dict,
    "data": any | None,
    "error": str | None,
    "meta": {"source": {"primary": "analysis", "fallback": "<src>"}, "trace": [...]}
  }
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta, timezone
import math
# ---------------------------- helpers: envelope/trace ----------------------------

def mkresp(ok: bool, intent: str, args: Dict[str, Any], data: Any = None,
           error: Optional[str] = None, trace: Optional[List[Any]] = None,
           primary: str = "analysis", fallback: Optional[str] = None) -> Dict[str, Any]:
    return {
        "ok": ok,
        "intent": intent,
        "args_resolved": args or {},
        "data": data if ok else None,
        "error": None if ok else (error or "Unknown error"),
        "meta": {"source": {"primary": primary, "fallback": fallback}, "trace": trace or []},
    }

def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ---------------------------- id normalization & picking ----------------------------
_EVENT_ID_KEYS = ("eventId", "event_id", "matchId", "fixture_id", "event_key", "idEvent", "idAPIfootball", "id")

def _normalize_event_id(args: Dict[str, Any]) -> str:
    for k in _EVENT_ID_KEYS:
        v = (args or {}).get(k)
        if v is not None and str(v).strip() != "":
            return str(v)
    raise ValueError("Missing required arg: eventId (any of: " + ", ".join(_EVENT_ID_KEYS) + ")")

def _pick_event_row_from_data(data: Any, eid: str) -> Optional[Dict[str, Any]]:
    """
    Given provider 'data' payload, return the row whose id matches eid against common keys.
    """
    rows: List[Dict[str, Any]] = []
    if isinstance(data, dict):
        for key in ("result", "results", "events", "fixtures"):
            if isinstance(data.get(key), list):
                rows = data[key]
                break
        if not rows and data:
            # some providers return a single object
            rows = [data]
    elif isinstance(data, list):
        rows = data

    keys = ("match_id","event_id","event_key","fixture_id","idEvent","id","idAPIfootball")
    for r in rows:
        try:
            if any(str(r.get(k)) == str(eid) for k in keys):
                return r
        except Exception:
            continue

    # fallback: if exactly one row, assume it's the one
    if len(rows) == 1:
        return rows[0]
    return None

# ---------------------------- data shapes ----------------------------

@dataclass
class EventInfo:
    event_id: str
    league_id: Optional[str]
    home_team_id: str
    away_team_id: str
    home_team_name: Optional[str] = None
    away_team_name: Optional[str] = None
    scheduled_utc: Optional[str] = None
    status: Optional[str] = None
    odds_decimal: Optional[Dict[str, float]] = None  # keys: "home","draw","away"

# ---------------------------- AnalysisAgent ----------------------------

class AnalysisAgent:
    SUPPORTED = {
        "analysis.winprob",
        "analysis.form",
        "analysis.h2h",
        "analysis.match_insights",
    }

    def __init__(self, tsdb_agent=None, all_sports_agent=None, logger=None):
        # NOTE: tsdb_agent is ignored (kept only for backward compatibility).
        self.sports = all_sports_agent
        self.log = logger

    # --------------- public entry ---------------

    def handle(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synchronous handler to match existing agents.
        """
        try:
            if intent not in self.SUPPORTED:
                return mkresp(False, intent, args, error=f"Unsupported intent: {intent}")

            try:
                event_id = _normalize_event_id(args)
            except ValueError as _e:
                return mkresp(False, intent, args, error=str(_e))

            # fetch canonical event + team info up front for all intents
            trace: List[Any] = []
            ev, src, ev_trace = self._resolve_event(event_id)
            trace.extend(ev_trace)
            if not ev:
                return mkresp(False, intent, {"eventId": event_id}, error=f"Event {event_id} not found", trace=trace)

            if intent == "analysis.winprob":
                data, calc_trace = self._intent_winprob(ev)
                trace.extend(calc_trace)
                return mkresp(True, intent, {"eventId": ev.event_id}, data=data, trace=trace, fallback=src)

            if intent == "analysis.form":
                lookback = int(args.get("lookback") or 5)
                data, calc_trace = self._intent_form(ev, lookback=lookback)
                trace.extend(calc_trace)
                return mkresp(True, intent, {"eventId": ev.event_id, "lookback": lookback}, data=data, trace=trace, fallback=src)

            if intent == "analysis.h2h":
                lookback = int(args.get("lookback") or 10)
                data, calc_trace = self._intent_h2h(ev, lookback=lookback)
                trace.extend(calc_trace)
                return mkresp(True, intent, {"eventId": ev.event_id, "lookback": lookback}, data=data, trace=trace, fallback=src)

            if intent == "analysis.match_insights":
                form_data, t1 = self._intent_form(ev, lookback=5)
                h2h_data, t2 = self._intent_h2h(ev, lookback=10)
                wp_data, t3 = self._intent_winprob(ev)
                trace.extend(t1 + t2 + t3)
                return mkresp(
                    True, intent, {"eventId": ev.event_id},
                    data={"winprob": wp_data, "form": form_data, "h2h": h2h_data,
                          "generated_at": _now_utc_iso()},
                    trace=trace, fallback=src
                )

            return mkresp(False, intent, args, error=f"Unhandled intent: {intent}")

        except Exception as e:
            if self.log:
                try: self.log.exception("analysis.handle failed")
                except Exception: pass
            return mkresp(False, intent, args, error=f"{type(e).__name__}: {e}")

    # --------------- data resolution ---------------

    def _resolve_event(self, event_id: str) -> Tuple[Optional[EventInfo], Optional[str], List[Any]]:
        """
        Resolve event using AllSports only.
        Map provider-specific shapes to EventInfo.
        """
        trace: List[Any] = []

        # AllSportsRawAgent: event.get (met=Fixtures with eventId/matchId)
        if self.sports:
            try:
                r = self.sports.handle({"intent": "event.get", "args": {"eventId": event_id, "matchId": event_id}})
                trace.append({"step": "sports.event.get", "ok": r.get("ok"), "raw_meta": r.get("meta")})
                ev = self._extract_event_from_provider(r, expected_id=event_id)
                if ev:
                    return ev, "allsports", trace
            except Exception as e:
                trace.append({"step": "sports.event.get", "error": str(e)})

        return None, None, trace

    # Provider shape → EventInfo
    def _extract_event_from_provider(self, resp: Dict[str, Any], expected_id: Optional[str] = None) -> Optional[EventInfo]:
        if not resp or not resp.get("ok"):
            return None
        data = resp.get("data") or {}
        obj = _pick_event_row_from_data(data, expected_id) if expected_id else None

        if not obj:
            # Fallback to previous heuristics if expected_id not given or not found
            if isinstance(data, dict) and "result" in data and isinstance(data["result"], list) and data["result"]:
                obj = data["result"][0]
            elif isinstance(data, list) and data:
                obj = data[0]
            elif isinstance(data, dict) and data:
                obj = data

        if not obj:
            return None

        # Heuristic field names across providers (now includes event_key)
        eid = str(obj.get("match_id") or obj.get("event_id") or obj.get("event_key") or obj.get("id") or "").strip()
        if not eid:
            return None

        home_id = str(obj.get("home_team_key") or obj.get("homeTeamId") or obj.get("home_id") or obj.get("home_team_id") or "").strip()
        away_id = str(obj.get("away_team_key") or obj.get("awayTeamId") or obj.get("away_id") or obj.get("away_team_id") or "").strip()

        home_name = obj.get("event_home_team") or obj.get("homeTeam") or obj.get("home_team") or None
        away_name = obj.get("event_away_team") or obj.get("awayTeam") or obj.get("away_team") or None

        league_id = str(obj.get("league_key") or obj.get("league_id") or obj.get("leagueId") or "") or None
        # Try to combine date+time when available to a UTC-ish ISO string if provider only gives local date/time.
        start_date = obj.get("event_date") or obj.get("match_date") or obj.get("scheduled") or None
        start_time = obj.get("event_time") or obj.get("match_time") or None
        if start_date and start_time and isinstance(start_date, str) and isinstance(start_time, str):
            scheduled_utc = f"{start_date}T{start_time}:00"
        else:
            scheduled_utc = start_date

        status = obj.get("event_status") or obj.get("status") or None

        odds = self._extract_odds(obj)

        if not home_id or not away_id:
            return None

        return EventInfo(
            event_id=eid, league_id=league_id,
            home_team_id=home_id, away_team_id=away_id,
            home_team_name=home_name, away_team_name=away_name,
            scheduled_utc=scheduled_utc, status=status, odds_decimal=odds
        )


    def _extract_odds(self, obj: Dict[str, Any]) -> Optional[Dict[str, float]]:
        """
        Try to read decimal odds for 1X2 from common keys.
        Returns normalized dict or None.
        """
        # Direct decimal odds in object
        for k in ("odds", "markets", "bookmakers", "odds_1x2"):
            if k in obj and obj[k]:
                raw = obj[k]
                # various shapes: {"home":2.1,"draw":3.2,"away":3.5} OR list of markets
                if isinstance(raw, dict) and {"home","away"}.issubset(set(raw.keys())):
                    h = _safe_float(raw.get("home"))
                    d = _safe_float(raw.get("draw"))
                    a = _safe_float(raw.get("away"))
                    if valid_odds_triplet(h,d,a):
                        return {"home": h, "draw": d, "away": a}
                if isinstance(raw, list):
                    # find 1X2 market
                    for m in raw:
                        name = (m.get("name") or m.get("key") or "").lower()
                        if "1x2" in name or "match winner" in name or name in ("home/draw/away","result"):
                            o = m.get("outcomes") or m.get("odds") or {}
                            if isinstance(o, dict):
                                h = _safe_float(o.get("home") or o.get("1"))
                                d = _safe_float(o.get("draw") or o.get("X"))
                                a = _safe_float(o.get("away") or o.get("2"))
                                if valid_odds_triplet(h,d,a):
                                    return {"home": h, "draw": d, "away": a}
        # Some feeds flatten as event_odd_home, event_odd_draw, event_odd_away
        h = _safe_float(obj.get("event_odd_home"))
        d = _safe_float(obj.get("event_odd_draw"))
        a = _safe_float(obj.get("event_odd_away"))
        if valid_odds_triplet(h,d,a):
            return {"home": h, "draw": d, "away": a}
        return None

    # --------------- intent: win probability ---------------

    def _intent_winprob(self, ev: EventInfo) -> Tuple[Dict[str, Any], List[Any]]:
        trace: List[Any] = []
        if ev.odds_decimal:
            probs = implied_probs_from_decimal_odds(ev.odds_decimal)
            trace.append({"step": "odds->probs", "odds": ev.odds_decimal, "probs": probs})
            return {
                "eventId": ev.event_id,
                "method": "odds_implied",
                "probs": probs,
                "inputs": {"odds_decimal": ev.odds_decimal},
            }, trace

        # Fallback: form-based logistic from recent matches
        form, t = self._intent_form(ev, lookback=5)
        trace.extend(t)
        home = form["home_metrics"]
        away = form["away_metrics"]

        # Simple rating using points per game & goal diff per game
        home_rating = (home["ppg"] * 1.0) + (home["gd_per_game"] * 0.35) + (home["streak_bonus"])
        away_rating = (away["ppg"] * 1.0) + (away["gd_per_game"] * 0.35) + (away["streak_bonus"])

        # home-field tweak (light if neutral or unknown)
        hfa = 0.20
        rating_diff = (home_rating + hfa) - away_rating

        # map diff → probabilities (3-way) using softmax with draw prior
        # baseline draw prior for football ~0.27; blend by closeness
        p_home = 1 / (1 + math.exp(-rating_diff))
        p_away = 1 - p_home
        closeness = 1 - abs(0.5 - p_home) * 2  # 0..1
        p_draw = 0.22 + 0.2 * closeness        # 0.22..0.42
        # renormalize
        s = p_home + p_draw + p_away
        probs = {"home": p_home / s, "draw": p_draw / s, "away": p_away / s}
        trace.append({"step": "form->probs", "rating_diff": rating_diff, "probs": probs})

        return {
            "eventId": ev.event_id,
            "method": "form_logistic",
            "probs": probs,
            "inputs": {"home_metrics": home, "away_metrics": away},
        }, trace

    # --------------- intent: recent form ---------------

    def _intent_form(self, ev: EventInfo, lookback: int = 5) -> Tuple[Dict[str, Any], List[Any]]:
        trace: List[Any] = []
        # Fetch recent finished matches for both teams (provider-first strategy)
        h_matches, t1 = self._recent_matches(ev.home_team_id, lookback)
        a_matches, t2 = self._recent_matches(ev.away_team_id, lookback)
        trace.extend(t1 + t2)

        h_metrics = form_metrics_from_matches(h_matches, ev.home_team_id)
        a_metrics = form_metrics_from_matches(a_matches, ev.away_team_id)

        # Build short summary strings
        def _summary(m):
            parts = []
            if m["unbeaten"] >= 3:
                parts.append(f"unbeaten in {m['unbeaten']}")
            if m["win_streak"] >= 2:
                parts.append(f"{m['win_streak']}-win streak")
            if not parts:
                parts.append(f"{m['wins']}-{m['draws']}-{m['losses']} last {m['games']}")
            return ", ".join(parts)

        data = {
            "eventId": ev.event_id,
            "home_team": {"id": ev.home_team_id, "name": ev.home_team_name, "summary": _summary(h_metrics)},
            "away_team": {"id": ev.away_team_id, "name": ev.away_team_name, "summary": _summary(a_metrics)},
            "home_metrics": h_metrics,
            "away_metrics": a_metrics,
        }
        return data, trace

    # --------------- intent: head-to-head ---------------

    def _intent_h2h(self, ev: EventInfo, lookback: int = 10) -> Tuple[Dict[str, Any], List[Any]]:
        trace: List[Any] = []
        matches, t = self._h2h_matches(ev.home_team_id, ev.away_team_id, lookback)
        trace.extend(t)

        w_h = w_a = d = 0
        goals_h = goals_a = 0
        for m in matches:
            s = _scoreline(m)
            if s is None:
                continue
            h, a = s
            # determine which side is homeTeam in the record
            mh = str(m.get("homeTeamId") or m.get("home_team_key") or m.get("home_id") or "")
            ma = str(m.get("awayTeamId") or m.get("away_team_key") or m.get("away_id") or "")
            if mh == ev.home_team_id and ma == ev.away_team_id:
                # aligned
                goals_h += h; goals_a += a
                if h > a: w_h += 1
                elif a > h: w_a += 1
                else: d += 1
            else:
                # If inverted, flip goals
                goals_h += a; goals_a += h
                if a > h: w_h += 1
                elif h > a: w_a += 1
                else: d += 1

        data = {
            "eventId": ev.event_id,
            "sample_size": len(matches),
            "record": {"homeWins": w_h, "draws": d, "awayWins": w_a},
            "goals": {"home": goals_h, "away": goals_a},
        }
        return data, trace

    # --------------- upstream fetches ---------------

    def _recent_matches(self, team_id: str, lookback: int) -> Tuple[List[Dict[str, Any]], List[Any]]:
        trace: List[Any] = []
        # Prefer provider (AllSports)
        if self.sports:
            try:
                # Build a generous date window to ensure we capture enough finished matches.
                # Use ~90 days back or 14 * lookback days, whichever is larger.
                days_back = max(90, lookback * 14)
                end_dt = datetime.now(timezone.utc)
                start_dt = end_dt - timedelta(days=days_back)
                args = {
                    "teamId": team_id,
                    "from": start_dt.strftime("%Y-%m-%d"),
                    "to": end_dt.strftime("%Y-%m-%d"),
                }
                r = self.sports.handle({"intent": "fixtures.list", "args": args})
                trace.append({"step": "sports.fixtures.list", "ok": r.get("ok"), "args": args})
                if r.get("ok"):
                    data = r.get("data") or {}
                    arr = data.get("result") if isinstance(data, dict) else data
                    matches = arr if isinstance(arr, list) else []

                    # Filter to finished matches only and sort by date/time ascending
                    def is_finished(m: Dict[str, Any]) -> bool:
                        status = str(m.get("event_status") or m.get("status") or "").lower()
                        if status in ("finished", "match finished", "ft", "full time"):
                            return True
                        # Some feeds use minute markers like "90" or "90+"
                        if status.startswith("90"):
                            return True
                        # Final result string present (e.g., "2 - 1")
                        fr = m.get("event_final_result") or m.get("final_score") or m.get("score")
                        return isinstance(fr, str) and "-" in fr

                    def dt_key(m: Dict[str, Any]) -> str:
                        d = str(m.get("event_date") or m.get("match_date") or m.get("date") or "")
                        t = str(m.get("event_time") or m.get("match_time") or m.get("time") or "")
                        return f"{d} {t}".strip()

                    finished = [m for m in matches if is_finished(m)]
                    finished.sort(key=dt_key)  # oldest -> newest
                    return finished[-lookback:], trace
            except Exception as e:
                trace.append({"step": "sports.fixtures.list", "error": str(e)})

        return [], trace

    def _h2h_matches(self, team_a: str, team_b: str, lookback: int) -> Tuple[List[Dict[str, Any]], List[Any]]:
        trace: List[Any] = []
        if self.sports:
            try:
                # Use the dedicated H2H endpoint for best coverage
                r = self.sports.handle({"intent": "h2h", "args": {"h2h": f"{team_a}-{team_b}"}})
                trace.append({"step": "sports.h2h", "ok": r.get("ok")})
                if r.get("ok"):
                    data = r.get("data") or {}
                    result = data.get("result")
                    matches: List[Dict[str, Any]] = []

                    if isinstance(result, list):
                        matches = result
                    elif isinstance(result, dict):
                        # Provider may split into firstTeam_VS_secondTeam / secondTeam_VS_firstTeam
                        for v in result.values():
                            if isinstance(v, list):
                                matches.extend(v)

                    # Fallback: some shapes might use a top-level list under "events" or "fixtures"
                    if not matches and isinstance(data, dict):
                        for k in ("fixtures", "events", "matches", "results"):
                            if isinstance(data.get(k), list):
                                matches = data.get(k) or []
                                break

                    # Sort newest first by date+time and trim
                    def dt_key(m: Dict[str, Any]) -> str:
                        d = str(m.get("event_date") or m.get("match_date") or m.get("date") or "")
                        t = str(m.get("event_time") or m.get("match_time") or m.get("time") or "")
                        return f"{d} {t}".strip()

                    try:
                        matches.sort(key=dt_key, reverse=True)
                    except Exception:
                        pass

                    if matches:
                        return matches[:lookback], trace
            except Exception as e:
                trace.append({"step": "sports.h2h", "error": str(e)})

        # Fallback: intersect recent lists
        a_list, t1 = self._recent_matches(team_a, lookback * 2)
        b_list, t2 = self._recent_matches(team_b, lookback * 2)
        trace.extend(t1 + t2)

        # keep where opponent ids match
        out: List[Dict[str, Any]] = []
        opp_keys = {"awayTeamId", "away_team_key", "away_id", "homeTeamId", "home_team_key", "home_id"}
        for m in a_list:
            # identify opponent id in record
            home = str(m.get("homeTeamId") or m.get("home_team_key") or m.get("home_id") or "")
            away = str(m.get("awayTeamId") or m.get("away_team_key") or m.get("away_id") or "")
            if (home == team_a and away == team_b) or (home == team_b and away == team_a):
                out.append(m)
                if len(out) >= lookback:
                    break
        return out, trace

# ---------------------------- metrics & math ----------------------------

def valid_odds_triplet(h: Optional[float], d: Optional[float], a: Optional[float]) -> bool:
    return all(x and isinstance(x, (int,float)) and x > 1.01 for x in (h,d,a))

def _safe_float(x) -> Optional[float]:
    try:
        if x is None: return None
        return float(x)
    except Exception:
        return None

def implied_probs_from_decimal_odds(odds: Dict[str, float]) -> Dict[str, float]:
    """
    Basic inverse-odds normalization to remove overround.
    """
    inv_h = 1.0 / odds["home"]
    inv_d = 1.0 / odds["draw"]
    inv_a = 1.0 / odds["away"]
    s = inv_h + inv_d + inv_a
    return {"home": inv_h / s, "draw": inv_d / s, "away": inv_a / s}

def _scoreline(match: Dict[str, Any]) -> Optional[Tuple[int,int]]:
    # Common fields
    for hk, ak in (("home_score","away_score"), ("goals_home","goals_away"),
                   ("event_final_result_home","event_final_result_away"),
                   ("homeGoals","awayGoals"), ("home","away")):
        h = match.get(hk); a = match.get(ak)
        try:
            if h is not None and a is not None:
                return int(h), int(a)
        except Exception:
            continue
    # Sometimes a single string like "2 - 1"
    s = match.get("final_score") or match.get("event_final_result") or match.get("score")
    if isinstance(s, str) and "-" in s:
        try:
            left, right = s.replace(" ", "").split("-")
            return int(left), int(right)
        except Exception:
            return None
    return None

def form_metrics_from_matches(matches: List[Dict[str, Any]], team_id: str) -> Dict[str, Any]:
    games = 0; wins = draws = losses = 0
    gf = ga = 0
    last_results: List[str] = []  # newest first, values "W","D","L"

    for m in matches:
        s = _scoreline(m)
        if s is None:
            continue
        h, a = s
        mh = str(m.get("homeTeamId") or m.get("home_team_key") or m.get("home_id") or "")
        ma = str(m.get("awayTeamId") or m.get("away_team_key") or m.get("away_id") or "")
        if not mh or not ma:
            continue

        if mh == team_id:
            gf += h; ga += a
            res = "W" if h > a else ("D" if h == a else "L")
        elif ma == team_id:
            gf += a; ga += h
            res = "W" if a > h else ("D" if a == h else "L")
        else:
            # not this team (filter noise)
            continue

        games += 1
        last_results.append(res)
        if res == "W": wins += 1
        elif res == "D": draws += 1
        else: losses += 1

    ppg = (wins*3 + draws*1) / games if games else 0.0
    gd = gf - ga
    gd_per_game = (gd / games) if games else 0.0

    # streaks
    win_streak = 0
    unbeaten = 0
    for r in last_results:
        if r == "W":
            win_streak += 1
            unbeaten += 1
        elif r == "D":
            if win_streak == len(last_results):  # first iteration special-case not needed, keep simple
                pass
            unbeaten += 1
            win_streak = 0
        else:
            break  # streak broken
    # unbeaten run
    unbeaten = 0
    for r in last_results:
        if r in ("W","D"):
            unbeaten += 1
        else:
            break

    # Small bonus to fold into rating (keeps winprob fallback realistic)
    streak_bonus = min(0.35, 0.12 * win_streak) + min(0.25, 0.05 * max(0, unbeaten - 2))

    return {
        "games": games,
        "wins": wins, "draws": draws, "losses": losses,
        "gf": gf, "ga": ga, "gd": gd,
        "ppg": round(ppg, 3),
        "gd_per_game": round(gd_per_game, 3),
        "last_results": last_results,      # newest→oldest, e.g., ["W","D","L","W","W"]
        "win_streak": win_streak,
        "unbeaten": unbeaten,
        "streak_bonus": round(streak_bonus, 3),
    }