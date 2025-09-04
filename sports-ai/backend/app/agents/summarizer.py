# summarizer_service.py
from __future__ import annotations

import os
import uuid
import asyncio
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# -----------------------
# Config / Env
# -----------------------
AGENT_MODE = os.getenv("AGENT_MODE", "local")  # "local" or "http"
# If AGENT_MODE="http", set these to the microservice URLs for your agents
TSDB_AGENT_URL = os.getenv("TSDB_AGENT_URL", "http://localhost:8000/agent")
ALLSPORTS_AGENT_URL = os.getenv("ALLSPORTS_AGENT_URL", "http://localhost:8000/agent")

# LLM (Groq)
try:
    from groq import Groq
except Exception:
    Groq = None

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.35"))

# Optional: import your agents for local mode (robust to different import roots)
CollectorAgentV2 = None
AllSportsRawAgent = None
if AGENT_MODE == "local":
    try:
        # Prefer relative imports when running inside the package
        from .collector import CollectorAgentV2 as _Collector
        from .game_analytics_agent import AllSportsRawAgent as _Raw
        CollectorAgentV2 = _Collector
        AllSportsRawAgent = _Raw
    except Exception:
        try:
            # Fallback to absolute package path
            from backend.app.agents.collector import CollectorAgentV2 as _Collector2
            from backend.app.agents.game_analytics_agent import AllSportsRawAgent as _Raw2
            CollectorAgentV2 = _Collector2
            AllSportsRawAgent = _Raw2
        except Exception:
            # Final fallback: leave as None so HTTP mode will be used
            pass

import httpx

app = FastAPI(title="Summarizer Agent", version="2.0")
# Enable CORS (same policy as main app) so frontend on other origins can call this mounted sub-app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------
# Models
# -----------------------
class SummarizeRequest(BaseModel):
    # Identify the match
    eventId: Optional[str] = None
    eventName: Optional[str] = None
    date: Optional[str] = None            # YYYY-MM-DD (optional disambiguation)
    season: Optional[str] = None          # e.g., "2024-2025"
    provider: str = Field(default="auto", pattern="^(auto|tsdb|allsports)$")
    # Options
    timezone: Optional[str] = None
    idempotency_key: Optional[str] = None
    trace_id: Optional[str] = None


class SummaryOut(BaseModel):
    ok: bool
    headline: str
    one_paragraph: str
    bullets: List[str]
    key_events: List[Dict[str, Any]]
    star_performers: List[Dict[str, Any]]
    numbers: Dict[str, Any]
    source_meta: Dict[str, Any]


# Lightweight event-brief schemas
class EventBriefItemIn(BaseModel):
    minute: Optional[str] = None
    type: Optional[str] = None  # goal | substitution | yellow card | red card | etc
    description: Optional[str] = None
    player: Optional[str] = None
    team: Optional[str] = None
    tags: Optional[List[str]] = None

class EventBriefsRequest(BaseModel):
    # Optional match context (not required)
    eventId: Optional[str] = None
    eventName: Optional[str] = None
    date: Optional[str] = None
    provider: str = Field(default="auto", pattern="^(auto|tsdb|allsports)$")
    events: List[EventBriefItemIn]

class EventBriefItemOut(BaseModel):
    minute: Optional[str] = None
    type: Optional[str] = None
    brief: str

class EventBriefsOut(BaseModel):
    ok: bool
    items: List[EventBriefItemOut]


# -----------------------
# Utilities
# -----------------------
def new_trace_id() -> str:
    return f"tr_{uuid.uuid4().hex[:12]}"

def _short(s: str | None, n: int = 120) -> str:
    if not s:
        return ""
    return s if len(s) <= n else s[: n - 1] + "…"
# ⬇️ ADD THESE HELPERS RIGHT AFTER _short(...)
def word_count(s: str | None) -> int:
    return len((s or "").strip().split())

def _minute_of_first_goal(timeline: list[dict]) -> str | None:
    mins = []
    for ev in (timeline or []):
        kind = (ev.get("type") or ev.get("event") or ev.get("card") or "").lower()
        is_goal = (
            "goal" in kind
            or kind in {"g", "scorer", "score"}
            or bool(ev.get("home_scorer"))
            or bool(ev.get("away_scorer"))
        )
        if is_goal:
            m = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
            if m:
                mins.append(str(m).strip("′ '"))
    return mins[0] if mins else None

