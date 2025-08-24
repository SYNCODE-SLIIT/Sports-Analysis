"""
Game Analytics Agent (API-Football)
Fetches live analytics data for a selected game using API-Football.
Features:
- Lists available games for user selection
- Fetches game info, statistics, injury report, and highlight moments
Comments are added for each step.
"""

import requests
import os
import json
from datetime import datetime

API_KEY = os.environ.get("API_KEY")
BASE_URL = os.environ.get("BASE_URL")
CACHE_DIR = os.path.join(os.path.dirname(__file__), '../cache')
if not os.path.exists(CACHE_DIR):  # create lazily if missing
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
    except Exception:
        # If creation fails we will operate without cache silently.
        CACHE_DIR = None

class GameAnalyticsAgent:
    """Unified game analytics pulling from multiple providers.

    Current providers:
      - api_football (primary, rich statistics, injuries, events)
      - thesportsdb (via CollectorAgentV2 already in the codebase) for event, timeline, lineup, extra stats

    You can control provider priority via the 'providers' parameter; first success wins for a given
    data facet, but we attempt to augment with secondary sources where it adds unique fields.
    """

    SUPPORTED_PROVIDERS = ("api_football", "thesportsdb")

    def __init__(self, game_id: int | str | None = None, tsdb_event_id: str | None = None, providers: list[str] | None = None):
        self.game_id = game_id
        self.tsdb_event_id = tsdb_event_id  # optional matching TheSportsDB event id (if known from merge step)
        self.providers = [p for p in (providers or ["api_football", "thesportsdb"]) if p in self.SUPPORTED_PROVIDERS]
        if not self.providers:
            self.providers = ["api_football"]
        self.headers = {"x-apisports-key": os.getenv("API_FOOTBALL_KEY", API_KEY)}
        # Ensure cache directory exists
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
        except Exception:
            pass

    def _cache_path(self, key):
        return os.path.join(CACHE_DIR, key)

    def list_games(self, date=None, league_id=None):
        """Return merged list of games for a date from BOTH API-Football & TheSportsDB.
        Dedupe by (home_team, away_team, date-only) while keeping richer API-Football
        data when overlap exists. Always attempts both sources (no fallback) so the
        user sees the most complete picture.
        """
        date = date or datetime.utcnow().strftime('%Y-%m-%d')
        cache_file = self._cache_path(f"fixtures_{date}.json") if CACHE_DIR else None

        today = datetime.utcnow().strftime('%Y-%m-%d')
        use_cache = date != today and cache_file and os.path.exists(cache_file)
        if use_cache:
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass

        merged: dict[str, dict] = {}

        def key_fn(home: str | None, away: str | None, iso_ts: str | None):
            if not home or not away:
                return None
            # Extract date portion if iso_ts contains time
            d = (iso_ts or date)[:10]
            return f"{home.strip().lower()}__{away.strip().lower()}__{d}"

        # 1. API-Football fixtures (primary richness)
        try:
            params = {"date": date}
            if league_id:
                params["league"] = league_id
            resp = requests.get(BASE_URL + "fixtures", headers=self.headers, params=params, timeout=10)
            if resp.status_code == 200:
                for fix in resp.json().get("response", []) or []:
                    f = fix.get("fixture", {})
                    l = fix.get("league", {})
                    t = fix.get("teams", {})
                    g = fix.get("goals", {})
                    s = f.get("status", {})
                    record = {
                        "providers": ["api_football"],
                        "primary_provider": "api_football",
                        "game_id": f.get("id"),
                        "date": f.get("date"),
                        "timestamp": f.get("timestamp"),
                        "timezone": f.get("timezone"),
                        "referee": f.get("referee"),
                        "venue": (f.get("venue") or {}).get("name"),
                        "venue_city": (f.get("venue") or {}).get("city"),
                        "status_short": s.get("short"),
                        "status_long": s.get("long"),
                        "elapsed": s.get("elapsed"),
                        "league_id": l.get("id"),
                        "league": l.get("name"),
                        "league_country": l.get("country"),
                        "league_logo": l.get("logo"),
                        "league_flag": l.get("flag"),
                        "season": l.get("season"),
                        "round": l.get("round"),
                        "home_team_id": (t.get("home") or {}).get("id"),
                        "home_team": (t.get("home") or {}).get("name"),
                        "home_logo": (t.get("home") or {}).get("logo"),
                        "home_winner": (t.get("home") or {}).get("winner"),
                        "away_team_id": (t.get("away") or {}).get("id"),
                        "away_team": (t.get("away") or {}).get("name"),
                        "away_logo": (t.get("away") or {}).get("logo"),
                        "away_winner": (t.get("away") or {}).get("winner"),
                        "home_score": g.get("home"),
                        "away_score": g.get("away"),
                        "score": fix.get("score", {}),
                        # placeholders for TheSportsDB extras
                        "spectators": None,
                        "tsdb_event_id": None,
                    }
                    k = key_fn(record.get("home_team"), record.get("away_team"), record.get("date"))
                    if k:
                        merged[k] = record
        except Exception as e:
            print(f"API-Football error: {e}")

        # 2. TheSportsDB events for the same date
        try:
            from .collector import CollectorAgentV2
            collector = CollectorAgentV2()
            result = collector.handle({
                "intent": "events.list",
                "args": {"date": date}
            })
            events = (result.get("data") or {}).get("events") or []
            for ev in events:
                home = ev.get("strHomeTeam")
                away = ev.get("strAwayTeam")
                # Compose ISO-ish date
                iso = None
                d_part = ev.get("dateEvent")
                t_part = ev.get("strTime") or "00:00:00"
                if d_part:
                    iso = f"{d_part}T{t_part}"
                k = key_fn(home, away, iso)
                base_ev = {
                    "providers": ["thesportsdb"],
                    "primary_provider": "thesportsdb",
                    "game_id": ev.get("idEvent"),
                    "tsdb_event_id": ev.get("idEvent"),
                    "date": iso,
                    "timestamp": None,
                    "timezone": None,
                    "referee": ev.get("strReferee"),
                    "venue": ev.get("strVenue"),
                    "venue_city": None,
                    "status_short": ev.get("strStatus"),
                    "status_long": ev.get("strProgress") or ev.get("strStatus"),
                    "elapsed": ev.get("intTime"),
                    "league_id": ev.get("idLeague"),
                    "league": ev.get("strLeague"),
                    "league_country": ev.get("strCountry"),
                    "league_logo": None,
                    "league_flag": None,
                    "season": ev.get("strSeason"),
                    "round": ev.get("intRound") or ev.get("strRound"),
                    "home_team_id": ev.get("idHomeTeam"),
                    "home_team": home,
                    "home_logo": None,
                    "home_winner": None,
                    "away_team_id": ev.get("idAwayTeam"),
                    "away_team": away,
                    "away_logo": None,
                    "away_winner": None,
                    "home_score": ev.get("intHomeScore"),
                    "away_score": ev.get("intAwayScore"),
                    "score": {
                        "halftime": ev.get("strHTScore"),
                        "fulltime": ev.get("strFTScore"),
                        "extratime": ev.get("strETScore"),
                        "penalty": ev.get("strPSScore"),
                    },
                    "spectators": ev.get("intAttendance"),
                }
                if k and k in merged:
                    # merge augmenting existing API-Football record
                    existing = merged[k]
                    existing["providers"].append("thesportsdb")
                    existing.setdefault("spectators", base_ev.get("spectators"))
                    # fill missing season/round if absent
                    if not existing.get("season") and base_ev.get("season"):
                        existing["season"] = base_ev["season"]
                    if not existing.get("round") and base_ev.get("round"):
                        existing["round"] = base_ev["round"]
                    if not existing.get("referee") and base_ev.get("referee"):
                        existing["referee"] = base_ev["referee"]
                    existing["tsdb_event_id"] = base_ev.get("tsdb_event_id")
                else:
                    if k:
                        merged[k] = base_ev
        except Exception as e:
            print(f"TheSportsDB merge error: {e}")

        games = list(merged.values())

        # 3. Demo fallback if absolutely nothing
        if not games:
            from datetime import timedelta
            now = datetime.utcnow()
            games = [
                {
                    "providers": ["demo"],
                    "primary_provider": "demo",
                    "game_id": "demo_1",
                    "date": (now + timedelta(hours=2)).isoformat(),
                    "timestamp": int((now + timedelta(hours=2)).timestamp()),
                    "home_team": "Arsenal",
                    "away_team": "Chelsea",
                    "league": "Premier League",
                    "venue": "Emirates Stadium",
                    "status_short": "NS",
                    "status_long": "Not Started",
                    "home_score": None,
                    "away_score": None
                }
            ]

        # Sort: live first, then upcoming by time, then finished
        def sort_key(g):
            status = (g.get("status_short") or g.get("status_long") or "").upper()
            live_flag = 0
            if status in {"1H","2H","HT"} or status.endswith("'"):
                live_flag = -1
            elif status in {"NS","TBD"}:
                live_flag = 0
            else:
                live_flag = 1
            ts = g.get("timestamp") or 0
            return (live_flag, ts)
        games.sort(key=sort_key)

        # Cache (not for today)
        if cache_file and date != today:
            try:
                with open(cache_file, 'w', encoding='utf-8') as f:
                    json.dump(games, f)
            except Exception:
                pass
        return games

    def get_game_info(self):
        """
        Fetch game information from API-Football. Caches per fixture.
        """
        cache_file = self._cache_path(f"info_{self.game_id}.json")
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        resp = requests.get(BASE_URL + f"fixtures?id={self.game_id}", headers=self.headers)
        info = {}
        if resp.status_code == 200:
            fix = (resp.json().get("response") or [{}])[0]
            info = {
                "league": fix.get("league", {}).get("name"),
                "venue": fix.get("fixture", {}).get("venue", {}).get("name"),
                "forecast": "N/A"
            }
            try:
                with open(cache_file, 'w', encoding='utf-8') as f:
                    json.dump(info, f)
            except Exception:
                pass
        return info

    def get_season_statistics(self):
        """
        Fetch statistics for both teams from API-Football. Caches per fixture.
        """
        cache_file = self._cache_path(f"stats_{self.game_id}.json")
        if os.path.exists(cache_file):
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        resp = requests.get(BASE_URL + f"fixtures/statistics?fixture={self.game_id}", headers=self.headers)
        stats = {}
        if resp.status_code == 200:
            for team_stats in resp.json().get("response", []) or []:
                team = team_stats["team"]["name"]
                stats[team] = team_stats["statistics"]
            try:
                with open(cache_file, 'w', encoding='utf-8') as f:
                    json.dump(stats, f)
            except Exception:
                pass
        return stats

    def get_injury_report(self):
        """
        Fetch injury report for both teams from API-Football. Caches per fixture.
        """
        cache_file = self._cache_path(f"injury_{self.game_id}.json")
        if os.path.exists(cache_file):
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        resp = requests.get(BASE_URL + f"injuries?fixture={self.game_id}", headers=self.headers)
        injuries = {}
        if resp.status_code == 200:
            for injury in resp.json().get("response", []) or []:
                team = injury["team"]["name"]
                if team not in injuries:
                    injuries[team] = []
                injuries[team].append({
                    "name": injury["player"]["name"],
                    "position": injury["player"]["pos"],
                    "status": "Out",
                    "reason": injury["reason"]
                })
            try:
                with open(cache_file, 'w', encoding='utf-8') as f:
                    json.dump(injuries, f)
            except Exception:
                pass
        return injuries

    def get_highlight_moments(self):
        """
        Fetch highlight moments (goals, assists, cards) from API-Football. Caches per fixture.
        """
        cache_file = self._cache_path(f"highlights_{self.game_id}.json")
        if os.path.exists(cache_file):
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        resp = requests.get(BASE_URL + f"fixtures/events?fixture={self.game_id}", headers=self.headers)
        highlights = {"goals": [], "assists": [], "cards": []}
        if resp.status_code == 200:
            for event in resp.json().get("response", []) or []:
                if event["type"] == "Goal":
                    highlights["goals"].append(event)
                elif event["type"] == "Card":
                    highlights["cards"].append(event)
                elif event["type"] == "Assist":
                    highlights["assists"].append(event)
            try:
                with open(cache_file, 'w', encoding='utf-8') as f:
                    json.dump(highlights, f)
            except Exception:
                pass
        return highlights

    def get_all_analytics(self):
        """Return combined analytics data using configured providers.

        Structure:
          {
            sources_used: [...],
            game_info: { ... },            # primary fixture metadata
            season_statistics: {...},      # API-Football team stats
            injury_report: {...},          # API-Football injuries
            highlight_moments: {...},      # API-Football events (goals/cards/etc.)
            thesportsdb: {                 # only if tsdb data fetched
               event: {...},
               timeline: [...],
               stats: [...],
               lineup: [...]
            }
          }
        """
        out: dict[str, any] = {"sources_used": []}

        if "api_football" in self.providers and self.game_id:
            out["game_info"] = self.get_game_info()
            out["season_statistics"] = self.get_season_statistics()
            out["injury_report"] = self.get_injury_report()
            out["highlight_moments"] = self.get_highlight_moments()
            out["sources_used"].append("api_football")

        # Attempt TheSportsDB enrichment if requested & event id known (or resolvable later)
        if "thesportsdb" in self.providers and self.tsdb_event_id:
            try:
                tsdb = self._fetch_tsdb_event_bundle(self.tsdb_event_id)
                if tsdb:
                    out["thesportsdb"] = tsdb
                    out["sources_used"].append("thesportsdb")
                    # Fill missing referee / venue if absent in primary
                    if "game_info" in out:
                        gi = out["game_info"]
                        ev = tsdb.get("event") or {}
                        gi.setdefault("referee", ev.get("strReferee"))
                        gi.setdefault("venue", ev.get("strVenue"))
            except Exception as e:  # noqa: broad - enrichment is best-effort
                out.setdefault("errors", []).append({"provider": "thesportsdb", "error": str(e)})

        return out

    # ---------------- TheSportsDB enrichment (via existing collector) ---------------
    def _fetch_tsdb_event_bundle(self, event_id: str):
        """Use CollectorAgentV2 for event.get with expansions; return dict or None."""
        try:
            from .collector import CollectorAgentV2  # local import to avoid circular on module load
            collector = CollectorAgentV2()
            result = collector.handle({
                "intent": "event.get",
                "args": {"eventId": event_id, "expand": ["timeline", "stats", "lineup"]}
            })
            if not result.get("ok"):
                raise RuntimeError(result.get("error", {}).get("message", "unknown tsdb error"))
            data = result.get("data") or {}
            return {
                "event": data.get("event"),
                "timeline": data.get("timeline") or [],
                "stats": data.get("stats") or [],
                "lineup": data.get("lineup") or []
            }
        except Exception as e:
            raise e

# Comments added for each step above. Now uses API-Football.
