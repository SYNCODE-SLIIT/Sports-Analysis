import os
import requests
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from .agents.collector import CollectorAgentV2
from .agents.game_analytics_agent import GameAnalyticsAgent
from .models.youtube_highlight_shorts_extractor import extract_youtube_shorts
from datetime import datetime


app = FastAPI(title="Sports Collector HM", version="0.1.0")

# Mount static directory for highlight shorts
# app.mount("/highlight_shorts", StaticFiles(directory="highlight_shorts", html=True), name="highlight_shorts")  # Disabled to prevent error if directory does not exist

# --- Frontend static mount (serves /frontend/pages/football-analytics-final.html) ---
try:
    # main.py lives at sports-ai/backend/app/main.py -> go up three levels to sports-ai root
    _SPORTS_ROOT = Path(__file__).resolve().parent.parent.parent
    _FRONTEND_DIR = _SPORTS_ROOT / "frontend"
    if _FRONTEND_DIR.exists():
        app.mount("/frontend", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
    else:
        print(f"[startup] Frontend directory not found at {_FRONTEND_DIR}, /frontend mount skipped")
except Exception as _e:
    print("[startup] Failed to mount /frontend static dir:", _e)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins (for dev; restrict in prod)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = CollectorAgentV2()
games_agent = GameAnalyticsAgent()

@app.post("/collect")
def collect(request: dict = Body(...)):
    """Single entrypoint: pass {"intent":..., "args":{...}}"""
    return agent.handle(request)

@app.get("/health")
def health():
    return {"ok": True}

# --- Shorts Generation Endpoint ---
@app.post("/highlights/{event_id}/shorts")
def generate_shorts_for_highlight(event_id: str):
    """
    Given an event_id, fetch the highlight YouTube URL and generate shorts.
    Returns a list of short video URLs accessible from the frontend.
    """
    # Get event data (includes video URL)
    out, _ = agent._cap_event_get({"eventId": event_id}, [])
    event = out.get("event", {})
    youtube_url = event.get("strVideo")
    if not youtube_url:
        return {"ok": False, "error": "No YouTube highlight URL found for this event."}
    # Directory for this event's shorts
    shorts_dir = f"highlight_shorts/{event_id}"
    # Generate shorts
    shorts = extract_youtube_shorts(youtube_url, output_dir=shorts_dir)
    # Return URLs for frontend
    shorts_urls = [f"/highlight_shorts/{event_id}/" + os.path.basename(s) for s in shorts]
    return {"ok": True, "shorts": shorts_urls, "youtube_url": youtube_url}

@app.get("/live/games")
def live_games(date: str | None = None):
    """Return soccer events for a given date (default today) using CollectorAgentV2.
    Normalizes to the structure expected by the frontend (subset).
    """
    d = date or datetime.utcnow().strftime("%Y-%m-%d")
    result = agent.handle({
        "intent": "events.list",
        "args": {"date": d}
    })
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}
    events = result.get("data", {}).get("events") or []
    games = []
    for ev in events:
        # Map TheSportsDB event fields to our simplified game model
        games.append({
            "provider": "thesportsdb",
            "game_id": ev.get("idEvent"),
            "date": ev.get("dateEvent") + "T" + (ev.get("strTime") or "00:00:00"),
            "home_team": ev.get("strHomeTeam"),
            "away_team": ev.get("strAwayTeam"),
            "league": ev.get("strLeague"),
            "venue": ev.get("strVenue"),
            "status_short": ev.get("strStatus") or "",  # TheSportsDB sometimes empty
            "status_long": ev.get("strProgress") or ev.get("strStatus") or "",  # custom fields if any
            "home_score": ev.get("intHomeScore"),
            "away_score": ev.get("intAwayScore"),
            "elapsed": ev.get("intTime"),
            "referee": ev.get("strReferee"),
        })
    return {"ok": True, "date": d, "count": len(games), "games": games}

