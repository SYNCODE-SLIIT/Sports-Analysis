# collector.py
# A tiny, importable client for TheSportsDB (V1 free key defaults to "123").
# No printing, no side effects. Ready for backend use.

from __future__ import annotations
import os, time
from dataclasses import dataclass
from typing import Optional, List, Dict
import httpx

# -------------------- CONFIG --------------------
API_KEY = os.getenv("THESPORTSDB_KEY", "123")  # free dev key for v1
BASE_URL = f"https://www.thesportsdb.com/api/v1/json/{API_KEY}"
TIMEOUT_S = 15.0
PAUSE_S = 0.35             # keep under ~30 req/min on free tier
RETRY_BACKOFFS = [0.5, 1.0, 2.0]  # simple retries on 429/5xx/timeouts

# -------------------- DATA SHAPES --------------------
@dataclass
class League:
    id: str
    name: str
    sport: str | None = None
    country: str | None = None

@dataclass
class MatchSummary:
    id: str
    date: str | None
    league: str | None
    home_team: str | None
    away_team: str | None
    home_score: Optional[int]
    away_score: Optional[int]
    venue: str | None
    status: str | None
    video: str | None
    thumb: str | None

@dataclass
class TimelineItem:
    minute: Optional[int]
    type: str              # "GOAL", "PENALTY", "RED_CARD", "YELLOW_CARD", "SUB", "UNKNOWN"
    team: str | None
    player: str | None
    detail: str | None
    text: str

@dataclass
class MatchPackage:
    event: MatchSummary
    timeline: List[TimelineItem]
    flags: Dict[str, bool]   # has_timeline, has_stats, has_lineup

# -------------------- INTERNAL HELPERS --------------------
def _sleep(t: float = PAUSE_S) -> None:
    time.sleep(t)

def _get(path: str, params: dict | None = None) -> dict | list:
    """HTTP GET with small retry/backoff; returns {} when API sends {'key': None}."""
    url = f"{BASE_URL}/{path.lstrip('/')}"
    last_err: Exception | None = None
    for backoff in [0.0] + RETRY_BACKOFFS:
        if backoff:
            time.sleep(backoff)
        try:
            r = httpx.get(url, params=params, timeout=TIMEOUT_S)
            if r.status_code in (429, 500, 502, 503, 504):
                last_err = RuntimeError(f"{r.status_code} from {url}")
                continue
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and data and all(v is None for v in data.values()):
                return {}
            return data
        except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as e:
            last_err = e
            continue
    raise RuntimeError(f"HTTP failed after retries: {last_err}")

TYPE_MAP = {
    "Goal": "GOAL",
    "Red Card": "RED_CARD",
    "Yellow Card": "YELLOW_CARD",
    "Substitution": "SUB",
    "Penalty": "PENALTY",
}

def _to_int(x) -> Optional[int]:
    try:
        return int(x) if x is not None and str(x).strip() != "" else None
    except:
        return None

def _country_aliases(name: str) -> list[str]:
    """Loose adjective/alias forms to help match leagues to a country via name."""
    m = {
        "england": ["english", "england", "uk", "great britain"],
        "scotland": ["scottish", "scotland"],
        "wales": ["welsh", "wales"],
        "northern ireland": ["northern irish", "northern ireland"],
        "spain": ["spanish", "spain"],
        "germany": ["german", "germany"],
        "france": ["french", "france"],
        "italy": ["italian", "italy"],
        "netherlands": ["dutch", "netherlands", "holland"],
        "belgium": ["belgian", "belgium"],
        "greece": ["greek", "greece"],
        "portugal": ["portuguese", "portugal"],
        "turkey": ["turkish", "turkey"],
        "usa": ["usa", "united states", "american", "us"],
        "united states": ["usa", "united states", "american", "us"],
        "brazil": ["brazilian", "brazil"],
        "argentina": ["argentine", "argentinian", "argentina"],
    }
    key = (name or "").strip().lower()
    return m.get(key, [key]) if key else []

def _normalize_league(raw: dict) -> League:
    return League(
        id = raw.get("idLeague") or "",
        name = raw.get("strLeague") or "",
        sport = raw.get("strSport"),
        country = raw.get("strCountry"),
    )

def _normalize_match_row(raw: dict) -> MatchSummary:
    return MatchSummary(
        id = raw.get("idEvent") or "",
        date = raw.get("dateEvent"),
        league = raw.get("strLeague"),
        home_team = raw.get("strHomeTeam"),
        away_team = raw.get("strAwayTeam"),
        home_score = _to_int(raw.get("intHomeScore")),
        away_score = _to_int(raw.get("intAwayScore")),
        venue = raw.get("strVenue"),
        status = raw.get("strStatus"),
        video = raw.get("strVideo"),
        thumb = raw.get("strThumb"),
    )

