from __future__ import annotations

import time
from typing import List, Optional

from ..utils.http_client import get_json
from ..utils.config import PAUSE_S
from ..models.schemas import (
    League,
    MatchSummary,
    TimelineItem,
    Flags,
    MatchPackage,
    Team,
    Player,
)

# Normalize event type strings coming from TheSportsDB
TYPE_MAP = {
    "Goal": "GOAL",
    "Red Card": "RED_CARD",
    "Yellow Card": "YELLOW_CARD",
    "Substitution": "SUB",
    "Penalty": "PENALTY",
}


# --------- small utilities ---------

def _sleep() -> None:
    """Polite pause to avoid rate limits."""
    time.sleep(PAUSE_S)


def _to_int(x) -> Optional[int]:
    """Convert incoming values like '3' or '' to int/None safely."""
    try:
        return int(x) if x is not None and str(x).strip() != "" else None
    except Exception:
        return None


def _country_aliases(name: str) -> list[str]:
    """Loose aliases to help match 'English Premier League' when country='England'."""
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


# --------- normalizers (raw JSON -> clean models) ---------

def _norm_league(raw: dict) -> League:
    return League(
        id=raw.get("idLeague") or "",
        name=raw.get("strLeague") or "",
        sport=raw.get("strSport"),
        country=raw.get("strCountry"),
    )


def _norm_match(raw: dict) -> MatchSummary:
    return MatchSummary(
        id=raw.get("idEvent") or "",
        date=raw.get("dateEvent"),
        league=raw.get("strLeague"),
        home_team=raw.get("strHomeTeam"),
        away_team=raw.get("strAwayTeam"),
        home_score=_to_int(raw.get("intHomeScore")),
        away_score=_to_int(raw.get("intAwayScore")),
        venue=raw.get("strVenue"),
        status=raw.get("strStatus"),
        video=raw.get("strVideo"),
        thumb=raw.get("strThumb"),
    )


def _norm_timeline_row(raw: dict) -> TimelineItem:
    minute = _to_int(raw.get("intTime"))
    raw_type = (raw.get("strEvent") or "").strip()
    type_norm = TYPE_MAP.get(raw_type, raw_type.upper() if raw_type else "UNKNOWN")
    team = raw.get("strTeam")
    player = raw.get("strPlayer")
    detail = raw.get("strDetail")

    parts: list[str] = []
    if minute is not None:
        parts.append(f"{minute}′")
    if type_norm and type_norm != "UNKNOWN":
        parts.append(type_norm.replace("_", " "))
    if player:
        parts.append(f"by {player}")
    if team:
        parts.append(f"({team})")
    if detail:
        parts.append(f"— {detail}")
    text = " ".join(parts) if parts else (raw.get("strEvent") or "Event")

    return TimelineItem(
        minute=minute,
        type=type_norm,
        team=team,
        player=player,
        detail=detail,
        text=text,
    )


def _norm_team(raw: dict) -> Team:
    return Team(
        id=raw.get("idTeam") or "",
        name=raw.get("strTeam") or "",
        alt_name=raw.get("strAlternate"),
        league=raw.get("strLeague"),
        country=raw.get("strCountry"),
        formed_year=_to_int(raw.get("intFormedYear")),
        stadium=raw.get("strStadium"),
        stadium_thumb=raw.get("strStadiumThumb"),
        website=raw.get("strWebsite"),
        badge=raw.get("strTeamBadge"),
        banner=raw.get("strTeamBanner"),
        jersey=raw.get("strTeamJersey"),
        description=raw.get("strDescriptionEN"),
    )


def _norm_player(raw: dict) -> Player:
    return Player(
        id=raw.get("idPlayer") or "",
        name=raw.get("strPlayer") or "",
        team=raw.get("strTeam"),
        team_id=raw.get("idTeam"),
        nationality=raw.get("strNationality"),
        position=raw.get("strPosition"),
        squad_number=raw.get("strNumber"),
        born=raw.get("dateBorn"),
        height=raw.get("strHeight"),
        weight=raw.get("strWeight"),
        signing=raw.get("strSigning"),
        wage=raw.get("strWage"),
        thumb=raw.get("strThumb"),
        cutout=raw.get("strCutout"),
        description=raw.get("strDescriptionEN"),
    )


