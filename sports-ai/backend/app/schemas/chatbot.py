from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field


class ChatCitation(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    snippet: Optional[str] = None
    score: Optional[float] = Field(default=None, description="Provider-specific relevance score")


class ChatbotRequest(BaseModel):
    question: str = Field(..., min_length=1, description="End-user question about sports.")
    top_k: int = Field(5, ge=1, le=10, description="Number of web search results to use as context.")


class ChatbotResponse(BaseModel):
    answer: str
    citations: List[ChatCitation]
    meta: dict[str, Any] = Field(default_factory=dict)