def _minute_of_equalizer(score_home: int | None, score_away: int | None, timeline: list[dict]) -> str | None:
    if score_home is None or score_away is None:
        return None
    h, a = 0, 0
    for ev in (timeline or []):
        kind = (ev.get("type") or ev.get("event") or "").lower()
        is_goal = (
            "goal" in kind
            or kind in {"g", "scorer", "score"}
            or bool(ev.get("home_scorer"))
            or bool(ev.get("away_scorer"))
        )
        if is_goal:
            side = (ev.get("team") or ev.get("side") or "").lower()
            # Infer side for AllSports shapes
            if not side:
                if ev.get("home_scorer") or ev.get("home_fault"): side = "home"
                elif ev.get("away_scorer") or ev.get("away_fault"): side = "away"
            if not side and ev.get("score"):
                try:
                    parts = [int(x) for x in str(ev["score"]).replace("-", " ").split() if x.isdigit()]
                    if len(parts) == 2:
                        h, a = parts[0], parts[1]
                except Exception:
                    pass
            else:
                if "home" in side: h += 1
                elif "away" in side: a += 1
            if h == a and h > 0:
                m = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
                return str(m).strip("′ '") if m else None
    return None


def _is_live_status(status: str | None) -> bool | None:
    s = (status or "").strip().lower()
    if not s:
        return None
    # Finished keywords (TSDB/AllSports variants)
    finished_keys = ["ft", "full", "finished", "match finished", "ended", "aet", "pen", "after extra time"]
    if any(k in s for k in finished_keys):
        return False
    # AllSports often uses numeric minutes or HT, 1st Half, etc.
    live_keys = ["live", "1st", "2nd", "half", "ht", "paused", "extra time", "stoppage"]
    if any(k in s for k in live_keys):
        return True
    # Pure number like "89" -> in-progress minute
    if s.isdigit():
        try:
            m = int(s)
            if 0 < m <= 140:
                return True
        except Exception:
            pass
    # Not started / scheduled
    ns_keys = ["ns", "not started", "scheduled", "postp", "postponed"]
    if any(k in s for k in ns_keys):
        return None
    return None


def _latest_minute(timeline: list[dict]) -> str | None:
    for ev in reversed(timeline or []):
        m = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
        if m:
            return str(m).strip("′ '")
    return None