# --------- main collector ---------

class SportsDBCollector:
    """Deterministic collector over TheSportsDB endpoints."""

    # ---- Leagues ----
    def list_sports(self) -> List[str]:
        """List distinct sports present across TheSportsDB."""
        data = get_json("all_sports.php") or {}
        raw = data.get("sports") or []
        sports = [
            (x.get("strSport") or "").strip()
            for x in raw
            if (x.get("strSport") or "").strip()
        ]
        _sleep()
        return sorted(set(sports))

    def list_leagues(self, sport: str | None = None, country: str | None = None) -> List[League]:
        """
        Fetch leagues with optional filtering:
        - sport & country -> try targeted search, else fallback to filtering all
        - sport only      -> filter all by sport
        - country only    -> filter all by country aliases
        - neither         -> return all leagues
        """
        # sport & country: use specific endpoint first
        if sport and country:
            data = get_json("search_all_leagues.php", {"c": country, "s": sport}) or {}
            raw = data.get("countrys") or []
            if raw:
                _sleep()
                return [_norm_league(x) for x in raw]

            # fallback: fetch all and filter locally
            data = get_json("all_leagues.php") or {}
            all_raw = data.get("leagues") or []
            aliases = _country_aliases(country)
            sport_l = (sport or "").strip().lower()

            def _match_country(lname: str, lcountry: str | None) -> bool:
                lcountry_l = (lcountry or "").strip().lower()
                lname_l = (lname or "").strip().lower()
                if lcountry_l and lcountry_l == country.strip().lower():
                    return True
                return any(a in lname_l for a in aliases)

            filtered = [
                x
                for x in all_raw
                if (x.get("strSport") or "").strip().lower() == sport_l
                and _match_country(x.get("strLeague"), x.get("strCountry"))
            ]
            _sleep()
            return [_norm_league(x) for x in filtered]

        # sport only
        if sport and not country:
            data = get_json("all_leagues.php") or {}
            all_raw = data.get("leagues") or []
            sport_l = (sport or "").strip().lower()
            filtered = [
                x for x in all_raw if (x.get("strSport") or "").strip().lower() == sport_l
            ]
            _sleep()
            return [_norm_league(x) for x in filtered]

        # country only
        if country and not sport:
            data = get_json("all_leagues.php") or {}
            all_raw = data.get("leagues") or []
            aliases = _country_aliases(country)

            def _match_country(lname: str, lcountry: str | None) -> bool:
                lcountry_l = (lcountry or "").strip().lower()
                lname_l = (lname or "").strip().lower()
                if lcountry_l and lcountry_l == country.strip().lower():
                    return True
                return any(a in lname_l for a in aliases)

            filtered = [x for x in all_raw if _match_country(x.get("strLeague"), x.get("strCountry"))]
            _sleep()
            return [_norm_league(x) for x in filtered]

        # neither: return all
        data = get_json("all_leagues.php") or {}
        raw = data.get("leagues") or []
        _sleep()
        return [_norm_league(x) for x in raw]

    # ---- Matches ----
    def list_matches_for_league(self, league_id: str, kind: str = "past", limit: int = 10) -> List[MatchSummary]:
        """List past/next matches for a league (limit is a cap; API may return fewer)."""
        if kind == "past":
            data = get_json("eventspastleague.php", {"id": league_id}) or {}
            raw = data.get("events") or []
        else:
            data = get_json("eventsnextleague.php", {"id": league_id}) or {}
            raw = data.get("events") or []
        _sleep()
        return [_norm_match(x) for x in raw[:limit]]

    def list_matches_for_team(self, team_id: str, kind: str = "last", limit: int = 5) -> List[MatchSummary]:
        """List last/next matches for a team."""
        if kind == "last":
            data = get_json("eventslast.php", {"id": team_id}) or {}
            raw = data.get("results") or []
        else:
            data = get_json("eventsnext.php", {"id": team_id}) or {}
            raw = data.get("events") or []
        _sleep()
        return [_norm_match(x) for x in raw[:limit]]

    def get_match(self, event_id: str) -> MatchPackage:
        """Full match package: summary + timeline + availability flags."""
        detail = get_json("lookupevent.php", {"id": event_id}) or {}
        ev_raw = (detail.get("events") or [{}])[0]
        event = _norm_match(ev_raw)
        _sleep()

        tl = get_json("lookuptimeline.php", {"id": event_id}) or {}
        timeline_raw = tl.get("timeline") or []
        timeline = [_norm_timeline_row(x) for x in timeline_raw]
        _sleep()

        stats = get_json("lookupeventstats.php", {"id": event_id}) or {}
        lineup = get_json("lookuplineup.php", {"id": event_id}) or {}
        flags = Flags(
            has_timeline=bool(timeline_raw),
            has_stats=bool(stats.get("eventstats") or []),
            has_lineup=bool(lineup.get("lineup") or []),
        )
        _sleep()

        return MatchPackage(
            event=event,
            timeline=timeline,
            flags=flags,
            provenance={"source": "TheSportsDB"},
        )

    # ---- Seasons / Day views ----
    def list_seasons_for_league(self, league_id: str) -> List[str]:
        """Return season strings like '2025-2026'."""
        data = get_json("search_all_seasons.php", {"id": league_id}) or {}
        seasons = [s.get("strSeason") for s in (data.get("seasons") or []) if s.get("strSeason")]
        _sleep()
        return seasons

    def list_matches_for_league_season(self, league_id: str, season: str) -> List[MatchSummary]:
        """Full schedule for a league season."""
        data = get_json("eventsseason.php", {"id": league_id, "s": season}) or {}
        raw = data.get("events") or []
        _sleep()
        return [_norm_match(x) for x in raw]

    def list_matches_by_day(self, date_iso: str, sport: str = "Soccer") -> List[MatchSummary]:
        """All events for a given day (ISO date) and sport."""
        data = get_json("eventsday.php", {"d": date_iso, "s": sport}) or {}
        raw = data.get("events") or []
        _sleep()
        return [_norm_match(x) for x in raw]

    # ---- Teams / Players ----
    def list_teams_in_league(self, league_id: str) -> List[Team]:
        data = get_json("lookup_all_teams.php", {"id": league_id}) or {}
        raw = data.get("teams") or []
        _sleep()
        return [_norm_team(x) for x in raw]

    def search_teams(self, name: str) -> List[Team]:
        data = get_json("searchteams.php", {"t": name}) or {}
        raw = data.get("teams") or []
        _sleep()
        return [_norm_team(x) for x in raw]

    def get_team(self, team_id: str) -> Optional[Team]:
        data = get_json("lookupteam.php", {"id": team_id}) or {}
        raw = data.get("teams") or []
        _sleep()
        return _norm_team(raw[0]) if raw else None

    def list_players_for_team(self, team_id: str) -> List[Player]:
        data = get_json("lookup_all_players.php", {"id": team_id}) or {}
        raw = data.get("player") or []
        _sleep()
        return [_norm_player(x) for x in raw]

    def search_players(self, name: str) -> List[Player]:
        data = get_json("searchplayers.php", {"p": name}) or {}
        raw = data.get("player") or []
        _sleep()
        return [_norm_player(x) for x in raw]

    def get_player(self, player_id: str) -> Optional[Player]:
        data = get_json("lookupplayer.php", {"id": player_id}) or {}
        raw = data.get("players") or []
        _sleep()
        return _norm_player(raw[0]) if raw else None
