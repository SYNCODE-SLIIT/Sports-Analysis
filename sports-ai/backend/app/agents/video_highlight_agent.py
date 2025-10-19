"""Video highlight aggregation agent.

Provides reliable per-match highlight clips by combining provider feeds with
an optional YouTube Data API lookup constrained to the match date. Falls back
to lightweight search links when no verified clips are found.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

from ..services.highlight_search import search_event_highlights

_EVENT_ID_KEYS: Tuple[str, ...] = (
    "eventId",
    "event_id",
    "matchId",
    "fixture_id",
    "event_key",
    "idEvent",
    "idAPIfootball",
    "id",
)


@dataclass
class VideoCandidate:
    id: str
    url: str
    title: str
    provider: str
    thumbnail: Optional[str] = None
    duration: Optional[int] = None
    published_at: Optional[str] = None
    source: Optional[str] = None
    score: float = 0.0

    def as_public(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "provider": self.provider,
        }
        if self.thumbnail:
            payload["thumbnail"] = self.thumbnail
        if self.duration is not None:
            payload["duration"] = self.duration
        if self.published_at:
            payload["publishedAt"] = self.published_at
        if self.source:
            payload["source"] = self.source
        return payload


def _mkresp(
    ok: bool,
    intent: str,
    args: Dict[str, Any],
    *,
    data: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    trace: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "intent": intent,
        "args_resolved": args or {},
        "data": data if ok else None,
        "error": None if ok else (error or "Unknown error"),
        "meta": {
            "source": {"primary": "video_highlight"},
            "trace": trace or [],
        },
    }


def _to_string(value: Any) -> Optional[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    if isinstance(value, (int, float)) and value == value:
        return str(value)
    return None


def _pick_first(record: Dict[str, Any], keys: Iterable[str]) -> Optional[str]:
    for key in keys:
        val = record.get(key)
        string = _to_string(val)
        if string:
            return string
    return None


def _parse_kickoff(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, (int, float)) and value == value:
        try:
            return datetime.fromtimestamp(int(value), timezone.utc)
        except Exception:
            return None
    text = _to_string(value)
    if not text:
        return None
    text = text.replace("/", "-")
    # Normalize trailing Z
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]
    for fmt in formats:
        try:
            parsed = datetime.strptime(text, fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            continue
    return None


def _duration_to_seconds(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)) and value == value:
        seconds = int(value)
        return max(seconds, 0)
    text = _to_string(value)
    if not text:
        return None
    text = text.upper()
    # ISO 8601 duration PT#H#M#S
    iso_match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", text)
    if iso_match:
        hours = int(iso_match.group(1) or 0)
        minutes = int(iso_match.group(2) or 0)
        seconds = int(iso_match.group(3) or 0)
        return hours * 3600 + minutes * 60 + seconds
    parts = text.split(":")
    try:
        parts_int = [int(p) for p in parts]
    except ValueError:
        return None
    if len(parts_int) == 3:
        hours, minutes, seconds = parts_int
    elif len(parts_int) == 2:
        hours = 0
        minutes, seconds = parts_int
    elif len(parts_int) == 1:
        hours = 0
        minutes = 0
        seconds = parts_int[0]
    else:
        return None
    return hours * 3600 + minutes * 60 + seconds


def _normalize_name(name: Optional[str]) -> str:
    if not name:
        return ""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _contains_all_terms(text: str, terms: Iterable[str]) -> bool:
    normalized = _normalize_name(text)
    return all(term in normalized for term in terms if term)


class VideoHighlightAgent:
    """Aggregates accurate video highlights for a match."""

    SUPPORTED = {"video.highlights", "highlights.video"}

    def __init__(self, allsports_adapter=None, tsdb_adapter=None, logger=None):
        self.allsports = allsports_adapter
        self.tsdb = tsdb_adapter
        self.log = logger
        self.youtube_key = os.getenv("YOUTUBE_API_KEY", "").strip()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def handle(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        if intent not in self.SUPPORTED:
            return _mkresp(False, intent, args, error=f"Unsupported intent: {intent}")

        args = dict(args or {})
        trace: List[Dict[str, Any]] = []

        try:
            event_id = self._normalize_event_id(args)
        except ValueError as exc:
            return _mkresp(False, intent, args, error=str(exc))

        context = self._build_context(event_id, args, trace)

        candidates: Dict[str, VideoCandidate] = {}

        provider_videos = self._fetch_provider_videos(event_id, trace)
        for video in provider_videos:
            candidates.setdefault(video.url, video)

        youtube_videos = self._fetch_youtube_videos(context, trace)
        for video in youtube_videos:
            candidates.setdefault(video.url, video)

        ordered = sorted(
            candidates.values(),
            key=lambda v: (-v.score, self._published_sort_key(v.published_at)),
        )
        public_videos = [video.as_public() for video in ordered]

        search_links = None
        if not public_videos and context:
            try:
                search_links = search_event_highlights({
                    "homeTeam": context.get("home_team"),
                    "awayTeam": context.get("away_team"),
                    "date": context.get("kickoff_date"),
                })
                trace.append({"step": "search.links", "ok": True})
            except Exception as exc:  # pragma: no cover - defensive
                trace.append({"step": "search.links", "ok": False, "error": str(exc)})

        data = {
            "eventId": event_id,
            "videos": public_videos,
            "context": context,
        }
        if search_links:
            data["search"] = search_links

        return _mkresp(True, intent, {"eventId": event_id}, data=data, trace=trace)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _normalize_event_id(self, args: Dict[str, Any]) -> str:
        for key in _EVENT_ID_KEYS:
            value = args.get(key)
            if value is not None:
                text = _to_string(value)
                if text:
                    return text
        raise ValueError("Missing required argument: eventId")

    def _build_context(self, event_id: str, args: Dict[str, Any], trace: List[Dict[str, Any]]) -> Dict[str, Any]:
        payload = self._coerce_event_payload(args)
        if not payload and self.allsports:
            try:
                resp = self.allsports.call("event.get", {"eventId": event_id})
                trace.append({"step": "event.allsports", "ok": resp.get("ok")})
                if resp.get("ok"):
                    payload = self._extract_event_from_payload(resp.get("data"))
            except Exception as exc:  # pragma: no cover - defensive
                trace.append({"step": "event.allsports", "ok": False, "error": str(exc)})

        if not payload and self.tsdb:
            try:
                resp = self.tsdb.call("event.results", {"eventId": event_id})
                trace.append({"step": "event.tsdb", "ok": resp.get("ok")})
                if resp.get("ok"):
                    payload = self._extract_event_from_payload(resp.get("data"))
            except Exception as exc:  # pragma: no cover - defensive
                trace.append({"step": "event.tsdb", "ok": False, "error": str(exc)})

        context: Dict[str, Any] = {"eventId": event_id}

        if payload:
            home = _pick_first(payload, [
                "home_team",
                "event_home_team",
                "homeTeam",
                "strHomeTeam",
                "HomeTeam",
            ])
            away = _pick_first(payload, [
                "away_team",
                "event_away_team",
                "awayTeam",
                "strAwayTeam",
                "AwayTeam",
            ])
            league = _pick_first(payload, ["league", "league_name", "strLeague", "competition"])
            country = _pick_first(payload, ["country", "country_name", "event_country"])
            kickoff = _parse_kickoff(payload.get("event_date") or payload.get("date") or payload.get("match_date"))
            if kickoff is None and payload.get("time"):
                date_only = _pick_first(payload, ["event_date", "date", "match_date"]) or args.get("date")
                if date_only:
                    composed = f"{date_only} {payload.get('time')}"
                    kickoff = _parse_kickoff(composed)
            context.update({
                "home_team": home,
                "away_team": away,
                "league": league,
                "country": country,
                "kickoff": kickoff.isoformat() if kickoff else None,
                "kickoff_date": kickoff.date().isoformat() if kickoff else _pick_first(payload, ["event_date", "date"]),
            })
        else:
            context.update({
                "home_team": _to_string(args.get("homeTeam")),
                "away_team": _to_string(args.get("awayTeam")),
                "kickoff": _to_string(args.get("date")),
                "kickoff_date": _to_string(args.get("date")),
            })

        return context

    def _coerce_event_payload(self, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        candidates = [
            args.get("event"),
            args.get("match"),
            args.get("raw"),
            args.get("eventRaw"),
            args.get("matchRaw"),
            args.get("payload"),
            args.get("data"),
        ]
        for cand in candidates:
            payload = self._extract_event_from_payload(cand)
            if payload:
                return payload
        return None

    def _extract_event_from_payload(self, payload: Any) -> Optional[Dict[str, Any]]:
        if not payload:
            return None
        if isinstance(payload, dict):
            keys = set(payload.keys())
            if keys.intersection({"home_team", "event_home_team", "timeline", "goalscorers"}):
                return payload
            for key in ("event", "match", "payload", "data"):
                nested = payload.get(key)
                nested_event = self._extract_event_from_payload(nested)
                if nested_event:
                    return nested_event
            for key in ("result", "results", "events"):
                nested = payload.get(key)
                nested_event = self._extract_event_from_payload(nested)
                if nested_event:
                    return nested_event
        if isinstance(payload, list):
            for item in payload:
                if isinstance(item, dict):
                    return item
        return None

    def _fetch_provider_videos(self, event_id: str, trace: List[Dict[str, Any]]) -> List[VideoCandidate]:
        if not self.allsports:
            return []
        try:
            resp = self.allsports.call("video.highlights", {"eventId": event_id})
            trace.append({"step": "videos.allsports", "ok": resp.get("ok")})
            if not resp.get("ok"):
                return []
            data = resp.get("data") or {}
            items = self._extract_video_list(data)
            videos = []
            for entry in items:
                video = self._normalize_video_entry(entry, default_provider="AllSports")
                if video:
                    video.score = 1.0
                    video.source = "allsports"
                    videos.append(video)
            return videos
        except Exception as exc:  # pragma: no cover - defensive
            trace.append({"step": "videos.allsports", "ok": False, "error": str(exc)})
            return []

    def _extract_video_list(self, data: Any) -> List[Dict[str, Any]]:
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if not isinstance(data, dict):
            return []
        for key in ("videos", "result", "results", "items", "highlights"):
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []

    def _normalize_video_entry(self, entry: Dict[str, Any], default_provider: str) -> Optional[VideoCandidate]:
        url = _pick_first(entry, ["url", "video_url", "matchviewUrl", "matchview_url"])
        video_id = _pick_first(entry, ["id", "video_id", "videoId", "yt_id", "youtube_id"])
        if not url and video_id:
            url = f"https://www.youtube.com/watch?v={video_id}"
        if not url:
            return None
        if not video_id:
            video_id = url
        title = _pick_first(entry, ["title", "video_title", "name", "caption"]) or "Match highlight"
        thumbnail = _pick_first(entry, ["thumbnail", "video_thumbnail", "thumb", "image"])
        provider = _pick_first(entry, ["provider", "source"]) or default_provider
        duration = _duration_to_seconds(
            entry.get("duration")
            or entry.get("video_duration")
            or entry.get("length")
        )
        published = _pick_first(entry, ["published", "published_at", "date", "created_at"])
        return VideoCandidate(
            id=str(video_id),
            url=url,
            title=title,
            provider=provider,
            thumbnail=thumbnail,
            duration=duration,
            published_at=published,
        )

    def _fetch_youtube_videos(self, context: Dict[str, Any], trace: List[Dict[str, Any]]) -> List[VideoCandidate]:
        if not self.youtube_key:
            trace.append({"step": "youtube.skip", "reason": "missing_key"})
            return []
        home = _to_string(context.get("home_team"))
        away = _to_string(context.get("away_team"))
        if not home or not away:
            trace.append({"step": "youtube.skip", "reason": "missing_team_names"})
            return []

        kickoff_iso = _to_string(context.get("kickoff")) or _to_string(context.get("kickoff_date"))
        kickoff_dt = _parse_kickoff(kickoff_iso)
        window_after = kickoff_dt + timedelta(days=3) if kickoff_dt else None
        window_before = kickoff_dt - timedelta(days=2) if kickoff_dt else None

        query_parts = [home, "vs", away, "highlights"]
        year = str(kickoff_dt.year) if kickoff_dt else None
        if year:
            query_parts.append(year)
        league = _to_string(context.get("league"))
        if league:
            query_parts.append(league)
        query = " ".join(part for part in query_parts if part)

        params = {
            "part": "snippet",
            "type": "video",
            "q": query,
            "maxResults": 8,
            "order": "relevance",
            "safeSearch": "strict",
            "key": self.youtube_key,
        }
        if window_before:
            params["publishedAfter"] = window_before.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if window_after:
            params["publishedBefore"] = window_after.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

        try:
            response = requests.get("https://www.googleapis.com/youtube/v3/search", params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            items = data.get("items") or []
        except Exception as exc:  # pragma: no cover - defensive
            trace.append({"step": "youtube.search", "ok": False, "error": str(exc)})
            return []

        video_ids = [item.get("id", {}).get("videoId") for item in items if item.get("id")]
        snippets = {item.get("id", {}).get("videoId"): item.get("snippet") for item in items if item.get("id")}

        durations: Dict[str, Optional[int]] = {}
        published: Dict[str, Optional[str]] = {}
        if video_ids:
            try:
                details_resp = requests.get(
                    "https://www.googleapis.com/youtube/v3/videos",
                    params={
                        "part": "contentDetails,snippet",
                        "id": ",".join(video_ids),
                        "key": self.youtube_key,
                    },
                    timeout=10,
                )
                details_resp.raise_for_status()
                details = details_resp.json().get("items") or []
                for item in details:
                    vid = item.get("id")
                    duration = _duration_to_seconds(((item.get("contentDetails") or {}).get("duration")))
                    published_at = _to_string((item.get("snippet") or {}).get("publishedAt"))
                    if vid:
                        durations[vid] = duration
                        published[vid] = published_at
            except Exception as exc:  # pragma: no cover - defensive
                trace.append({"step": "youtube.details", "ok": False, "error": str(exc)})

        team_terms = [_normalize_name(home), _normalize_name(away)]

        videos: List[VideoCandidate] = []
        for vid in video_ids:
            snippet = snippets.get(vid) or {}
            title = _to_string(snippet.get("title")) or "Match highlight"
            description = _to_string(snippet.get("description")) or ""
            full_text = f"{title} {description}"
            if not _contains_all_terms(full_text, team_terms):
                continue
            published_at = published.get(vid)
            if kickoff_dt and published_at:
                pub_dt = _parse_kickoff(published_at)
                if pub_dt and abs((pub_dt - kickoff_dt).days) > 5:
                    continue
            thumbnail = None
            thumbs = snippet.get("thumbnails") or {}
            for quality in ("maxres", "standard", "high", "medium", "default"):
                thumb = _to_string((thumbs.get(quality) or {}).get("url"))
                if thumb:
                    thumbnail = thumb
                    break
            video = VideoCandidate(
                id=str(vid),
                url=f"https://www.youtube.com/watch?v={vid}",
                title=title,
                provider="YouTube",
                thumbnail=thumbnail,
                duration=durations.get(vid),
                published_at=published_at,
                source="youtube",
                score=2.0,
            )
            videos.append(video)

        trace.append({"step": "youtube.search", "ok": True, "count": len(videos)})
        return videos

    def _published_sort_key(self, value: Optional[str]) -> float:
        if not value:
            return float("inf")
        dt = _parse_kickoff(value)
        if not dt:
            return float("inf")
        return -dt.timestamp()
