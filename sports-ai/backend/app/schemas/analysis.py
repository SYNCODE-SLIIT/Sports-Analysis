from __future__ import annotations
from typing import List, Dict
from pydantic import BaseModel, Field


class WinProbabilities(BaseModel):
    home: float = Field(..., ge=0.0, le=1.0)
    draw: float = Field(..., ge=0.0, le=1.0)
    away: float = Field(..., ge=0.0, le=1.0)
    method: str
    sources: List[str]


class TeamForm(BaseModel):
    team_id: str
    matches: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    last_five: str  # e.g., "W D W L W"
    unbeaten_streak: int


class HeadToHead(BaseModel):
    team_a_id: str
    team_b_id: str
    matches: int
    wins_a: int
    wins_b: int
    draws: int
    avg_goals_a: float
    avg_goals_b: float
    recent: List[Dict]


class MatchInsights(BaseModel):
    event_id: str
    home_team_id: str
    away_team_id: str
    generated_at: str
    win_probabilities: WinProbabilities
    home_form: TeamForm
    away_form: TeamForm
    head_to_head: HeadToHead
