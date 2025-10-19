"""Highlight timeline agent.

Generates normalized match timeline items from provider payloads so
frontend components can display consistent highlight tracks.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

from ..services.highlight_search import search_event_highlights

# Shared intent keys that might contain event identifiers
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


# --- Timeline data structures ---


@dataclass
class TimelineItem:
    minute: int
    team: str  # "home" | "away"
    type: str  # goal, sub, yellow, red, etc
    player: Optional[str] = None
    assist: Optional[str] = None
    note: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "minute": self.minute,
            "team": self.team,
            "type": self.type,
            **({"player": self.player} if self.player else {}),
            **({"assist": self.assist} if self.assist else {}),
            **({"note": self.note} if self.note else {}),
        }


# --- Video highlight data structures ---


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mkresp(
    ok: bool,
    intent: str,
    args: Dict[str, Any],
    *,
    data: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    trace: Optional[List[Dict[str, Any]]] = None,
    fallback: Optional[str] = None,
    primary: str = "highlight",
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "intent": intent,
        "args_resolved": args or {},
        "data": data if ok else None,
        "error": None if ok else (error or "Unknown error"),
        "meta": {
            "source": {"primary": primary, "fallback": fallback},
            "trace": trace or [],
        },
    }


class HighlightAgent:
    """Builds match timelines and aggregates video highlights."""

    TIMELINE_INTENTS = {"highlight.timeline", "timeline.highlight"}
    VIDEO_INTENTS = {"video.highlights", "highlights.video"}
    SUPPORTED = TIMELINE_INTENTS | VIDEO_INTENTS

    def __init__(self, allsports_adapter=None, tsdb_adapter=None, logger=None):
        self.allsports = allsports_adapter
        self.tsdb = tsdb_adapter
        self.log = logger
        self.youtube_key = os.getenv("YOUTUBE_API_KEY", "").strip()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def handle(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        args = dict(args or {})

        if intent in self.TIMELINE_INTENTS:
            return self._handle_timeline(intent, args)

        if intent in self.VIDEO_INTENTS:
            return self._handle_video(intent, args)

        return _mkresp(False, intent, args, error=f"Unsupported intent: {intent}")

    def _handle_timeline(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        trace: List[Dict[str, Any]] = []
        try:
            event_id = self._normalize_event_id(args)
        except ValueError as exc:
            return _mkresp(False, intent, args, error=str(exc), primary="highlight.timeline")

        supplied = self._coerce_event_payload(args)
        if supplied:
            trace.append({"step": "payload.supplied", "info": "using provided event payload"})

        event_payload = supplied
        fallback_source: Optional[str] = None

        if not event_payload:
            event_payload, fallback_source, fetch_trace = self._fetch_event_payload(event_id, args)
            trace.extend(fetch_trace)

        if not event_payload:
            return _mkresp(
                False,
                intent,
                {"eventId": event_id},
                error="Event payload unavailable",
                trace=trace,
                primary="highlight.timeline",
            )

        timeline = _build_timeline(event_payload)
        if not timeline:
            trace.append({"step": "timeline.empty", "note": "no events extracted"})
            timeline = [
                TimelineItem(minute=45, team="home", type="ht"),
                TimelineItem(minute=90, team="home", type="ft"),
            ]

        data = {
            "eventId": event_id,
            "items": [item.to_dict() for item in timeline],
            "generated_at": _now_iso(),
            "source": fallback_source or ("supplied" if supplied else "unknown"),
        }

        return _mkresp(
            True,
            intent,
            {"eventId": event_id},
            data=data,
            trace=trace,
            fallback=fallback_source,
            primary="highlight.timeline",
        )

    def _handle_video(self, intent: str, args: Dict[str, Any]) -> Dict[str, Any]:
        trace: List[Dict[str, Any]] = []
        try:
            event_id = self._normalize_event_id(args)
        except ValueError as exc:
            return _mkresp(False, intent, args, error=str(exc), primary="highlight.video")

        context = self._build_video_context(event_id, args, trace)

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
                search_links = search_event_highlights(
                    {
                        "homeTeam": context.get("home_team"),
                        "awayTeam": context.get("away_team"),
                        "date": context.get("kickoff_date"),
                    }
                )
                trace.append({"step": "search.links", "ok": True})
            except Exception as exc:  # pragma: no cover - defensive
                trace.append({"step": "search.links", "ok": False, "error": str(exc)})

        data: Dict[str, Any] = {
            "eventId": event_id,
            "videos": public_videos,
            "context": context,
        }
        if search_links:
            data["search"] = search_links

        return _mkresp(
            True,
            intent,
            {"eventId": event_id},
            data=data,
            trace=trace,
            primary="highlight.video",
        )

    # ------------------------------------------------------------------
    # Video highlight helpers
    # ------------------------------------------------------------------
    def _build_video_context(self, event_id: str, args: Dict[str, Any], trace: List[Dict[str, Any]]) -> Dict[str, Any]:
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
            home = _pick_first(
                payload,
                [
                    "home_team",
                    "event_home_team",
                    "homeTeam",
                    "strHomeTeam",
                    "HomeTeam",
                ],
            )
            away = _pick_first(
                payload,
                [
                    "away_team",
                    "event_away_team",
                    "awayTeam",
                    "strAwayTeam",
                    "AwayTeam",
                ],
            )
            league = _pick_first(payload, ["league", "league_name", "strLeague", "competition"])
            country = _pick_first(payload, ["country", "country_name", "event_country"])
            kickoff = _parse_kickoff(
                payload.get("event_date") or payload.get("date") or payload.get("match_date")
            )
            if kickoff is None and payload.get("time"):
                date_only = _pick_first(payload, ["event_date", "date", "match_date"]) or args.get("date")
                if date_only:
                    kickoff = _parse_kickoff(f"{date_only} {payload.get('time')}")
            context.update(
                {
                    "home_team": home,
                    "away_team": away,
                    "league": league,
                    "country": country,
                    "kickoff": kickoff.isoformat() if kickoff else None,
                    "kickoff_date": kickoff.date().isoformat() if kickoff else _pick_first(payload, ["event_date", "date"]),
                }
            )
        else:
            context.update(
                {
                    "home_team": _to_string(args.get("homeTeam")),
                    "away_team": _to_string(args.get("awayTeam")),
                    "kickoff": _to_string(args.get("date")),
                    "kickoff_date": _to_string(args.get("date")),
                }
            )

        return context

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
            videos: List[VideoCandidate] = []
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
            entry.get("duration") or entry.get("video_duration") or entry.get("length")
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
            params["publishedAfter"] = (
                window_before.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            )
        if window_after:
            params["publishedBefore"] = (
                window_after.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            )

        try:
            response = requests.get(
                "https://www.googleapis.com/youtube/v3/search",
                params=params,
                timeout=10,
            )
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
                    duration = _duration_to_seconds((item.get("contentDetails") or {}).get("duration"))
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

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------
    def _fetch_event_payload(
        self, event_id: str,
        args: Dict[str, Any],
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str], List[Dict[str, Any]]]:
        trace: List[Dict[str, Any]] = []

        # Try AllSports first (same priority as RouterCollector)
        if self.allsports:
            try:
                params = {"eventId": event_id}
                if "augment_tags" in args:
                    params["augment_tags"] = args.get("augment_tags")
                else:
                    params["augment_tags"] = True
                if "include_best_player" in args:
                    params["include_best_player"] = args.get("include_best_player")
                else:
                    params["include_best_player"] = True
                resp = self.allsports.call("event.get", params)
                trace.append({"step": "fetch.allsports", "ok": resp.get("ok")})
                if resp.get("ok"):
                    payload = self._extract_event_from_payload(resp.get("data"))
                    if payload:
                        return payload, "allsports", trace
            except Exception as exc:  # pragma: no cover - defensive
                trace.append({"step": "fetch.allsports", "error": str(exc)})

        # Fallback to TSDB event.results (legacy)
        if self.tsdb:
            try:
                resp = self.tsdb.call("event.results", {"eventId": event_id})
                trace.append({"step": "fetch.tsdb", "ok": resp.get("ok")})
                if resp.get("ok"):
                    payload = self._extract_event_from_payload(resp.get("data"))
                    if payload:
                        return payload, "tsdb", trace
            except Exception as exc:  # pragma: no cover - defensive
                trace.append({"step": "fetch.tsdb", "error": str(exc)})

        return None, None, trace

    # ------------------------------------------------------------------
    # Payload helpers
    # ------------------------------------------------------------------
    def _normalize_event_id(self, args: Dict[str, Any]) -> str:
        for key in _EVENT_ID_KEYS:
            value = args.get(key)
            if value is not None and str(value).strip() != "":
                return str(value)
        raise ValueError("Missing required argument: eventId")

    def _coerce_event_payload(self, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        candidates = [
            args.get("event"),
            args.get("match"),
            args.get("raw"),
            args.get("matchRaw"),
            args.get("eventRaw"),
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
            # Direct event dict heuristic: presence of typical keys
            keys = set(payload.keys())
            if keys.intersection(
                {
                    "event_home_team",
                    "home_team",
                    "homeTeam",
                    "timeline",
                    "goalscorers",
                    "cards",
                    "substitutions",
                }
            ):
                return payload

            for key in ("event", "match", "payload", "data"):
                nested = payload.get(key)
                nested_event = self._extract_event_from_payload(nested)
                if nested_event:
                    return nested_event

            for key in ("result", "results", "events", "fixtures", "matches"):
                val = payload.get(key)
                event = self._extract_from_iterable(val)
                if event:
                    return event

        if isinstance(payload, list):
            event = self._extract_from_iterable(payload)
            if event:
                return event
        return None

    def _extract_from_iterable(self, value: Any) -> Optional[Dict[str, Any]]:
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    return item
        if isinstance(value, dict):
            return value
        return None


# ----------------------------------------------------------------------
# Timeline builder (port of frontend match-mappers.ts logic)
# ----------------------------------------------------------------------

def _build_timeline(event: Dict[str, Any]) -> List[TimelineItem]:
    if not isinstance(event, dict):
        return []

    items: List[TimelineItem] = []

    # Goals
    for goal in _as_records(
        event.get("goalscorers")
        or event.get("goals")
        or event.get("scorers")
        or event.get("scorers_list")
        or []
    ):
        minute = _to_minute(
            goal.get("time")
            or goal.get("minute")
            or goal.get("elapsed")
            or goal.get("time_elapsed")
        )
        team = "home" if _is_home_goal(goal) else "away"
        goal_type = _goal_type(goal)
        items.append(
            TimelineItem(
                minute=minute,
                team=team,
                type=goal_type,
                player=_to_string(
                    goal.get("scorer")
                    or goal.get("home_scorer")
                    or goal.get("away_scorer")
                    or goal.get("player")
                ),
                assist=_to_string(goal.get("assist") or goal.get("assist_name")),
                note=_to_string(goal.get("info") or goal.get("reason")),
            )
        )

    # Cards
    for card in _as_records(event.get("cards") or event.get("bookings") or []):
        minute = _to_minute(card.get("time") or card.get("minute") or card.get("elapsed"))
        team = "home" if _is_home_card(card) else "away"
        card_type = "red" if _is_red_card(card) else "yellow"
        items.append(
            TimelineItem(
                minute=minute,
                team=team,
                type=card_type,
                player=_to_string(card.get("player") or card.get("home_fault") or card.get("away_fault")),
                note=_to_string(card.get("reason") or card.get("info")),
            )
        )

    # Substitutions
    for sub in _as_records(event.get("substitutions") or event.get("subs") or []):
        minute = _to_minute(sub.get("time") or sub.get("minute") or sub.get("elapsed"))
        team = "home" if _is_home_sub(sub) else "away"
        items.append(
            TimelineItem(
                minute=minute,
                team=team,
                type="sub",
                player=_to_string(sub.get("in_player") or sub.get("player_in") or sub.get("player")),
                assist=_to_string(sub.get("out_player") or sub.get("player_out")),
            )
        )

    # Fallback timeline entries (comments, timeline arrays, etc.)
    fallback = _build_fallback_timeline(event)
    if fallback:
        seen = { _timeline_key(item) for item in items }
        for extra in fallback:
            key = _timeline_key(extra)
            if key not in seen:
                items.append(extra)
                seen.add(key)

    if not any(item.type == "ht" for item in items):
        items.append(TimelineItem(minute=45, team="home", type="ht"))
    if not any(item.type == "ft" for item in items):
        items.append(TimelineItem(minute=90, team="home", type="ft"))

    items.sort(key=lambda it: (it.minute, _score_rank(it.type)))
    return items


def _as_records(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    return []


def _timeline_key(item: TimelineItem) -> Tuple[Any, ...]:
    return (
        item.minute,
        item.type,
        item.team,
        item.player or "",
        item.assist or "",
    )


def _score_rank(event_type: str) -> int:
    if event_type == "ht":
        return -1
    if event_type == "ft":
        return 999
    return 0


def _pick_first(record: Dict[str, Any], keys: Iterable[str]) -> Optional[str]:
    if not isinstance(record, dict):
        return None
    for key in keys:
        val = record.get(key)
        text = _to_string(val)
        if text:
            return text
    return None


def _to_string(value: Any) -> Optional[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
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
    normalized = text.replace("/", "-")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]
    for fmt in formats:
        try:
            parsed = datetime.strptime(normalized, fmt)
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
    upper = text.upper()
    iso_match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", upper)
    if iso_match:
        hours = int(iso_match.group(1) or 0)
        minutes = int(iso_match.group(2) or 0)
        seconds = int(iso_match.group(3) or 0)
        return hours * 3600 + minutes * 60 + seconds
    parts = upper.split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 3:
        hours, minutes, seconds = nums
    elif len(nums) == 2:
        hours = 0
        minutes, seconds = nums
    elif len(nums) == 1:
        hours = 0
        minutes = 0
        seconds = nums[0]
    else:
        return None
    return max(hours * 3600 + minutes * 60 + seconds, 0)


def _normalize_name(name: Optional[str]) -> str:
    if not name:
        return ""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _contains_all_terms(text: str, terms: Iterable[str]) -> bool:
    normalized = _normalize_name(text)
    return all(term in normalized for term in terms if term)


def _to_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() not in {"", "false", "0", "null", "none"}
    return bool(value)


def _to_minute(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        try:
            if value != value or value == float("inf") or value == float("-inf"):
                return 0
        except Exception:
            pass
        return int(round(value))

    raw = str(value).strip()
    if not raw:
        return 0
    if raw.lower() == "ht":
        return 45
    if raw.lower() == "ft":
        return 90

    if "+" in raw:
        base_part, extra_part = raw.split("+", 1)
        base_num = _extract_first_number(base_part)
        extra_num = _extract_first_number(extra_part)
        if base_num is not None:
            return base_num + (extra_num or 0)

    base = _extract_first_number(raw)
    return base or 0


def _extract_first_number(text: str) -> Optional[int]:
    digits = ""
    for ch in text:
        if ch.isdigit():
            digits += ch
        elif digits:
            break
    if not digits:
        return None
    try:
        return int(digits)
    except Exception:
        return None


def _is_home_goal(goal: Dict[str, Any]) -> bool:
    return _to_bool(goal.get("home_scorer")) or (
        str(goal.get("team") or "").lower() == "home"
    ) or (
        str(goal.get("side") or "").lower() == "home"
    ) or _to_bool(goal.get("homeGoal") or goal.get("home"))


def _is_home_card(card: Dict[str, Any]) -> bool:
    return _to_bool(card.get("home_fault")) or (
        str(card.get("team") or "").lower() == "home"
    ) or (
        str(card.get("side") or "").lower() == "home"
    )


def _is_home_sub(sub: Dict[str, Any]) -> bool:
    return (
        _to_bool(sub.get("home"))
        or str(sub.get("team") or "").lower() == "home"
        or str(sub.get("side") or "").lower() == "home"
        or str(sub.get("in_team") or "").lower() == "home"
    )


def _is_red_card(card: Dict[str, Any]) -> bool:
    t = str(card.get("card") or card.get("type") or "").lower()
    return "red" in t


def _goal_type(goal: Dict[str, Any]) -> str:
    if _to_bool(goal.get("own_goal") or goal.get("ownGoal")):
        return "own_goal"
    if _to_bool(goal.get("penalty_missed")):
        return "pen_miss"
    if _to_bool(goal.get("penalty") or goal.get("pen")):
        return "pen_score"
    return "goal"


FALLBACK_KEYS: Tuple[str, ...] = (
    "timeline",
    "timeline_items",
    "events",
    "event_timeline",
    "eventTimeline",
    "event_entries",
    "comments",
    "comments_list",
    "match_comments",
    "play_by_play",
)


def _build_fallback_timeline(source: Dict[str, Any]) -> List[TimelineItem]:
    entries = _gather_candidate_entries(source)
    if not entries:
        return []

    home_name = _pick_team_name(source, [
        "event_home_team",
        "home_team",
        "homeTeam",
        "strHomeTeam",
        "HomeTeam",
    ])
    away_name = _pick_team_name(source, [
        "event_away_team",
        "away_team",
        "awayTeam",
        "strAwayTeam",
        "AwayTeam",
    ])

    items: List[TimelineItem] = []
    for entry in entries:
        minute_raw = (
            entry.get("minute")
            or entry.get("time")
            or entry.get("elapsed")
            or entry.get("min")
            or entry.get("m")
            or entry.get("match_minute")
        )
        minute = _to_minute(minute_raw)
        if minute is None:
            continue
        description = _to_string(
            entry.get("description")
            or entry.get("text")
            or entry.get("event")
            or entry.get("detail")
        )
        tags = _normalize_tag_list(entry, description)
        event_type = _derive_timeline_type(tags, description, entry)
        if not event_type:
            continue
        team = _deduce_team_side(entry, home_name, away_name)
        if not team:
            continue
        player = _to_string(
            entry.get("player")
            or entry.get("player_name")
            or entry.get("playerName")
            or entry.get("player_fullname")
            or entry.get("scorer")
            or entry.get("goal_scorer")
            or entry.get("home_scorer")
            or entry.get("away_scorer")
        )
        if not player and event_type == "sub":
            player = _to_string(entry.get("player_in") or entry.get("in_player") or entry.get("sub_on") or entry.get("sub_in"))

        assist = None
        if event_type in {"goal", "own_goal", "pen_score"}:
            assist = _to_string(entry.get("assist") or entry.get("assist_name") or entry.get("home_assist") or entry.get("away_assist"))
        if event_type == "sub":
            assist = _to_string(entry.get("player_out") or entry.get("out_player") or entry.get("sub_out") or entry.get("out"))

        note = _to_string(
            entry.get("note")
            or entry.get("info")
            or entry.get("reason")
            or entry.get("detail")
            or entry.get("description")
            or entry.get("text")
        )

        items.append(
            TimelineItem(
                minute=minute,
                team=team,
                type=event_type,
                player=player,
                assist=assist,
                note=note,
            )
        )

    return items


def _gather_candidate_entries(source: Dict[str, Any]) -> List[Dict[str, Any]]:
    collected: List[Dict[str, Any]] = []
    for key in FALLBACK_KEYS:
        value = source.get(key)
        if not value:
            continue
        if isinstance(value, list):
            collected.extend([item for item in value if isinstance(item, dict)])
        elif isinstance(value, dict):
            for nested in value.values():
                if isinstance(nested, list):
                    collected.extend([item for item in nested if isinstance(item, dict)])
                elif isinstance(nested, dict):
                    collected.append(nested)
    return collected


def _pick_team_name(source: Dict[str, Any], keys: Iterable[str]) -> Optional[str]:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _normalize_tag_list(entry: Dict[str, Any], description: Optional[str]) -> List[str]:
    tags: List[str] = []
    sources = [
        entry.get("tags"),
        entry.get("labels"),
        entry.get("labels_list"),
        entry.get("predicted_tags"),
        entry.get("predictedTags"),
        entry.get("card"),
        entry.get("type"),
        entry.get("event_type"),
    ]
    for src in sources:
        if src is None:
            continue
        if isinstance(src, list):
            for item in src:
                s = _to_string(item)
                if s:
                    tags.append(s.lower())
            continue
        if isinstance(src, str):
            parts = [part.strip().lower() for part in src.replace("|", ",").replace("/", ",").split(",") if part.strip()]
            tags.extend(parts)
            continue
        if isinstance(src, dict):
            label = _to_string(src.get("label") or src.get("name") or src.get("text"))
            if label:
                tags.append(label.lower())

    if not tags and description:
        tags.extend(_detect_tags_from_text(description))

    seen = set()
    deduped: List[str] = []
    for tag in tags:
        key = tag.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(tag)
    return deduped


def _detect_tags_from_text(text: str) -> List[str]:
    lower = text.lower()
    tags = set()
    if "own goal" in lower:
        tags.add("own goal")
    if "penalty" in lower and "miss" in lower:
        tags.add("penalty miss")
    if "penalty" in lower:
        tags.add("penalty")
    if any(word in lower for word in [" goal", "scores", "scored", "header"]):
        tags.add("goal")
    if "red card" in lower or "sent off" in lower:
        tags.add("red card")
    if "yellow card" in lower:
        tags.add("yellow card")
    if any(word in lower for word in ["substitution", "subbed", "replaces"]):
        tags.add("substitution")
    return list(tags)


def _derive_timeline_type(
    tags: List[str],
    description: Optional[str],
    entry: Dict[str, Any],
) -> Optional[str]:
    tag_text = " ".join(tags)
    desc = (description or "").lower()
    type_field = str(entry.get("type") or entry.get("event_type") or "").lower()

    def has(needle: str) -> bool:
        return needle in tag_text or needle in desc or needle in type_field

    if has("own goal"):
        return "own_goal"
    if has("penalty miss") or has("pen miss") or has("penalty saved"):
        return "pen_miss"
    if has("penalty") and has("goal"):
        return "pen_score"
    if has("goal") or _to_bool(entry.get("goal")) or _to_bool(entry.get("is_goal")):
        return "goal"
    if has("red card") or has("sent off") or has("redcard") or _to_bool(entry.get("red_card")):
        return "red"
    if has("yellow card") or has("yellowcard") or _to_bool(entry.get("yellow_card")):
        return "yellow"
    if has("substitution") or has("subbed") or has("replaced") or _to_bool(entry.get("substitution")):
        return "sub"
    return None


def _deduce_team_side(entry: Dict[str, Any], home_name: Optional[str], away_name: Optional[str]) -> Optional[str]:
    def normalize(name: Optional[str]) -> str:
        if not name:
            return ""
        return " ".join("".join(ch for ch in name.lower() if ch.isalnum() or ch.isspace()).split())

    home_norm = normalize(home_name)
    away_norm = normalize(away_name)

    team_field = _to_string(
        entry.get("team")
        or entry.get("team_name")
        or entry.get("teamName")
        or entry.get("club")
        or entry.get("squad")
        or entry.get("competitor")
    )
    side_field = _to_string(entry.get("side") or entry.get("team_side") or entry.get("teamSide"))
    combined = normalize(team_field or side_field)

    if combined:
        if combined == "home" or "home" in combined:
            return "home"
        if combined == "away" or "away" in combined:
            return "away"
        if home_norm and combined == home_norm:
            return "home"
        if away_norm and combined == away_norm:
            return "away"
        if home_norm and home_norm in combined:
            return "home"
        if away_norm and away_norm in combined:
            return "away"

    if _to_bool(entry.get("home")) or _to_bool(entry.get("is_home")) or _to_bool(entry.get("homeTeam")) or _to_bool(entry.get("home_side")):
        return "home"
    if _to_bool(entry.get("away")) or _to_bool(entry.get("is_away")) or _to_bool(entry.get("awayTeam")) or _to_bool(entry.get("away_side")):
        return "away"

    if any(key in entry for key in ("home_scorer", "home_fault", "home_player")) or entry.get("in_team") == "home" or entry.get("team") == "home":
        return "home"
    if any(key in entry for key in ("away_scorer", "away_fault", "away_player")) or entry.get("in_team") == "away" or entry.get("team") == "away":
        return "away"

    player_team = _to_string(entry.get("player_team") or entry.get("team_name") or entry.get("teamName"))
    player_norm = normalize(player_team)
    if player_norm:
        if home_norm and home_norm in player_norm:
            return "home"
        if away_norm and away_norm in player_norm:
            return "away"

    note = _to_string(entry.get("note") or entry.get("description") or entry.get("text"))
    if note:
        note_norm = note.lower()
        if home_norm and home_norm in note_norm:
            return "home"
        if away_norm and away_norm in note_norm:
            return "away"

    return None
