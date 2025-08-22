# backend/app/routers/leagues.py
from fastapi import APIRouter, Query
from ..agents.collector import SportsDBCollector
from ..models.schemas import ItemsResponse

router = APIRouter(tags=["leagues"])
c = SportsDBCollector()

@router.get("/leagues", response_model=ItemsResponse)
def list_leagues(sport: str | None = None, country: str | None = None):
    items = c.list_leagues(sport=sport, country=country)
    return {"items": [x.dict() for x in items]}

@router.get("/leagues/{league_id}/matches", response_model=ItemsResponse)
def league_matches(league_id: str, kind: str = "past", limit: int = 10):
    items = c.list_matches_for_league(league_id, kind=kind, limit=limit)
    return {"items": [x.dict() for x in items]}

@router.get("/leagues/{league_id}/seasons", response_model=ItemsResponse)
def league_seasons(league_id: str):
    return {"items": c.list_seasons_for_league(league_id)}

@router.get("/leagues/{league_id}/matches/season", response_model=ItemsResponse)
def league_matches_season(league_id: str, season: str = Query(..., description="e.g. 2025-2026")):
    items = c.list_matches_for_league_season(league_id, season)
    return {"items": [x.dict() for x in items]}

@router.get("/events/day", response_model=ItemsResponse)
def events_by_day(date: str = Query(..., description="YYYY-MM-DD"), sport: str = "Soccer"):
    items = c.list_matches_by_day(date_iso=date, sport=sport)
    return {"items": [x.dict() for x in items]}

@router.get("/sports", response_model=ItemsResponse)
def sports():
    return {"items": c.list_sports()}