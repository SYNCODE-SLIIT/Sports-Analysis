from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


class ChatCitation(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    snippet: Optional[str] = None
    score: Optional[float] = Field(default=None, description="Provider-specific relevance score")


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1)


class ChatbotRequest(BaseModel):
    question: str = Field(..., min_length=1, description="End-user question about sports.")
    top_k: int = Field(5, ge=1, le=10, description="Number of web search results to use as context.")
    history: List[ChatMessage] = Field(default_factory=list, description="Prior conversation (oldest first).")


class ChatbotResponse(BaseModel):
    answer: str
    citations: List[ChatCitation]
    meta: dict[str, Any] = Field(default_factory=dict)


class PromptRecommendation(BaseModel):
    title: Optional[str] = Field(default=None, description="Display title or matchup for the recommendation.")
    summary: Optional[str] = Field(default=None, description="Short description of the item.")
    reason: Optional[str] = Field(default=None, description="Why this item was recommended.")
    league: Optional[str] = Field(default=None, description="League or competition name, if available.")
    teams: List[str] = Field(default_factory=list, description="Teams associated with the recommendation.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional structured metadata.")


class SuggestedPromptsRequest(BaseModel):
    recommendations: List[PromptRecommendation] = Field(default_factory=list)
    limit: int = Field(4, ge=1, le=6, description="Maximum number of prompts to generate.")


class SuggestedPromptsResponse(BaseModel):
    prompts: List[str] = Field(default_factory=list, description="List of suggested starter questions.")
