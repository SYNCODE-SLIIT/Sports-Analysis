from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, TypedDict

import requests

class LeagueNewsError(Exception):
    def __init__(self, message: str, *, status: int | None = None, payload: Any | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.payload = payload


class NewsArticle(TypedDict, total=False):
    id: str
    title: str
    url: str
    summary: str | None
    imageUrl: str | None
    source: str | None
    publishedAt: str | None


@dataclass
class LeagueNewsService:
    api_key: str = os.getenv("NEWS_API_KEY", "").strip()
    api_url: str = os.getenv("NEWS_API_URL", "https://newsapi.org/v2/everything").strip()

    def __post_init__(self) -> None:
        if not self.api_key:
            raise LeagueNewsError("NEWS_API_KEY is not configured")

    def fetch(self, league_name: str, limit: int = 100) -> Dict[str, Any]:
        if not league_name:
            raise LeagueNewsError("league_name is required")
        params = {
            "q": f"{league_name} football",
            "language": "en",
            # Increase pageSize cap to 100 (NewsAPI supports up to 100) so frontend can request more
            "pageSize": min(limit or 100, 100),
            "sortBy": "publishedAt",
            "apiKey": self.api_key,
        }

        try:
            response = requests.get(self.api_url, params=params, timeout=10)
        except requests.RequestException as exc:
            raise LeagueNewsError("Failed to contact news provider", payload=str(exc)) from exc

        if response.status_code != 200:
            raise LeagueNewsError(
                f"News provider returned HTTP {response.status_code}",
                status=response.status_code,
                payload=response.text[:300],
            )

        payload = response.json()
        articles = self._normalize(payload.get("articles") or [])
        return {"ok": True, "articles": articles, "count": len(articles)}

    def _normalize(self, raw_articles: List[Dict[str, Any]]) -> List[NewsArticle]:
        normalized: List[NewsArticle] = []
        for entry in raw_articles:
            title = (entry.get("title") or "").strip()
            url = (entry.get("url") or "").strip()
            if not title or not url:
                continue

            published = entry.get("publishedAt") or entry.get("published_at")
            if published:
                try:
                    published = datetime.fromisoformat(published.replace("Z", "+00:00")).isoformat()
                except ValueError:
                    published = None

            normalized.append(
                NewsArticle(
                    id=entry.get("url"),
                    title=title,
                    url=url,
                    summary=(entry.get("description") or "").strip() or None,
                    imageUrl=(entry.get("urlToImage") or "").strip() or None,
                    source=((entry.get("source") or {}).get("name") or "").strip() or None,
                    publishedAt=published,
                )
            )
        return normalized