async def _llm_event_briefs(context: Dict[str, Any], events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generate descriptive per-event briefs (1–3 sentences) for key timeline events.
    Uses Groq when available with compact, structured prompting; otherwise
    falls back to deterministic templates. Output is a list aligned to the
    input order with minute, type, and brief fields.
    """
    # Fallback path (no LLM configured)
    if Groq is None or not GROQ_API_KEY:
        out: List[Dict[str, Any]] = []
        for ev in events:
            t = (ev.get("type") or "").lower()
            minute = ev.get("minute") or ev.get("time")
            player = ev.get("player") or ev.get("home_scorer") or ev.get("away_scorer")
            team = ev.get("team") or ""
            desc = ev.get("description") or ev.get("text") or ev.get("event") or ""
            brief = desc or f"{t.title()} at {minute or '?'} by {player or 'unknown'} {('('+team+')') if team else ''}".strip()
            out.append({"minute": minute, "type": t or None, "brief": brief})
        return out

    # Prepare compact, context-aware prompt
    teams = context.get("teams") or {}
    score = context.get("score") or {}
    comp = context.get("competition") or ""
    header = f"{teams.get('home','')} vs {teams.get('away','')} — {comp} — score {score.get('home')}–{score.get('away')}"
    lines = []
    idx_map = []
    for i, ev in enumerate(events):
        minute = ev.get("minute") or ev.get("time") or ""
        kind = ev.get("type") or ev.get("event") or ev.get("card") or ev.get("info") or ""
        who = (
            ev.get("player")
            or ev.get("player_name")
            or ev.get("home_scorer")
            or ev.get("away_scorer")
            or ev.get("fault")
            or ""
        )
        team = ev.get("team") or ev.get("side") or ""
        sub_on = ev.get("in_player") or ev.get("substitution") or ""
        sub_off = ev.get("out_player") or ""
        note = ev.get("assist") or ev.get("score") or ev.get("result") or ev.get("description") or ""
        extra = (f" | team={team}" if team else "") + (f" | in={sub_on} out={sub_off}" if (sub_on or sub_off) else "")
        line = f"[{i}] {(str(minute)+'\u2032 ') if minute else ''}{kind}: {who} {note}{extra}".strip()
        if len(line) > 150:
            line = line[:149] + "…"
        lines.append(line)
        idx_map.append(i)

    system = (
        "You are an insightful football analyst. For each event, write a clear, vivid brief in 1–3 sentences (aim 25–65 words). "
        "Be strictly factual and use only provided data. Mention the minute, player and team when available. "
        "For goals, clarify whether it opens the scoring, levels the match, or changes the lead if score info is present. "
        "For cards, state impact (e.g., team down to 10 for reds). For substitutions, note the like-for-like or tactical feel only if implied (no guessing)."
    )
    user = (
        header
        + "\nEvents:\n- "
        + ("\n- ".join(lines) if lines else "None")
        + "\n\nRespond ONLY as a JSON object with key 'items' containing an array of objects: "
        + "{\"items\":[{\"index\":number,\"brief\":string}, ...]}."
    )

    client = Groq(api_key=GROQ_API_KEY)
    import json
    try:
        chat = await asyncio.to_thread(
            client.chat.completions.create,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            model=GROQ_MODEL,
            temperature=min(LLM_TEMPERATURE, 0.35),
            response_format={"type": "json_object"},
            max_tokens=800,
        )
        raw = chat.choices[0].message.content
        # Expect an object like {"items":[{"index":0,"brief":"..."}, ...]} (prefer object to satisfy JSON mode)
        parsed = json.loads(raw)
        items = parsed.get("items") if isinstance(parsed, dict) else parsed
        out: List[Dict[str, Any]] = []
        if isinstance(items, list):
            for it in items:
                try:
                    i = it.get("index") if isinstance(it, dict) else None
                    brief = it.get("brief") if isinstance(it, dict) else None
                    if isinstance(i, int) and isinstance(brief, str):
                        ev = events[i] if 0 <= i < len(events) else {}
                        out.append({
                            "minute": ev.get("minute") or ev.get("time"),
                            "type": (ev.get("type") or ev.get("event") or ev.get("card") or "").lower() or None,
                            "brief": brief.strip(),
                        })
                except Exception:
                    continue
        if out:
            return out
    except Exception:
        # fall through to templates
        pass

    # Fallback template summaries (more descriptive)
    templated: List[Dict[str, Any]] = []
    for ev in events:
        t = (ev.get("type") or ev.get("event") or ev.get("card") or "").lower()
        minute = ev.get("minute") or ev.get("time")
        player = ev.get("player") or ev.get("home_scorer") or ev.get("away_scorer") or ev.get("player_name")
        team = ev.get("team") or ev.get("side") or ""
        score_note = (ev.get("score") or "").strip()
        assist = (ev.get("assist") or "").strip()
        if t.startswith("goal") or t == "goal":
            parts = []
            who = player or "Unknown scorer"
            when = f"{minute or '?'}′"
            parts.append(f"{who} strikes at {when}{(' for '+team) if team else ''}")
            if assist:
                parts.append(f"after an assist from {assist}")
            if score_note:
                parts.append(f"({score_note})")
            brief = ". ".join([" ".join(parts), "A decisive moment that shifts the momentum."]).strip()
        elif "yellow" in t:
            who = player or "Unknown player"
            when = f"{minute or '?'}′"
            brief = f"{who}{(' ('+team+')') if team else ''} is booked at {when}. The caution tempers challenges and forces greater discipline.".strip()
        elif "red" in t:
            who = player or "Unknown player"
            when = f"{minute or '?'}′"
            brief = f"{who}{(' ('+team+')') if team else ''} is sent off at {when}, leaving the side a player short and changing the dynamic of the match.".strip()
        elif "substitution" in t or t == "sub":
            desc = ev.get("description")
            in_p = ev.get("in_player") or ev.get("substitution")
            out_p = ev.get("out_player")
            if desc:
                brief = desc
            else:
                who = (f"{in_p} for {out_p}" if (in_p or out_p) else "Change made")
                when = f"{minute or '?'}′"
                brief = f"Substitution at {when}{(' for '+team) if team else ''}: {who}. Fresh legs to alter the tempo.".strip()
        else:
            base = ev.get("description") or (t.title() if t else "Event")
            when = f"{minute or '?'}′"
            brief = f"{base} around {when}{(' ('+team+')') if team else ''}.".strip()
        templated.append({"minute": minute, "type": t or None, "brief": brief})
    return templated


# -----------------------
# Low-level agent callers
# -----------------------
async def call_tsdb_agent(payload: Dict[str, Any], trace: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Call CollectorAgentV2 either locally or via HTTP."""
    trace.append({"step": "call_tsdb_agent", "mode": AGENT_MODE, "intent": payload.get("intent")})
    if AGENT_MODE == "local":
        if not CollectorAgentV2:
            return {"ok": False, "error": {"code": "NO_LOCAL_TSDB", "message": "CollectorAgentV2 not importable"}}
        agent = CollectorAgentV2()
        return agent.handle(payload)
    else:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(TSDB_AGENT_URL, json=payload)
            return r.json()

async def call_allsports_agent(payload: Dict[str, Any], trace: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Call AllSportsRawAgent either locally or via HTTP."""
    trace.append({"step": "call_allsports_agent", "mode": AGENT_MODE, "intent": payload.get("intent")})
    if AGENT_MODE == "local":
        if not AllSportsRawAgent:
            return {"ok": False, "error": {"code": "NO_LOCAL_ASRAW", "message": "AllSportsRawAgent not importable"}}
        agent = AllSportsRawAgent()
        return agent.handle(payload)
    else:
        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(ALLSPORTS_AGENT_URL, json=payload)
            return r.json()


# -----------------------
# Normalizers (minimal, safe)
# These convert TSDB/AllSports raw-ish payloads into a tiny internal shape
# for prompting: teams, score, venue, date, competition, timeline, stats, lineup.
# -----------------------
def norm_tsdb_event(bundle: Dict[str, Any]) -> Dict[str, Any]:
    """
    bundle = data from CollectorAgentV2 event.get:
    {
      "event": {...},                       # (picked candidate if uniquely resolved)
      "candidates": [...],                  # for transparency
      "timeline": [...], "stats": [...], "lineup": [...]
    }
    """
    ev = (bundle or {}).get("event") or {}
    # Basic keys often present in TSDB event objects
    home = ev.get("strHomeTeam") or ev.get("strHomeTeamBadge") or ""
    away = ev.get("strAwayTeam") or ev.get("strAwayTeamBadge") or ""
    hs = ev.get("intHomeScore") or ev.get("intHomeScoreFT") or ev.get("intHomeGoal") or None
    as_ = ev.get("intAwayScore") or ev.get("intAwayScoreFT") or ev.get("intAwayGoal") or None
    comp = ev.get("strLeague") or ""
    round_ = ev.get("intRound") or ev.get("strRound") or ""
    venue = ev.get("strVenue") or ""
    date = ev.get("dateEventLocal") or ev.get("dateEvent") or ev.get("strTimestamp") or ""
    time_local = ev.get("strTimeLocal") or ev.get("strTime") or ""
    status = ev.get("strStatus") or ev.get("strProgress") or ""

    # Coerce provider expansions to lists (TSDB returns "Patreon Only" string for timeline without paid key)
    raw_tl = (bundle or {}).get("timeline") or []
    raw_stats = (bundle or {}).get("stats") or []
    raw_lineup = (bundle or {}).get("lineup") or []
    tl_list = raw_tl if isinstance(raw_tl, list) else []
    stats_list = raw_stats if isinstance(raw_stats, list) else []
    lineup_list = raw_lineup if isinstance(raw_lineup, list) else []

    return {
        "provider": "tsdb",
        "teams": {"home": home, "away": away},
        "score": {"home": _safe_int(hs), "away": _safe_int(as_)},
        "competition": comp,
        "round": round_,
        "venue": venue,
        "date": date,
        "time_local": time_local,
        "status": status,
        "event_id": ev.get("idEvent"),
        "timeline": tl_list,
        "stats": stats_list,
        "lineup": lineup_list,
        "raw_event": ev,
    }

def norm_allsports_event(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    raw = AllSportsRawAgent event.get response:
      {"data": { "success":1, "result":[{...match...}] }, ...}
    We'll pick the first result if present.
    """
    body = (raw or {}).get("data") or {}
    result = None
    if isinstance(body, dict):
        items = body.get("result") or body.get("result_prev") or []
        if isinstance(items, list) and items:
            result = items[0]
    ev = result or {}

    # AllSports field names (typical)
    home = ev.get("event_home_team") or ev.get("home_team") or ""
    away = ev.get("event_away_team") or ev.get("away_team") or ""
    hs = ev.get("event_final_result", "").split("-")[0].strip() if ev.get("event_final_result") else ev.get("home_score")
    as_ = ev.get("event_final_result", "").split("-")[1].strip() if ev.get("event_final_result") else ev.get("away_score")
    comp = ev.get("league_name") or ""
    # Venue appears under various keys across providers; check multiple
    venue = (
        ev.get("stadium")
        or ev.get("venue")
        or ev.get("event_stadium")
        or ev.get("event_venue")
        or ev.get("stadium_name")
        or ev.get("venue_name")
        or ev.get("match_stadium")
        or ""
    )
    date = ev.get("event_date") or ev.get("event_date_start") or ev.get("match_date") or ""
    time_local = ev.get("event_time") or ev.get("match_time") or ""
    status = ev.get("event_status") or ev.get("match_status") or ""

    # Best-effort timeline: provider sometimes returns goals/cards under events keys
    # We'll check a few common places
    timeline = ev.get("goalscorers") or ev.get("cards") or ev.get("substitutes") or []
    # Some providers expose a flat timeline list under 'events' or 'timeline'
    if not timeline:
        timeline = ev.get("events") or ev.get("timeline") or []

    return {
        "provider": "allsports",
        "teams": {"home": home, "away": away},
        "score": {"home": _safe_int(hs), "away": _safe_int(as_)},
        "competition": comp,
        "round": ev.get("league_round") or ev.get("round") or "",
        "venue": venue,
        "date": date,
        "time_local": time_local,
        "status": status,
        "event_id": ev.get("match_id") or ev.get("event_key") or ev.get("id"),
        "timeline": timeline,
        "stats": ev.get("statistics") or ev.get("match_statistics") or [],
        "lineup": ev.get("lineups") or ev.get("lineup") or [],
        "raw_event": ev,
    }

def _safe_int(x: Any) -> Optional[int]:
    try:
        if x is None or x == "":
            return None
        return int(str(x).strip())
    except Exception:
        return None


# -----------------------
# Orchestration
# -----------------------
async def fetch_event_bundle(req: SummarizeRequest, trace: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], str, Dict[str, Any]]:
    """
    Return (normalized, provider_used, raw_sources)
    Strategy:
      - If provider=="tsdb" → TSDB only
      - If provider=="allsports" → AllSports only
      - If "auto" → try TSDB (with expansions), if too thin → consult AllSports
    """
    raw_sources: Dict[str, Any] = {"tsdb": None, "allsports": None}

    # 1) Try TSDB
    if req.provider in ("auto", "tsdb"):
        args = {}
        if req.eventName:
            args["eventName"] = req.eventName
        if req.eventId:
            args["eventId"] = req.eventId
        if req.season:
            args["season"] = req.season
        if req.date:
            args["dateEvent"] = req.date
        args["expand"] = ["timeline", "stats", "lineup"]

        tsdb_payload = {"intent": "event.get", "args": args}
        tsdb = await call_tsdb_agent(tsdb_payload, trace)
        raw_sources["tsdb"] = tsdb

        if tsdb.get("ok"):
            data = tsdb.get("data") or {}
            # If TSDB successfully picked an event (data.event exists) or at least one candidate and expansions
            if (data.get("event") or (data.get("candidates") and len(data.get("candidates")) == 1)):
                norm = norm_tsdb_event(data)
                # If score or timeline look empty and provider is auto, we may still consult AllSports
                if req.provider == "auto":
                    if not norm["score"]["home"] and not norm["score"]["away"] and not norm["timeline"]:
                        trace.append({"step": "tsdb_thin_data_consult_allsports"})
                    else:
                        return norm, "tsdb", raw_sources
                else:
                    return norm, "tsdb", raw_sources

    # 2) Try AllSports
    if req.provider in ("auto", "allsports"):
        as_args = {}
        if req.eventId:     # in AllSports this is usually 'matchId' but your RawAgent maps eventId -> matchId
            as_args["eventId"] = req.eventId
        if req.eventName:
            # RawAgent doesn't require name for event.get, but we can try fixtures.list if you want name-based
            pass
        as_payload = {"intent": "event.get", "args": as_args}
        allsports = await call_allsports_agent(as_payload, trace)
        raw_sources["allsports"] = allsports
        if allsports.get("ok"):
            norm = norm_allsports_event(allsports)
            # If venue missing, try to fill from TSDB event (if we queried it already)
            if (not norm.get("venue")) and (raw_sources.get("tsdb") or {}).get("ok"):
                tsdb_data = (raw_sources["tsdb"].get("data") or {})
                tsdb_event = (tsdb_data.get("event") or {})
                venue_tsdb = tsdb_event.get("strVenue")
                if venue_tsdb:
                    norm["venue"] = venue_tsdb
            # If still super thin and we had TSDB candidates, keep TSDB as provider
            if norm["teams"]["home"] or norm["teams"]["away"]:
                return norm, "allsports", raw_sources

    return None, "none", raw_sources


async def enrich_missing_venue(bundle: Dict[str, Any], req: SummarizeRequest, trace: List[Dict[str, Any]]) -> Dict[str, Any]:
    """If venue is empty, attempt to resolve via TSDB venue.get using eventName/eventId."""
    if (bundle.get("venue") or "").strip():
        return bundle

    # Best-effort event name
    ev_name = (req.eventName or "").strip()
    if not ev_name:
        raw = bundle.get("raw_event") or {}
        ev_name = (
            raw.get("strEvent")
            or raw.get("strEventAlternate")
            or (f"{raw.get('event_home_team')} vs {raw.get('event_away_team')}" if raw.get('event_home_team') or raw.get('event_away_team') else "")
        ) or ""

    # Build args; CollectorAgentV2.venue.get requires venueId or eventName (+optional eventId)
    args = {}
    if ev_name:
        args["eventName"] = ev_name
    if req.eventId:
        args["eventId"] = req.eventId
    if not args:
        return bundle

    try:
        resp = await call_tsdb_agent({"intent": "venue.get", "args": args}, trace)
        if resp.get("ok"):
            data = resp.get("data") or {}
            ven = (data.get("venue") or {})
            name = ven.get("strVenue") or ven.get("strStadium") or ven.get("strName")
            if name:
                bundle = dict(bundle)
                bundle["venue"] = name
    except Exception:
        pass
    return bundle


def build_llm_prompt(bundle: Dict[str, Any]) -> Tuple[str, str]:
    """Return (system, user) prompts for the LLM with stronger guidance; adapts if match is live."""
    teams = bundle["teams"]
    score = bundle["score"]
    comp = bundle["competition"]
    venue = bundle["venue"]
    date = bundle["date"]
    time_local = bundle["time_local"]
    status = bundle["status"]
    timeline = bundle["timeline"]
    stats = bundle["stats"]
    lineup = bundle["lineup"]

    is_live = _is_live_status(status)
    last_min = _latest_minute(timeline)
    system = (
        "You are an elite football match reporter. Use ONLY the provided data; never invent names or stats. "
        "Write precise, vivid, factual prose that highlights momentum, turning points, and context. "
        f"The one_paragraph MUST be between 300 and 400 words."
    )

    # Build timeline bullets (stringified) — include AllSports fields (trim to keep prompt small)
    tl_lines = []
    for ev in (timeline or []):
        minute = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
        # Determine event type and player across providers
        kind = (ev.get("type") or ev.get("event") or ev.get("card") or ev.get("info") or ev.get("event_type") or "").strip()
        # AllSports goal/career fields
        scorer = ev.get("player") or ev.get("player_name") or ev.get("scorer") or ev.get("home_scorer") or ev.get("away_scorer")
        # Cards sometimes in home_fault/away_fault
        fault = ev.get("home_fault") or ev.get("away_fault")
        sub_on = ev.get("substitution") or ev.get("in_player")
        sub_off = ev.get("out_player")
        who = scorer or fault or sub_on or sub_off
        note = ev.get("assist") or ev.get("score") or ev.get("result") or ev.get("info_time") or ""
        # If type is missing but we can infer
        if not kind:
            if ev.get("home_scorer") or ev.get("away_scorer") or ev.get("scorer"):
                kind = "Goal"
            elif ev.get("card"):
                kind = str(ev.get("card"))
            elif sub_on or sub_off:
                kind = "Substitution"
        line = f"{(str(minute)+'′ ') if minute else ''}{kind} — {(who or 'Unknown').strip()} {(note or '').strip()}".strip()
        # hard-cap each line to ~180 chars to reduce token bloat
        if len(line) > 180:
            line = line[:179] + "…"
        tl_lines.append(line)

    # Trim very long timelines: keep first 48 and last 12 (if many) to capture opening + decisive late events
    if len(tl_lines) > 60:
        tl_lines = tl_lines[:48] + ["… (timeline truncated) …"] + tl_lines[-12:]

    # Primary stats (TSDB often [{"strStat","intHome","intAway"}])
    stats_pairs = []
    if isinstance(stats, list):
        for st in stats[:12]:
            name = st.get("strStat") or st.get("type") or st.get("name")
            h = st.get("intHome") or st.get("home") or st.get("home_value")
            a = st.get("intAway") or st.get("away") or st.get("away_value")
            if name and (h is not None or a is not None):
                stats_pairs.append(f"{name}: {h}-{a}")
    stats_hint = " | ".join(stats_pairs) if stats_pairs else "None"

    # Story hints derived from data to encourage richer detail (still non-hallucinatory)
    first_goal_min = _minute_of_first_goal(timeline)
    eq_min = _minute_of_equalizer(score.get("home"), score.get("away"), timeline)
    flow_hint = []
    if first_goal_min:
        flow_hint.append(f"Opening goal around {first_goal_min}′.")
    if eq_min:
        flow_hint.append(f"Equalizer around {eq_min}′.")
    if not flow_hint and (score.get("home") is not None and score.get("away") is not None):
        flow_hint.append("Scoreline changes inferred from final score; exact minutes not fully available.")

    header = "Final Score" if is_live is False else ("Current Score" if is_live else "Score")
    live_line = "Live update — do not assume final result" if is_live else ("Not started" if is_live is None and not timeline else "")

    user = f"""
Match: {teams.get('home','')} vs {teams.get('away','')}
{header}: {score.get('home')}–{score.get('away')}
Competition/Stage: {comp}
Venue: {venue or 'Unknown'}
Date/Time: {date or 'Unknown'} {time_local or ''}
Status: {status or 'Unknown'}{(' | ' + live_line) if live_line else ''}
Latest minute seen: {last_min or 'n/a'}

Timeline (minute • event • player • note):
- """ + ("\n- ".join(tl_lines) if tl_lines else "None") + """

Key stats (home-away):
""" + stats_hint + """

Story hints:
- """ + ("\n- ".join(flow_hint) if flow_hint else "None") + """

Write JSON only with keys:
headline (short), one_paragraph (single paragraph, """ \
+ f"""300-400 words, include: {'current state and likely themes so far' if is_live else 'result'}; phases (first half vs second half) when supported by data; minutes for the opening goal and equalizer if present; how momentum changed; any notable absences of data like venue/stats),""" \
+ """ bullets (3-6 crisp points), key_events (minute,type,player,note), star_performers (name,reason), numbers (home_score,away_score).

Rules:
- If a data point (scorer, venue, stats) is missing, explicitly note that it was not provided; do not guess.
- If the match is live, DO NOT write as if it has finished; clearly frame as a live update based on current score and minute.
- Prefer concrete minutes and competition context when available.
- Keep language active and specific; avoid clichés.
"""
    return system, user



async def run_llm(system: str, user: str) -> Dict[str, Any]:
    """Call Groq LLM to produce structured JSON, enforcing longer one_paragraph with a single retry if needed."""
    if Groq is None or not GROQ_API_KEY:
        return {
            "headline": "Match Report Unavailable",
            "one_paragraph": "LLM is not configured. Set GROQ_API_KEY.",
            "bullets": [],
            "key_events": [],
            "star_performers": [],
            "numbers": {},
        }

    client = Groq(api_key=GROQ_API_KEY)

    def _content():
        schema_hint = f"""Respond ONLY in JSON with keys:
{{
  "headline": str,
  "one_paragraph": str,   // MUST be between 300-400 words, single paragraph
  "bullets": [str, ...],  // 3-6 items
  "key_events": [{{"minute": str, "type": str, "player": str, "note": str}}, ...],
  "star_performers": [{{"name": str, "reason": str}}, ...],
  "numbers": {{"home_score": int|null, "away_score": int|null}}
}}
Do not add extra fields.
"""
        return schema_hint + "\n\nDATA:\n" + user

    async def _call():
        return await asyncio.to_thread(
            client.chat.completions.create,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": _content()},
            ],
            model=GROQ_MODEL,
            temperature=LLM_TEMPERATURE,
            response_format={"type": "json_object"},
            max_tokens=1200,
        )

    # First try
    import json
    try:
        chat = await _call()
        raw = chat.choices[0].message.content
        try:
            out = json.loads(raw)
        except Exception:
            out = {
                "headline": "Match Report",
                "one_paragraph": (raw or "")[:800],
                "bullets": [],
                "key_events": [],
                "star_performers": [],
                "numbers": {},
            }
    except Exception as e:
        # Fallback gracefully on API errors (e.g., json_validate_failed or token limits)
        return {
            "headline": "Match Report Unavailable",
            "one_paragraph": "The summarization model could not produce a JSON response within limits. Returning a minimal fallback.",
            "bullets": [],
            "key_events": [],
            "star_performers": [],
            "numbers": {},
        }

    # Enforce paragraph length once
    para = out.get("one_paragraph") or ""
    wc = word_count(para)
    if wc < 300 or wc > 400:
        reinforce = (
            system
            + f" The one_paragraph MUST be between 300-400 words. "
              "Preserve facts; do not invent missing data. Expand with momentum and context only from provided info."
        )
        try:
            chat2 = await asyncio.to_thread(
                client.chat.completions.create,
                messages=[
                    {"role": "system", "content": reinforce},
                    {"role": "user", "content": _content()},
                ],
                model=GROQ_MODEL,
                temperature=LLM_TEMPERATURE,
                response_format={"type": "json_object"},
                max_tokens=1200,
            )
            try:
                out = json.loads(chat2.choices[0].message.content)
            except Exception:
                pass  # keep first response if second parse fails
        except Exception:
            # keep first response if second call fails
            pass

    return out


