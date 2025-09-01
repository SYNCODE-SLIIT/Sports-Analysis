# FastAPI summarizer agent with LLM integration
# - Pulls match details from a sports API by match_id
# - Crafts a prompt and asks an LLM for a live or full-time summary
# - No security features (per request)
#
# Usage (local):
#   pip install fastapi uvicorn httpx pydantic openai
#   export OPENAI_API_KEY=sk-...
#   export OPENAI_MODEL=gpt-4o-mini  # or another chat model
#   # Option A: Generic provider via URL template
#   export SPORTS_API_PROVIDER=generic
#   export SPORTS_API_URL_TEMPLATE="https://example.com/matches/{match_id}"  # returns JSON; mapping handled below
#   # Option B: API-Football (example)
#   # export SPORTS_API_PROVIDER=api_football
#   # export APIFOOTBALL_BASE="https://v3.football.api-sports.io"
#   # export APIFOOTBALL_KEY=your_key
#   uvicorn agents.summarizer_llm.main:app --host 0.0.0.0 --port 8003 --reload
#
# Example GET:
#   /summary/{match_id}?mode=live           -> short live snapshot
#   /summary/{match_id}?mode=full           -> fuller post-match summary
#   /debug/raw/{match_id}                   -> raw normalized payload

from __future__ import annotations
import os
from typing import Any, Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime

import httpx
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
from dotenv import load_dotenv
load_dotenv()

# -----------------------
# LLM (Groq)
# -----------------------
try:
    from groq import Groq
except Exception:
    Groq = None

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


class LLM:
    def __init__(self):
        if Groq is None:
            raise RuntimeError("groq package not installed. `pip install groq`.\n")
        if not GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set.")
        self.client = Groq(api_key=GROQ_API_KEY)
        self.model = GROQ_MODEL

    async def summarize(self, system: str, user: str, temperature: float = 0.3) -> str:
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._summarize_sync, system, user, temperature)

    def _summarize_sync(self, system: str, user: str, temperature: float) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return resp.choices[0].message.content.strip()


# -----------------------
# Data models (normalized)
# -----------------------
class MatchEvent(BaseModel):
    minute: int
    team: Optional[str] = None
    type: str
    description: str
    xg: Optional[float] = None


class MatchData(BaseModel):
    match_id: str
    status: str
    minute: Optional[int] = 0
    competition: Optional[str] = None
    home_team: str
    away_team: str
    score_home: int
    score_away: int
    events: List[MatchEvent] = []


# -----------------------
# Providers
# -----------------------
PROVIDER = os.getenv("SPORTS_API_PROVIDER", "collector").lower()


class SportsProvider:
    async def fetch(self, match_ref: str) -> MatchData:
        raise NotImplementedError


class GenericProvider(SportsProvider):
    """
    Previous generic HTTP provider kept for compatibility. It expects an upstream that
    already returns a football-like JSON and maps it into MatchData.
    """
    def __init__(self):
        self.template = os.getenv("SPORTS_API_URL_TEMPLATE")
        if not self.template:
            raise RuntimeError("SPORTS_API_URL_TEMPLATE is required for generic provider.")

    async def fetch(self, match_id: str) -> MatchData:
        url = self.template.format(match_id=match_id)
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            if r.status_code >= 400:
                raise HTTPException(r.status_code, f"Sports API error: {r.text[:200]}")
            data = r.json()
        if all(k in data for k in ["match_id", "home_team", "away_team", "score_home", "score_away"]):
            evs = [MatchEvent(**e) for e in data.get("events", [])]
            return MatchData(**{**data, "events": evs})
        return self._map_common_football(data, match_id)

    def _map_common_football(self, payload: Any, match_id: str) -> MatchData:
        status = payload.get("fixture", {}).get("status", {})
        minute = status.get("elapsed") or 0
        short = status.get("short") or "NS"
        home = payload.get("teams", {}).get("home", {}).get("name") or "Home"
        away = payload.get("teams", {}).get("away", {}).get("name") or "Away"
        g = payload.get("goals", {})
        sh = int(g.get("home") or 0)
        sa = int(g.get("away") or 0)
        events_raw = payload.get("events") or []
        events: List[MatchEvent] = []
        for e in events_raw:
            minute_e = e.get("time", {}).get("elapsed") or 0
            team_e = (e.get("team") or {}).get("name")
            etype = str(e.get("type") or "Event")
            detail = str(e.get("detail") or "")
            desc = f"{etype}: {detail}" if detail else etype
            events.append(MatchEvent(minute=minute_e, team=team_e, type=etype, description=desc))
        return MatchData(
            match_id=match_id,
            status=short,
            minute=minute,
            home_team=home,
            away_team=away,
            score_home=sh,
            score_away=sa,
            events=events,
        )


