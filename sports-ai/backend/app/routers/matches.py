from __future__ import annotations
from fastapi import APIRouter, Query
from ..agents.collector import SportsDBCollector
from ..models.schemas import ItemsResponse, MatchPackage

router = APIRouter(tags=["matches"])
c = SportsDBCollector()

@router.get("/leagues/{league_id}/matches", response_model=ItemsResponse)
def league_matches(league_id: str, kind: str = Query("past"), limit: int = Query(10, ge=1, le=50)):
    items = c.list_matches_for_league(league_id, kind=kind, limit=limit)
    return {"items": [m.dict() for m in items]}

@router.get("/teams/{team_id}/matches", response_model=ItemsResponse)
def team_matches(team_id: str, kind: str = Query("last"), limit: int = Query(5, ge=1, le=50)):
    items = c.list_matches_for_team(team_id, kind=kind, limit=limit)
    return {"items": [m.dict() for m in items]}

@router.get("/matches/{event_id}", response_model=MatchPackage)
def match_detail(event_id: str):
    pack = c.get_match(event_id)
    return pack

@router.get("/leagues/{league_id}/seasons", response_model=ItemsResponse)
def league_seasons(league_id: str):
    seasons = c.list_seasons_for_league(league_id)
    return {"items": seasons}

@router.get("/leagues/{league_id}/matches/season", response_model=ItemsResponse)
def league_matches_season(league_id: str, season: str = Query(..., description="e.g. 2025-2026")):
    items = c.list_matches_for_league_season(league_id, season)
    return {"items": [m.dict() for m in items]}

@router.get("/events/day", response_model=ItemsResponse)
def events_by_day(date: str = Query(..., description="YYYY-MM-DD"), sport: str = "Soccer"):
    items = c.list_matches_by_day(date, sport)
    return {"items": [m.dict() for m in items]}