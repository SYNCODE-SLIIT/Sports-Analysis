import os
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .agents.collector import CollectorAgentV2
from .agents.game_analytics_agent import GameAnalyticsAgent
from .models.youtube_highlight_shorts_extractor import extract_youtube_shorts
from datetime import datetime


app = FastAPI(title="Sports Collector HM", version="0.1.0")

# Mount static directory for highlight shorts
# app.mount("/highlight_shorts", StaticFiles(directory="highlight_shorts", html=True), name="highlight_shorts")  # Disabled to prevent error if directory does not exist

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
def merged_games(date: str | None = None, league_id: str | None = None):
    """Unified merged games endpoint combining API-Football + TheSportsDB.
    Returns: {ok, date, count, games:[...]}
    """
    d = date or datetime.utcnow().strftime("%Y-%m-%d")
    games = games_agent.list_games(date=d, league_id=league_id)
    return {"ok": True, "date": d, "count": len(games), "games": games}