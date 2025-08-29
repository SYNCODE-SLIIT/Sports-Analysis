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


PROVIDER = os.getenv("SPORTS_API_PROVIDER", "generic").lower()

class SportsProvider:
    async def fetch(self, match_id: str) -> MatchData:
        raise NotImplementedError


class GenericProvider(SportsProvider):
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
        # If it's already in our shape
        if all(k in data for k in ["match_id", "home_team", "away_team", "score_home", "score_away"]):
            # ensure events list normalized
            evs = [MatchEvent(**e) for e in data.get("events", [])]
            return MatchData(**{**data, "events": evs})
        # Otherwise try to map from a common football-like shape
        return self._map_common_football(data, match_id)

    def _map_common_football(self, payload: Any, match_id: str) -> MatchData:
        # Very lightweight mapping; adjust to your upstream response
        # Expected nested fields (example):
        #   payload = {
        #     "fixture": {"status": {"short": "1H", "elapsed": 37}},
        #     "teams": {"home": {"name": "X"}, "away": {"name": "Y"}},
        #     "goals": {"home": 1, "away": 0},
        #     "events": [{"time":{"elapsed":12},"team":{"name":"X"},"type":"Goal","detail":"Normal Goal"}, ...]
        #   }
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
            xg = None
            # Some providers put xG in nested fields; ignore if absent
            events.append(MatchEvent(minute=minute_e, team=team_e, type=etype, description=desc, xg=xg))
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
        headers = {
            "x-apisports-key": self.key,
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            # 1) Fixture (teams, score, status)
            fx = await client.get(f"{self.base}/fixtures", params={"id": match_id})
            if fx.status_code >= 400:
                raise HTTPException(fx.status_code, f"API-Football fixtures error: {fx.text[:200]}")
            js = fx.json()
            print(js)
            # Expect something like {"response": [ {...} ]}
            if not js.get("response"):
                raise HTTPException(404, "Match not found")
            base = js["response"][0]

            # 2) Events
            ev = await client.get(f"{self.base}/fixtures/events", params={"fixture": match_id})
            ev.raise_for_status()
            ev_js = ev.json()
            print(ev_js)
            ev_resp = ev_js.get("response") or []

        # Map to normalized
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

# provider factory
if PROVIDER == "api_football":
    provider: SportsProvider = APIFootballProvider()
else:
    provider = GenericProvider()


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


app = FastAPI(title="Summarizer Agent (LLM)")


def to_llm_payload(m: MatchData) -> str:
    # Compact, deterministic text fed to the LLM
    lines = [
        f"MatchID: {m.match_id}",
        f"Status: {m.status}  Minute: {m.minute}",
        f"Teams: {m.home_team} vs {m.away_team}",
        f"Score: {m.home_team} {m.score_home}-{m.score_away} {m.away_team}",
        "Events:",
    ]
    # Sort events by minute
    for e in sorted(m.events, key=lambda x: x.minute or 0):
        team = f" [{e.team}]" if e.team else ""
        lines.append(f"  - {e.minute}'{team} {e.type}: {e.description}")
    return "\n".join(lines)


@app.get("/debug/raw/{match_id}")
async def debug_raw(match_id: str):
    m = await provider.fetch(match_id)
    return m.model_dump()


@app.get("/summary/{match_id}")
async def summarize_endpoint(match_id: str):
    m = await provider.fetch(match_id)
    payload = to_llm_payload(m)

   
    status = m.status.upper() if m.status else "NS"
    if status == "FT":
        mode = "full"
    elif status in ["1H", "2H", "HT"]:
        mode = "live"
    elif status == "NS":
        raise HTTPException(400, detail="Match has not started yet.")
    else:
        
        mode = "live"

    if mode == "live":
        user = LIVE_USER_TEMPLATE.format(payload=payload)
    else:
        user = FULL_USER_TEMPLATE.format(payload=payload)

    llm = LLM()
    try:
        summary = await llm.summarize(SYSTEM_PROMPT, user)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    return {
        "match_id": match_id,
        "mode": mode,
        "status": m.status,
        "minute": m.minute,
        "scoreline": f"{m.home_team} {m.score_home}-{m.score_away} {m.away_team}",
        "summary": summary,
    }

