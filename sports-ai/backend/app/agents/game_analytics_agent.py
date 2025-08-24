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
import re

API_KEY = os.environ.get("API_KEY")
BASE_URL = os.environ.get("BASE_URL")
ALLSPORTS_API_KEY = os.environ.get("ALLSPORTS_API_KEY")
ALLSPORTS_BASE_URL = os.environ.get("ALLSPORTS_BASE_URL", "https://apiv2.allsportsapi.com/football/")
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

    SUPPORTED_PROVIDERS = ("api_football", "thesportsdb", "allsportsapi")

    def __init__(self, game_id: int | str | None = None, tsdb_event_id: str | None = None, providers: list[str] | None = None, allsports_event_id: str | None = None):
        self.game_id = game_id
        self.tsdb_event_id = tsdb_event_id  # optional matching TheSportsDB event id (if known from merge step)
        self.allsports_event_id = allsports_event_id  # AllSportsApi event key
        self.providers = [p for p in (providers or ["api_football", "thesportsdb"]) if p in self.SUPPORTED_PROVIDERS]
        if not self.providers:
            self.providers = ["api_football"]
        # Support two possible backends depending on BASE_URL
        self.is_fd_org = bool(BASE_URL and "football-data.org" in BASE_URL)
        if self.is_fd_org:
            # Football-Data.org uses X-Auth-Token
            self.headers = {"X-Auth-Token": os.getenv("API_KEY", API_KEY)}
        else:
            # API-Football compatibility
            self.headers = {"x-apisports-key": os.getenv("API_FOOTBALL_KEY", API_KEY)}
        # Ensure cache directory exists
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
        except Exception:
            pass

    def _cache_path(self, key):
        return os.path.join(CACHE_DIR, key)

    def _fetch_and_cache(self, path, cache_key):
        """Helper to fetch a URL path (relative to BASE_URL) and cache JSON by cache_key."""
        cache_file = None
        if CACHE_DIR:
            try:
                cache_file = self._cache_path(cache_key + '.json')
            except Exception:
                cache_file = None
        if cache_file and os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        try:
            resp = requests.get(BASE_URL + path, headers=self.headers, timeout=8)
            if resp.status_code == 200:
                j = resp.json()
                if cache_file:
                    try:
                        with open(cache_file, 'w', encoding='utf-8') as f:
                            json.dump(j, f)
                    except Exception:
                        pass
                return j
        except Exception:
            pass
        return None

    def _get_team_info(self, team_id):
        """Best-effort fetch of team metadata (logo/crest) from Football-Data.org."""
        if not team_id:
            return {}
        data = self._fetch_and_cache(f"teams/{team_id}", f"team_{team_id}")
        if not data:
            return {}
        # football-data v4 team object may be nested under 'team' or top-level
        team = data.get('team') or data
        # possible keys: 'crest', 'crestUrl', 'logo'
        logo = team.get('crest') or team.get('crestUrl') or team.get('logo')
        return {"id": team.get('id'), "name": team.get('name'), "logo": logo}

    def _get_competition_info(self, comp_id):
        if not comp_id:
            return {}
        data = self._fetch_and_cache(f"competitions/{comp_id}", f"comp_{comp_id}")
        if not data:
            return {}
        comp = data.get('competition') or data
        emblem = comp.get('emblem') or comp.get('logo') or comp.get('area', {}).get('flag')
        return {"id": comp.get('id'), "name": comp.get('name'), "emblem": emblem}

    def list_games(self, date=None, league_id=None, refresh: bool = False):
        """Return merged list of games for a date from BOTH API-Football & TheSportsDB.
        Dedupe by (home_team, away_team, date-only) while keeping richer API-Football
        data when overlap exists. Always attempts both sources (no fallback) so the
        user sees the most complete picture.
        """
        date = date or datetime.utcnow().strftime('%Y-%m-%d')
        cache_file = self._cache_path(f"fixtures_{date}.json") if CACHE_DIR else None

        today = datetime.utcnow().strftime('%Y-%m-%d')
        use_cache = (not refresh) and date != today and cache_file and os.path.exists(cache_file)
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

    # 1a. Football-Data.org (if configured) - use /matches with date filters
        if self.is_fd_org:
            try:
                params = {"dateFrom": date, "dateTo": date}
                resp = requests.get(BASE_URL + "matches", headers=self.headers, params=params, timeout=10)
                if resp.status_code == 200:
                    fd_list = resp.json().get("matches", []) or []
                    if os.getenv("SPORTS_DEBUG") == "1":
                        print(f"[DEBUG][FD] status=200 matches={len(fd_list)} date={date}")
                        if fd_list:
                            sample = fd_list[0]
                            print(f"[DEBUG][FD] sample_ids home={sample.get('homeTeam',{}).get('id')} away={sample.get('awayTeam',{}).get('id')} comp={sample.get('competition',{}).get('id')}")
                    for m in fd_list:
                        # Defensive access - football-data fields differ from API-Football
                        comp = m.get("competition") or {}
                        home = m.get("homeTeam") or {}
                        away = m.get("awayTeam") or {}
                        score = m.get("score") or {}
                        full = score.get("fullTime") or {}
                        half = score.get("halfTime") or {}
                        extra = score.get("extraTime") or {}
                        pens = score.get("penalties") or {}
                        utc = m.get("utcDate")
                        ts = None
                        try:
                            if utc:
                                ts = int(datetime.fromisoformat(utc.replace('Z', '+00:00')).timestamp())
                        except Exception:
                            ts = None
                        # Enrich with team and competition metadata when available
                        home_meta = self._get_team_info(home.get('id')) if home else {}
                        away_meta = self._get_team_info(away.get('id')) if away else {}
                        comp_meta = self._get_competition_info(comp.get('id')) if comp else {}
                        record = {
                            "providers": ["football-data"],
                            "primary_provider": "football-data",
                            "game_id": m.get("id"),
                            "date": utc,
                            "timestamp": ts,
                            "timezone": "UTC",
                            "referee": None,
                            "venue": m.get("venue"),
                            "venue_city": None,
                            "status_short": m.get("status"),
                            "status_long": m.get("status"),
                            "elapsed": None,
                            "league_id": comp.get("id"),
                            "league": comp.get("name"),
                            "league_country": None,
                            "league_logo": comp_meta.get('emblem'),
                            "league_flag": None,
                            "season": (m.get("season") or {}).get("id"),
                            "season_start_date": (m.get("season") or {}).get("startDate"),
                            "season_end_date": (m.get("season") or {}).get("endDate"),
                            "season_current_matchday": (m.get("season") or {}).get("currentMatchday"),
                            "round": m.get("matchday"),
                            "stage": m.get("stage"),
                            "group": m.get("group"),
                            "last_updated": m.get("lastUpdated"),
                            "competition_code": comp.get("code"),
                            "competition_type": comp.get("type"),
                            "home_team_id": home.get("id"),
                            "home_team": home.get("name"),
                            "home_logo": home_meta.get('logo'),
                            "home_winner": None,
                            "away_team_id": away.get("id"),
                            "away_team": away.get("name"),
                            "away_logo": away_meta.get('logo'),
                            "away_winner": None,
                            "home_score": full.get("home"),
                            "away_score": full.get("away"),
                            "score": {
                                "winner": score.get("winner"),
                                "duration": score.get("duration"),
                                "full_time": full,
                                "half_time": half,
                                "extra_time": extra,
                                "penalties": pens,
                            },
                            "spectators": None,
                            "tsdb_event_id": None,
                            "odds_msg": (m.get("odds") or {}).get("msg"),
                            "area_name": (m.get("area") or {}).get("name"),
                            "area_code": (m.get("area") or {}).get("code"),
                            "area_flag": (m.get("area") or {}).get("flag"),
                        }
                        # Infer winner if finished
                        if record.get("home_score") is not None and record.get("away_score") is not None:
                            if record["home_score"] > record["away_score"]:
                                record["score"]["winner"] = "HOME_TEAM"
                            elif record["home_score"] < record["away_score"]:
                                record["score"]["winner"] = "AWAY_TEAM"
                            else:
                                record["score"]["winner"] = "DRAW"
                        k = key_fn(record.get("home_team"), record.get("away_team"), record.get("date"))
                        if k:
                            merged[k] = record
                        elif os.getenv("SPORTS_DEBUG") == "1":
                            print(f"[DEBUG][FD] skipped_record missing key home={record.get('home_team')} away={record.get('away_team')} date={record.get('date')}")
            except Exception as e:
                print(f"Football-Data.org error: {e}")
        else:
            # 1b. API-Football fixtures (primary richness)
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
                        # Winner inference
                        if record.get("home_score") is not None and record.get("away_score") is not None and record.get("score"):
                            sc = record["score"]
                            ft = sc.get("fulltime") or sc.get("full_time") or {}
                            h = ft.get("home") if isinstance(ft, dict) else record.get("home_score")
                            a = ft.get("away") if isinstance(ft, dict) else record.get("away_score")
                            if h is not None and a is not None:
                                if h > a:
                                    sc["winner"] = "HOME_TEAM"
                                elif h < a:
                                    sc["winner"] = "AWAY_TEAM"
                                else:
                                    sc["winner"] = "DRAW"
                        k = key_fn(record.get("home_team"), record.get("away_team"), record.get("date"))
                        if k:
                            merged[k] = record
            except Exception as e:
                print(f"API-Football error: {e}")

        # 1c. AllSportsApi Fixtures (if API key configured)
        if ALLSPORTS_API_KEY:
            try:
                params = {
                    "met": "Fixtures",
                    "APIkey": ALLSPORTS_API_KEY,
                    "from": date,
                    "to": date
                }
                resp = requests.get(ALLSPORTS_BASE_URL, params=params, timeout=12)
                if resp.status_code == 200:
                    body = resp.json()
                    events = body.get("result") or []
                    if os.getenv("SPORTS_DEBUG") == "1":
                        print(f"[DEBUG][ALLSPORTS] fixtures={len(events)} date={date}")
                    for ev in events:
                        # Parse scores from result strings like "2 - 1"
                        def parse_score(s):
                            if not s or "-" not in s:
                                return (None, None)
                            parts = re.split(r"\s*-\s*", s.strip())
                            if len(parts) == 2:
                                try:
                                    return (int(parts[0]) if parts[0] else None, int(parts[1]) if parts[1] else None)
                                except Exception:
                                    return (None, None)
                            return (None, None)
                        ft_home, ft_away = parse_score(ev.get("event_final_result") or ev.get("event_ft_result"))
                        ht_home, ht_away = parse_score(ev.get("event_halftime_result"))
                        iso = None
                        d_part = ev.get("event_date")
                        t_part = ev.get("event_time") or "00:00"
                        if d_part:
                            iso = f"{d_part}T{t_part}:00"
                        record = {
                            "providers": ["allsportsapi"],
                            "primary_provider": "allsportsapi",
                            "game_id": ev.get("event_key"),
                            "date": iso,
                            "timestamp": None,
                            "timezone": None,
                            "referee": ev.get("event_referee"),
                            "venue": ev.get("event_stadium"),
                            "venue_city": None,
                            "status_short": ev.get("event_status"),
                            "status_long": ev.get("event_status"),
                            "elapsed": None,
                            "league_id": ev.get("league_key"),
                            "league": ev.get("league_name"),
                            "league_country": ev.get("country_name"),
                            "league_logo": ev.get("league_logo"),
                            "league_flag": ev.get("country_logo"),
                            "season": ev.get("league_season"),
                            "round": ev.get("league_round"),
                            "home_team_id": ev.get("home_team_key"),
                            "home_team": ev.get("event_home_team"),
                            "home_logo": ev.get("home_team_logo"),
                            "home_winner": None,
                            "away_team_id": ev.get("away_team_key"),
                            "away_team": ev.get("event_away_team"),
                            "away_logo": ev.get("away_team_logo"),
                            "away_winner": None,
                            "home_score": ft_home,
                            "away_score": ft_away,
                            "score": {
                                "full_time": {"home": ft_home, "away": ft_away},
                                "half_time": {"home": ht_home, "away": ht_away},
                                "winner": None,
                                "duration": None,
                            },
                            "spectators": None,
                            "tsdb_event_id": None,
                        }
                        # Winner inference
                        if record.get("home_score") is not None and record.get("away_score") is not None:
                            hs = record.get("home_score")
                            as_ = record.get("away_score")
                            if hs is not None and as_ is not None:
                                if hs > as_:
                                    record["score"]["winner"] = "HOME_TEAM"
                                elif hs < as_:
                                    record["score"]["winner"] = "AWAY_TEAM"
                                else:
                                    record["score"]["winner"] = "DRAW"
                        k = key_fn(record.get("home_team"), record.get("away_team"), record.get("date"))
                        if k:
                            # If already have a richer provider entry, append provider tag; else replace/insert
                            if k in merged:
                                existing = merged[k]
                                if "allsportsapi" not in existing.get("providers", []):
                                    existing.get("providers", []).append("allsportsapi")
                            else:
                                merged[k] = record
                else:
                    if os.getenv("SPORTS_DEBUG") == "1":
                        print(f"[DEBUG][ALLSPORTS] non-200 status={resp.status_code} body={resp.text[:160]}")
            except Exception as e:
                print(f"AllSportsApi error: {e}")

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
        if os.getenv("SPORTS_DEBUG") == "1":
            print(f"[DEBUG] merged_count_after_sources={len(games)} (before demo fallback) date={date}")

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

    # ---------------- AllSportsApi helpers -----------------
    def _allsports_fetch(self, method: str, cache_key: str, **params):
        if not ALLSPORTS_API_KEY:
            return None
        cache_file = self._cache_path(f"as_{cache_key}.json") if CACHE_DIR else None
        if cache_file and os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        q = {"met": method, "APIkey": ALLSPORTS_API_KEY}
        q.update(params)
        try:
            resp = requests.get(ALLSPORTS_BASE_URL, params=q, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                if cache_file:
                    try:
                        with open(cache_file, 'w', encoding='utf-8') as f:
                            json.dump(data, f)
                    except Exception:
                        pass
                return data
            else:
                if os.getenv("SPORTS_DEBUG") == "1":
                    print(f"[DEBUG][ALLSPORTS] method={method} status={resp.status_code} body={resp.text[:150]}")
        except Exception as e:
            print(f"AllSportsApi fetch error: {e}")
        return None

    def get_allsports_match_details(self):
        if not self.allsports_event_id:
            return {}
        data = self._allsports_fetch("Fixtures", f"match_{self.allsports_event_id}", matchId=self.allsports_event_id)
        if not data:
            return {}
        result_list = data.get("result") or []
        if not result_list:
            return {}
        m = result_list[0]
        # Map lineups, statistics, goalscorers, cards, substitutes
        out = {
            "raw": m,
            "lineups": m.get("lineups"),
            "statistics": m.get("statistics"),
            "goalscorers": m.get("goalscorers"),
            "cards": m.get("cards"),
            "substitutes": m.get("substitutes"),
        }
        return out

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
        # API-Football: /fixtures?id=...
        # Football-Data.org: /matches/{id}
        if self.is_fd_org:
            resp = requests.get(BASE_URL + f"matches/{self.game_id}", headers=self.headers)
        else:
            resp = requests.get(BASE_URL + f"fixtures?id={self.game_id}", headers=self.headers)
        info = {}
        if resp.status_code == 200:
            if self.is_fd_org:
                try:
                    match = resp.json()
                except Exception:
                    match = {}
                score = match.get("score") or {}
                info = {
                    "league": (match.get("competition") or {}).get("name"),
                    "competition_code": (match.get("competition") or {}).get("code"),
                    "competition_type": (match.get("competition") or {}).get("type"),
                    "venue": match.get("venue"),
                    "area": match.get("area"),
                    "season": match.get("season"),
                    "stage": match.get("stage"),
                    "group": match.get("group"),
                    "matchday": match.get("matchday"),
                    "last_updated": match.get("lastUpdated"),
                    "odds": match.get("odds"),
                    "referees": match.get("referees") or [],
                    "score_winner": score.get("winner"),
                    "score_duration": score.get("duration"),
                    "score_full_time": score.get("fullTime"),
                    "score_half_time": score.get("halfTime"),
                    "score_extra_time": score.get("extraTime"),
                    "score_penalties": score.get("penalties"),
                    "fd_raw": match,
                }
            else:
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
        # No direct equivalent in Football-Data.org; skip for fd.org
        if self.is_fd_org:
            return {}
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
        # Football-Data.org does not provide injuries endpoint in v4; skip for fd.org
        if self.is_fd_org:
            return {}
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
        # Football-Data.org does not provide per-match event feed like API-Football in v4
        if self.is_fd_org:
            return {"goals": [], "assists": [], "cards": []}
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

        if "api_football" in self.providers and self.game_id and not self.is_fd_org:
            out["game_info"] = self.get_game_info()
            out["season_statistics"] = self.get_season_statistics()
            out["injury_report"] = self.get_injury_report()
            out["highlight_moments"] = self.get_highlight_moments()
            out["sources_used"].append("api_football")

        if self.is_fd_org and self.game_id:
            # Provide basic game_info for Football-Data matches
            out["game_info"] = self.get_game_info()
            out.setdefault("sources_used", []).append("football-data")

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

        # AllSportsApi enrichment (details + videos)
        if "allsportsapi" in self.providers and self.allsports_event_id:
            try:
                as_details = self.get_allsports_match_details()
                if as_details:
                    out["allsportsapi"] = as_details
                    out["sources_used"].append("allsportsapi")
                    # Populate highlight_moments if empty
                    if not out.get("highlight_moments"):
                        goals = as_details.get("goalscorers") or []
                        cards = as_details.get("cards") or []
                        out["highlight_moments"] = {
                            "goals": goals,
                            "cards": cards,
                            "assists": []
                        }
                    # Videos
                    vids = self.get_allsports_videos(self.allsports_event_id)
                    if vids:
                        out["videos"] = vids
            except Exception as e:
                out.setdefault("errors", []).append({"provider": "allsportsapi", "error": str(e)})
        return out

    def get_allsports_videos(self, event_id: str):
        data = self._allsports_fetch("Videos", f"videos_{event_id}", eventId=event_id)
        if not data:
            return []
        return data.get("result") or []

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
