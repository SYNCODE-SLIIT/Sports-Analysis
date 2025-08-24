from __future__ import annotations
from typing import Optional, Literal, List
from pydantic import BaseModel, Field

class League(BaseModel):
    id: str
    name: str
    sport: Optional[str] = None
    country: Optional[str] = None

class MatchSummary(BaseModel):
    id: str
    date: Optional[str] = None
    league: Optional[str] = None
    home_team: Optional[str] = None
    away_team: Optional[str] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    venue: Optional[str] = None
    status: Optional[str] = None
    video: Optional[str] = None
    thumb: Optional[str] = None

class TimelineItem(BaseModel):
    minute: Optional[int] = None
    type: Literal["GOAL","PENALTY","RED_CARD","YELLOW_CARD","SUB","UNKNOWN"]
    team: Optional[str] = None
    player: Optional[str] = None
    detail: Optional[str] = None
    text: str

class Flags(BaseModel):
    has_timeline: bool = False
    has_stats: bool = False
    has_lineup: bool = False

class MatchPackage(BaseModel):
    event: MatchSummary
    timeline: List[TimelineItem]
    flags: Flags
    provenance: dict = Field(default_factory=dict)

class ItemsResponse(BaseModel):
    items: list

class Team(BaseModel):
    id: str
    name: str
    alt_name: Optional[str] = None
    league: Optional[str] = None
    country: Optional[str] = None
    formed_year: Optional[int] = None
    stadium: Optional[str] = None
    stadium_thumb: Optional[str] = None
    website: Optional[str] = None
    badge: Optional[str] = None
    banner: Optional[str] = None
    jersey: Optional[str] = None
    description: Optional[str] = None

class Player(BaseModel):
    id: str
    name: str
    team: Optional[str] = None
    team_id: Optional[str] = None
    nationality: Optional[str] = None
    position: Optional[str] = None
    squad_number: Optional[str] = None
    born: Optional[str] = None
    height: Optional[str] = None
    weight: Optional[str] = None
    signing: Optional[str] = None
    wage: Optional[str] = None
    thumb: Optional[str] = None
    cutout: Optional[str] = None
    description: Optional[str] = None