class APIFootballProvider(SportsProvider):
    def __init__(self):
        self.base = os.getenv("APIFOOTBALL_BASE", "https://v3.football.api-sports.io")
        self.key = os.getenv("APIFOOTBALL_KEY")
        if not self.key:
            raise RuntimeError("APIFOOTBALL_KEY is required for api_football provider.")

    async def fetch(self, match_id: str) -> MatchData:
        headers = {"x-apisports-key": self.key, "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            fx = await client.get(f"{self.base}/fixtures", params={"id": match_id})
            if fx.status_code >= 400:
                raise HTTPException(fx.status_code, f"API-Football fixtures error: {fx.text[:200]}")
            js = fx.json()
            if not js.get("response"):
                raise HTTPException(404, "Match not found")
            base = js["response"][0]
            ev = await client.get(f"{self.base}/fixtures/events", params={"fixture": match_id})
            ev.raise_for_status()
            ev_js = ev.json()
            ev_resp = ev_js.get("response") or []
        status = (base.get("fixture", {}).get("status") or {})
        short = status.get("short") or "NS"
        minute = status.get("elapsed") or 0
        home = base.get("teams", {}).get("home", {}).get("name")
        away = base.get("teams", {}).get("away", {}).get("name")
        sh = int((base.get("goals", {}) or {}).get("home") or 0)
        sa = int((base.get("goals", {}) or {}).get("away") or 0)
        events: List[MatchEvent] = []
        for e in ev_resp:
            minute_e = (e.get("time") or {}).get("elapsed") or 0
            team_e = (e.get("team") or {}).get("name")
            etype = str(e.get("type") or "Event")
            detail = str(e.get("detail") or "")
            desc = f"{etype}: {detail}" if detail else etype
            events.append(MatchEvent(minute=minute_e, team=team_e, type=etype, description=desc))
        return MatchData(
            match_id=str(match_id),
            status=short,
            minute=minute,
            home_team=home,
            away_team=away,
            score_home=sh,
            score_away=sa,
            events=events,
        )


class CollectorProvider(SportsProvider):
    """
    NEW: Fetches event details from your Collector Agent (CollectorAgentV2).
    Expects an HTTP POST to COLLECTOR_URL with a JSON body like:
      {"intent":"event.get","args":{"eventName":"Arsenal vs Chelsea","expand":["timeline","stats"]}}
    Note: Collector disables ID-only event lookups; provide eventName (optionally eventId to disambiguate).
    """
    def __init__(self):
        self.url = os.getenv("COLLECTOR_URL")
        if not self.url:
            raise RuntimeError("COLLECTOR_URL is required for collector provider.")
        # Comma-separated list, e.g. "timeline,stats,lineup"
        self.expand = [s.strip() for s in os.getenv("COLLECTOR_EXPAND", "timeline,stats").split(",") if s.strip()]

    async def fetch_by_name(self, event_name: str, event_id: Optional[str] = None) -> MatchData:
        args: Dict[str, Any] = {"eventName": event_name}
        if event_id:
            args["eventId"] = str(event_id)
        if self.expand:
            args["expand"] = self.expand

        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(self.url, json={"intent": "event.get", "args": args})
            r.raise_for_status()
            resp = r.json()

        if not resp.get("ok", False):
            err = resp.get("error") or {}
            code = err.get("code") or "COLLECTOR_ERROR"
            msg = err.get("message") or "Unknown error from collector"
            raise HTTPException(status_code=400, detail=f"{code}: {msg}")

        data = resp.get("data") or {}
        event = data.get("event")
        candidates = data.get("candidates") or []
        if not event and event_id:
            picks = [ev for ev in candidates if str(ev.get("idEvent") or "").strip() == str(event_id)]
            if len(picks) == 1:
                event = picks[0]
        tl = data.get("timeline")
        timeline = tl if isinstance(tl, list) else []

        # If collector couldn't select, but there's exactly one candidate, take it.
        if not event:
            if len(candidates) == 1:
                event = candidates[0]
            else:
                raise HTTPException(404, detail="Event ambiguous or not found. Provide a more specific name or eventId.")

        return self._map_tsdb_event(event, timeline)

    async def fetch(self, match_ref: str) -> MatchData:
        """
        For compatibility with the existing /summary/{match_id} route:
        When PROVIDER=collector, we treat the path segment as the *event name*.
        """
        return await self.fetch_by_name(event_name=match_ref)

    # ---- Mapping helpers (TSDB -> normalized) ----
    def _map_tsdb_event(self, ev: Dict[str, Any], timeline: List[Dict[str, Any]]) -> MatchData:
        home = ev.get("strHomeTeam") or "Home"
        away = ev.get("strAwayTeam") or "Away"

        def _to_int(x: Any, default: int = 0) -> int:
            try:
                return int(x)
            except Exception:
                return default

        sh = _to_int(ev.get("intHomeScore"))
        sa = _to_int(ev.get("intAwayScore"))

        # minute best-effort: try event field, else max of timeline, else 0
        minute = 0
        for k in ("intTime", "intMinute", "intElapsed"):
            v = ev.get(k)
            if v is not None:
                minute = _to_int(v, 0)
                if minute:
                    break
        if minute == 0 and timeline:
            minute = max((_to_int(t.get("intTime"), 0) or _to_int(t.get("intMinute"), 0) or _to_int(t.get("intElapsed"), 0)) for t in timeline)

        # status best-effort: map free-text to our short codes
        raw_status = (ev.get("strStatus") or ev.get("strProgress") or "").strip().lower()
        if "finished" in raw_status or raw_status == "match finished" or raw_status == "ft":
            status = "FT"
        elif raw_status in ("1h", "first half", "1st half", "live"):
            status = "1H"
        elif raw_status in ("2h", "second half", "2nd half"):
            status = "2H"
        elif raw_status in ("ht", "half time", "halftime"):
            status = "HT"
        elif raw_status in ("not started", "ns", "scheduled", ""):
            status = "NS"
        else:
            status = "LIVE"

        # Build events from timeline
        events: List[MatchEvent] = []
        for e in timeline:
            minute_e = 0
            for k in ("intTime", "intMinute", "intElapsed"):
                v = e.get(k)
                if v is not None:
                    minute_e = _to_int(v, 0)
                    if minute_e:
                        break
            team_e = e.get("strTeam") or None
            etype = str(e.get("strEvent") or e.get("strType") or "Event")
            detail = str(e.get("strEventDetail") or e.get("strDetail") or e.get("strComment") or "")
            # Keep same convention as other providers: description already includes type for readability
            desc = f"{etype}: {detail}" if detail else etype
            events.append(MatchEvent(minute=minute_e, team=team_e, type=etype, description=desc))

        match_id = str(ev.get("idEvent") or f"{home}_vs_{away}_{ev.get('dateEvent') or ''}").strip()
        competition = ev.get("strLeague") or None

        return MatchData(
            match_id=match_id,
            status=status,
            minute=minute,
            competition=competition,
            home_team=home,
            away_team=away,
            score_home=sh,
            score_away=sa,
            events=events,
        )


# Provider factory
if PROVIDER == "api_football":
    provider: SportsProvider = APIFootballProvider()
elif PROVIDER == "generic":
    provider = GenericProvider()
else:
    # default to collector
    provider = CollectorProvider()


# -----------------------
# Prompts
# -----------------------
SYSTEM_PROMPT = (
    "You are a concise sports writer. Given raw match data (teams, scoreline, time, and a list of key "
    "events with minutes), write a sharp, readable summary. Keep facts straight, avoid speculation, "
    "and prefer short sentences. Use team names, include scoreline, and mention the most important "
    "moments in chronological order."
)

LIVE_USER_TEMPLATE = (
    "Create a LIVE snapshot (2-4 bullets) for the match below. Start with the current scoreline and minute, "
    "then list key moments so far. Avoid future tense.\n\n{payload}\n"
)

FULL_USER_TEMPLATE = (
    "Create a FULL-TIME summary (one short paragraph + a 3-5 bullet key-moments list) for the match below. "
    "Begin with the final scoreline, then the game story.\n\n{payload}\n"
)


# -----------------------
# FastAPI app
# -----------------------
app = FastAPI(title="Summarizer Agent (LLM)")


def to_llm_payload(m: MatchData) -> str:
    lines = [
        f"MatchID: {m.match_id}",
        f"Status: {m.status}  Minute: {m.minute}",
        f"Teams: {m.home_team} vs {m.away_team}",
        f"Score: {m.home_team} {m.score_home}-{m.score_away} {m.away_team}",
        "Events:",
    ]
    for e in sorted(m.events, key=lambda x: x.minute or 0):
        team = f" [{e.team}]" if e.team else ""
        lines.append(f"  - {e.minute}'{team} {e.type}: {e.description}")
    return "\n".join(lines)


# --- Debug endpoints ---
@app.get("/debug/raw/{ref}")
async def debug_raw(ref: str, event_id: Optional[str] = Query(None)):
    """
    If PROVIDER=collector, 'ref' is treated as an eventName.
    Optionally pass ?event_id=... to disambiguate for collector.
    """
    if isinstance(provider, CollectorProvider):
        m = await provider.fetch_by_name(event_name=ref, event_id=event_id)
    else:
        m = await provider.fetch(ref)
    return m.model_dump()


# --- Main summary endpoints ---
@app.get("/summary/{ref}")
async def summarize_endpoint(ref: str, event_id: Optional[str] = Query(None)):
    """
    Universal summary endpoint:
      - PROVIDER=collector: 'ref' is the eventName (e.g., "Arsenal vs Chelsea").
        Optionally add ?event_id=... to filter.
      - Other providers: 'ref' is the match/fixture id.
    """
    if isinstance(provider, CollectorProvider):
        m = await provider.fetch_by_name(event_name=ref, event_id=event_id)
    else:
        m = await provider.fetch(ref)

    payload = to_llm_payload(m)

    status = m.status.upper() if m.status else "NS"
    if status == "FT":
        mode = "full"
    elif status in ["1H", "2H", "HT", "LIVE"]:
        mode = "live"
    elif status == "NS":
        raise HTTPException(400, detail="Match has not started yet.")
    else:
        mode = "live"

    user = LIVE_USER_TEMPLATE.format(payload=payload) if mode == "live" else FULL_USER_TEMPLATE.format(payload=payload)

    llm = LLM()
    try:
        summary = await llm.summarize(SYSTEM_PROMPT, user)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    return {
        "match_ref": ref,
        "mode": mode,
        "status": m.status,
        "minute": m.minute,
        "scoreline": f"{m.home_team} {m.score_home}-{m.score_away} {m.away_team}",
        "summary": summary,
    }


@app.get("/summary/by-name")
async def summarize_by_name(event_name: str = Query(..., description="Exact or close TSDB event name."),
                            event_id: Optional[str] = Query(None, description="Optional TSDB eventId to disambiguate")):
    """
    Convenience endpoint when using the collector provider explicitly by event name.
    """
    if not isinstance(provider, CollectorProvider):
        raise HTTPException(400, detail="This endpoint requires PROVIDER=collector.")
    m = await provider.fetch_by_name(event_name=event_name, event_id=event_id)
    payload = to_llm_payload(m)

    status = m.status.upper() if m.status else "NS"
    if status == "FT":
        mode = "full"
    elif status in ["1H", "2H", "HT", "LIVE"]:
        mode = "live"
    elif status == "NS":
        raise HTTPException(400, detail="Match has not started yet.")
    else:
        mode = "live"

    user = LIVE_USER_TEMPLATE.format(payload=payload) if mode == "live" else FULL_USER_TEMPLATE.format(payload=payload)

    llm = LLM()
    try:
        summary = await llm.summarize(SYSTEM_PROMPT, user)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    return {
        "match_ref": event_name,
        "mode": mode,
        "status": m.status,
        "minute": m.minute,
        "scoreline": f"{m.home_team} {m.score_home}-{m.score_away} {m.away_team}",
        "summary": summary,
    }
