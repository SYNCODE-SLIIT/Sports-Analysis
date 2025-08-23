from __future__ import annotations
from fastapi import APIRouter, Query
from ..agents.collector import SportsDBCollector
from ..models.schemas import ItemsResponse, MatchPackage

router = APIRouter(tags=["matches"])
c = SportsDBCollector()


@router.get("/teams/{team_id}/matches", response_model=ItemsResponse)
def team_matches(team_id: str, kind: str = Query("last"), limit: int = Query(5, ge=1, le=50)):
    items = c.list_matches_for_team(team_id, kind=kind, limit=limit)
    return {"items": [m.dict() for m in items]}


@router.get("/matches/{event_id}", response_model=MatchPackage)
def match_detail(event_id: str):
    pack = c.get_match(event_id)
    return pack

