"""Highlight timeline agent.

Generates normalized match timeline items from provider payloads so
frontend components can display consistent highlight tracks.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

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
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "intent": intent,
        "args_resolved": args or {},
        "data": data if ok else None,
        "error": None if ok else (error or "Unknown error"),
        "meta": {
            "source": {"primary": "highlight", "fallback": fallback},
            "trace": trace or [],
        },
    }


class HighlightAgent:
    """Builds highlight-friendly timelines from provider data."""

    SUPPORTED = {"highlight.timeline", "timeline.highlight"}

    def __init__(self, allsports_adapter=None, tsdb_adapter=None, logger=None):
        self.allsports = allsports_adapter
        self.tsdb = tsdb_adapter
        self.log = logger

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

        # Allow callers to supply a pre-fetched event payload to avoid duplicate I/O
        supplied = self._coerce_event_payload(args)
        if supplied:
            trace.append({"step": "payload.supplied", "info": "using provided event payload"})

        event_payload = supplied
        fallback_source: Optional[str] = None

        if not event_payload:
            event_payload, fallback_source, fetch_trace = self._fetch_event_payload(event_id, args)
            trace.extend(fetch_trace)

        if not event_payload:
            return _mkresp(False, intent, {"eventId": event_id}, error="Event payload unavailable", trace=trace)

        timeline = _build_timeline(event_payload)
        if not timeline:
            trace.append({"step": "timeline.empty", "note": "no events extracted"})
            # Ensure HT/FT placeholders when no data at all
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

        return _mkresp(True, intent, {"eventId": event_id}, data=data, trace=trace, fallback=fallback_source)

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


def _to_string(value: Any) -> Optional[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


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