# -----------------------
# FastAPI route
# -----------------------
@app.post("/summarize", response_model=SummaryOut)
async def summarize(req: SummarizeRequest):
    trace: List[Dict[str, Any]] = []
    trace_id = req.trace_id or new_trace_id()
    idempotency_key = req.idempotency_key or trace_id
    trace.append({"trace_id": trace_id, "idempotency_key": idempotency_key})

    # Fetch event bundle from agents
    bundle, provider_used, raw_sources = await fetch_event_bundle(req, trace)
    if not bundle:
        # Build a graceful error response
        src_notes = {
            "tsdb_ok": (raw_sources.get("tsdb") or {}).get("ok"),
            "allsports_ok": (raw_sources.get("allsports") or {}).get("ok"),
            "tsdb_err": (raw_sources.get("tsdb") or {}).get("error"),
            "allsports_err": (raw_sources.get("allsports") or {}).get("error"),
        }
        raise HTTPException(
            status_code=404,
            detail={"reason": "Event not found or too little data to summarize", "sources": src_notes, "trace": trace},
        )

    # Enrich missing venue via TSDB if possible
    bundle = await enrich_missing_venue(bundle, req, trace)

    # Prompt LLM
    system, user = build_llm_prompt(bundle)
    llm_out = await run_llm(system, user)

    # Assemble final shape
    summary = {
        "ok": True,
        "headline": llm_out.get("headline") or "Match Report",
        "one_paragraph": llm_out.get("one_paragraph") or "",
        "bullets": llm_out.get("bullets") or [],
        "key_events": llm_out.get("key_events") or [],
        "star_performers": llm_out.get("star_performers") or [],
        "numbers": llm_out.get("numbers") or {
            "home_score": bundle["score"]["home"],
            "away_score": bundle["score"]["away"],
        },
        "source_meta": {
            "provider_used": provider_used,
            "bundle": {
                "teams": bundle["teams"],
                "score": bundle["score"],
                "competition": bundle["competition"],
                "venue": bundle["venue"],
                "date": bundle["date"],
                "time_local": bundle["time_local"],
                "status": bundle["status"],
                "event_id": bundle["event_id"],
            },
            "trace": trace,
            "raw_peek": {
                "tsdb_head": _short(str(raw_sources.get("tsdb"))[:800]),
                "allsports_head": _short(str(raw_sources.get("allsports"))[:800]),
            },
        },
    }
    return summary