@app.get("/games")
def merged_games(date: str | None = None, league_id: str | None = None, refresh: bool = False, provider: str | None = None):
    """Unified merged games endpoint combining API-Football + TheSportsDB.
    Adds optional refresh=true to bypass cached results for past dates and force refetch.
    Returns: {ok, date, count, games:[...]}
    """
    d = date or datetime.utcnow().strftime("%Y-%m-%d")
    # Recreate agent each call so BASE_URL / headers changes picked up without restart
    dynamic_agent = GameAnalyticsAgent()
    games = dynamic_agent.list_games(date=d, league_id=league_id, refresh=refresh)
    if provider:
        provider_lower = provider.lower()
        games = [g for g in games if provider_lower in [p.lower() for p in g.get("providers", [])]]
    return {"ok": True, "date": d, "count": len(games), "games": games, "refreshed": refresh, "provider_filter": provider}

@app.get("/games/{game_id}/analytics")
def game_analytics(game_id: str, date: str | None = None):
    """Return enriched analytics for a given merged game id.

    The merged list may include an accompanying TheSportsDB event id stored as 'tsdb_event_id'.
    We attempt to locate that record by first generating the games list for today (cheap) and
    matching the numeric id. If found we pass both api_football fixture id and tsdb event id
    into GameAnalyticsAgent for multi-provider enrichment.
    """
    # Fast path: treat game_id as API-Football fixture id (numeric) and also search for tsdb mapping
    target_date = date or datetime.utcnow().strftime("%Y-%m-%d")
    merged = games_agent.list_games(date=target_date)
    rec = None
    for g in merged:
        if str(g.get("game_id")) == str(game_id):
            rec = g
            break
    # Build agent with potential tsdb event id and AllSportsApi id (same as game_id if provider is allsportsapi)
    allsports_event_id = None
    if rec and "allsportsapi" in rec.get("providers", []):
        allsports_event_id = rec.get("game_id")
    # Build providers list dynamically. Always include api_football & thesportsdb by default; add allsportsapi if applicable.
    providers = ["api_football", "thesportsdb"]
    if allsports_event_id:
        providers.append("allsportsapi")
    agent_instance = GameAnalyticsAgent(game_id=game_id, tsdb_event_id=(rec or {}).get("tsdb_event_id"), allsports_event_id=allsports_event_id, providers=providers)
    data = agent_instance.get_all_analytics()
    return {"ok": True, "game_id": game_id, "date": target_date, "data": data, "tsdb_event_id": (rec or {}).get("tsdb_event_id"), "allsports_event_id": allsports_event_id, "providers": agent_instance.providers, "is_fd_org": agent_instance.is_fd_org}


@app.get("/debug/external-test")
def debug_external_test(date: str | None = None):
    """Hit the configured external BASE_URL and return raw status + JSON for troubleshooting.

    If BASE_URL contains football-data.org this will call /matches with dateFrom/dateTo.
    Otherwise it will call API-Football /fixtures?date=...
    """
    d = date or datetime.utcnow().strftime("%Y-%m-%d")
    base = os.environ.get("BASE_URL")
    if not base:
        return {"ok": False, "error": "BASE_URL not configured"}

    base = base.rstrip('/') + '/'
    try:
        if 'football-data.org' in base:
            url = base + 'matches'
            headers = { 'X-Auth-Token': os.environ.get('API_KEY', '') }
            params = { 'dateFrom': d, 'dateTo': d }
        else:
            url = base + 'fixtures'
            headers = { 'x-apisports-key': os.environ.get('API_KEY', '') }
            params = { 'date': d }

        resp = requests.get(url, headers=headers, params=params, timeout=15)
        try:
            body = resp.json()
        except Exception:
            body = resp.text
        return {"ok": True, "external_url": resp.url, "status_code": resp.status_code, "body": body}
    except Exception as e:
        return {"ok": False, "error": str(e)}