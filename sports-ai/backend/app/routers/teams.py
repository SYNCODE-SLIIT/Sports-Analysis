from fastapi import APIRouter, Query
from ..agents.collector import SportsDBCollector
from ..models.schemas import ItemsResponse, Team, Player

router = APIRouter(tags=["teams"])
c = SportsDBCollector()

@router.get("/leagues/{league_id}/teams", response_model=ItemsResponse)
def league_teams(league_id: str):
    teams = c.list_teams_in_league(league_id)
    return {"items": [t.dict() for t in teams]}

@router.get("/teams/{team_id}", response_model=Team | dict)
def team_detail(team_id: str):
    team = c.get_team(team_id)
    return team.dict() if team else {"error": "NOT_FOUND"}

@router.get("/teams/{team_id}/players", response_model=ItemsResponse)
def team_players(team_id: str):
    players = c.list_players_for_team(team_id)
    return {"items": [p.dict() for p in players]}

@router.get("/players/{player_id}", response_model=Player | dict)
def player_detail(player_id: str):
    player = c.get_player(player_id)
    return player.dict() if player else {"error": "NOT_FOUND"}