@app.post("/summarize/events", response_model=EventBriefsOut)
async def summarize_events(req: EventBriefsRequest):
    """Summarize a list of timeline events (goals/cards/substitutions) into short natural-language briefs.
    This does not fetch provider data; it uses the given events and optional context only.
    """
    # minimal context for better phrasing (optional)
    context = {
        "teams": {},
        "score": {},
        "competition": "",
    }
    # Attempt a tiny provider lookup to enrich context if eventId provided, but keep fully optional
    # Avoid heavy calls; the LLM prompt stays compact.
    try:
        if req.eventId or req.eventName:
            # Build a thin args for TSDB in local mode when available; ignore errors/timeouts
            args = {}
            if req.eventId:
                args["eventId"] = req.eventId
            if req.eventName:
                args["eventName"] = req.eventName
            if req.date:
                args["dateEvent"] = req.date
            args["expand"] = []
            payload = {"intent": "event.get", "args": args}
            trace: List[Dict[str, Any]] = []
            tsdb = await call_tsdb_agent(payload, trace)
            if tsdb.get("ok"):
                data = tsdb.get("data") or {}
                norm = norm_tsdb_event({
                    "event": (data.get("event") or (data.get("candidates") or [None])[0] or {})
                })
                context.update({
                    "teams": norm.get("teams") or {},
                    "score": norm.get("score") or {},
                    "competition": norm.get("competition") or "",
                })
    except Exception:
        pass

    # Only accept up to 24 events to keep prompt tight
    events = list(req.events or [])[:24]
    briefs = await _llm_event_briefs(context, events)
    # map back to output items
    items: List[Dict[str, Any]] = []
    for i, b in enumerate(briefs):
        items.append({
            "minute": b.get("minute"),
            "type": b.get("type"),
            "brief": b.get("brief") or "",
        })
    return {"ok": True, "items": items}