def _normalize_timeline_row(raw: dict) -> TimelineItem:
    minute = _to_int(raw.get("intTime"))
    raw_type = (raw.get("strEvent") or "").strip()
    type_norm = TYPE_MAP.get(raw_type, raw_type.upper() if raw_type else "UNKNOWN")
    team = raw.get("strTeam")
    player = raw.get("strPlayer")
    detail = raw.get("strDetail")
    parts: list[str] = []
    if minute is not None: parts.append(f"{minute}′")
    if type_norm and type_norm != "UNKNOWN": parts.append(type_norm.replace("_", " "))
    if player: parts.append(f"by {player}")
    if team: parts.append(f"({team})")
    if detail: parts.append(f"— {detail}")
    text = " ".join(parts) if parts else (raw.get("strEvent") or "Event")
    return TimelineItem(minute, type_norm, team, player, detail, text)

# -------------------- PUBLIC API --------------------
class SportsDBCollector:
    """Thin client for TheSportsDB with normalization and light validation."""

    # ---- Leagues ----
    def list_leagues(self, sport: str | None = None, country: str | None = None) -> List[League]:
        """List leagues (optionally filtered by sport & country).
        Uses filtered endpoint first; if empty, falls back to all_leagues + local filtering.
        """
        if sport and country:
            data = _get("search_all_leagues.php", {"c": country, "s": sport}) or {}
            raw = data.get("countrys") or []
            if raw:
                _sleep(); return [_normalize_league(x) for x in raw]

            all_data = _get("all_leagues.php") or {}
            all_raw = all_data.get("leagues") or []
            aliases = _country_aliases(country)
            sport_l = (sport or "").strip().lower()

            def _match_country(lname: str, lcountry: str | None) -> bool:
                lcountry_l = (lcountry or "").strip().lower()
                lname_l = (lname or "").strip().lower()
                if lcountry_l and lcountry_l == country.strip().lower():
                    return True
                return any(a in lname_l for a in aliases)

            filtered = [
                x for x in all_raw
                if (x.get("strSport") or "").strip().lower() == sport_l
                and _match_country(x.get("strLeague"), x.get("strCountry"))
            ]
            _sleep(); return [_normalize_league(x) for x in filtered]

        data = _get("all_leagues.php") or {}
        raw = data.get("leagues") or []
        _sleep(); return [_normalize_league(x) for x in raw]

    # ---- Teams ----
    def list_teams_in_league(self, *, league_id: str | None = None, league_name: str | None = None) -> List[dict]:
        """Teams in a league (raw-ish small dict rows with idTeam, strTeam, etc)."""
        if league_id:
            data = _get("lookup_all_teams.php", {"id": league_id}) or {}
        elif league_name:
            data = _get("search_all_teams.php", {"l": league_name}) or {}
        else:
            return []
        _sleep()
        teams = data.get("teams") or []
        # Keep commonly used fields only
        return [
            {
                "idTeam": t.get("idTeam"),
                "strTeam": t.get("strTeam"),
                "strAlternate": t.get("strAlternate"),
                "strCountry": t.get("strCountry"),
                "strStadium": t.get("strStadium"),
                "strTeamBadge": t.get("strTeamBadge"),
            } for t in teams
        ]

    # ---- Matches (events) ----
    def list_matches_for_league(self, league_id: str, kind: str = "past", limit: int = 10) -> List[MatchSummary]:
        """List past or next matches (events) for a league."""
        if kind == "past":
            data = _get("eventspastleague.php", {"id": league_id}) or {}
            raw = data.get("events") or []
        else:
            data = _get("eventsnextleague.php", {"id": league_id}) or {}
            raw = data.get("events") or []
        _sleep()
        return [_normalize_match_row(x) for x in raw[:limit]]

    def list_matches_for_team(self, team_id: str, kind: str = "last", limit: int = 5) -> List[MatchSummary]:
        """List last or next matches for a team."""
        if kind == "last":
            data = _get("eventslast.php", {"id": team_id}) or {}
            raw = data.get("results") or []
        else:
            data = _get("eventsnext.php", {"id": team_id}) or {}
            raw = data.get("events") or []
        _sleep()
        return [_normalize_match_row(x) for x in raw[:limit]]

    def get_match(self, event_id: str) -> MatchPackage:
        """Fetch one match: summary + timeline + flags (presence of stats/lineup/timeline)."""
        detail = _get("lookupevent.php", {"id": event_id}) or {}
        ev_raw = (detail.get("events") or [{}])[0]
        event = _normalize_match_row(ev_raw)
        _sleep()

        timeline_raw = _get("lookuptimeline.php", {"id": event_id}) or {}
        timeline_list = timeline_raw.get("timeline") or []
        timeline = [_normalize_timeline_row(x) for x in timeline_list]
        _sleep()

        stats_raw = _get("lookupeventstats.php", {"id": event_id}) or {}
        lineup_raw = _get("lookuplineup.php", {"id": event_id}) or {}
        flags = {
            "has_timeline": bool(timeline_list),
            "has_stats": bool(stats_raw.get("eventstats") or []),
            "has_lineup": bool(lineup_raw.get("lineup") or []),
        }
        _sleep()

        return MatchPackage(event=event, timeline=timeline, flags=flags)

__all__ = [
    "SportsDBCollector",
    "League",
    "MatchSummary",
    "TimelineItem",
    "MatchPackage",
]