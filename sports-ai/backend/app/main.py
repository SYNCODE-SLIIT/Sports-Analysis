import os
import requests
from fastapi import FastAPI, Body, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from .agents.collector import CollectorAgentV2
from .agents.game_analytics_agent import GameAnalyticsAgent
from .models.youtube_highlight_shorts_extractor import extract_youtube_shorts
from .agents.game_analytics_agent import allsports_client
from datetime import datetime


app = FastAPI(title="Sports Collector HM", version="0.1.0")

# Mount static directory for highlight shorts
# app.mount("/highlight_shorts", StaticFiles(directory="highlight_shorts", html=True), name="highlight_shorts")  # Disabled to prevent error if directory does not exist

# --- Frontend static mount (serves /frontend/pages/index.html) ---
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

# --- Internal helpers --------------------------------------------------------
def _normalize_status(raw_status: str | None):
    """Map AllSports event_status into (status_short, status_long, elapsed_int).

    AllSports often returns:
      - Numeric minutes like "17", "63" for in‑play
      - Strings like "Half Time", "Finished", "Not Started"
      - Potential codes (keep passthrough if unknown)
    The frontend expects live minutes to have an apostrophe (e.g. 63').
    """
    if raw_status is None:
        return ("NS", "Not Started", None)
    s = str(raw_status).strip()
    lower = s.lower()
    # Pure minute -> treat as live
    if s.isdigit():
        m = int(s)
        return (f"{m}'", "Live", m)
    # Minute with plus sign like 45+ or 90+
    if s.endswith('+') and s[:-1].isdigit():
        try:
            m = int(s[:-1])
        except ValueError:
            m = None
        return (f"{s}'", "Live", m)
    # Common textual statuses
    if lower in ("half time", "halftime", "ht"):
        return ("HT", "Halftime", 45)
    if lower in ("finished", "full time", "ft"):
        return ("FT", "Finished", None)
    if lower in ("after pen.", "penalties", "pen"):
        return ("PEN", "After Penalties", None)
    if lower in ("extra time", "aet"):
        return ("AET", "After Extra Time", None)
    if lower in ("not started", "ns", "tbd"):
        return ("NS", "Not Started", None)
    # Fallback passthrough
    return (s, s, None)

@app.get("/live/games")
def live_games(date: str | None = None):
    """Return ONLY live soccer games using AllSports Livescore.

    The optional date parameter is accepted for frontend compatibility but
    ignored (Livescore returns current live matches). Maps to the same game
    card structure as /games.
    """
    _guard_allsports()
    try:
        resp = allsports_client.livescore()
        if not isinstance(resp, dict) or resp.get("success") != 1:
            return {"ok": False, "error": "AllSports livescore error", "raw": resp}
        fixtures = resp.get("result") or []
        games = []
        for fx in fixtures:
            final_res = fx.get("event_final_result") or fx.get("event_halftime_result") or ""
            home_score = away_score = None
            if final_res and '-' in final_res:
                try:
                    parts = final_res.replace(" ", "").split('-')
                    home_score = int(parts[0]) if parts[0].isdigit() else None
                    away_score = int(parts[1]) if parts[1].isdigit() else None
                except Exception:
                    pass
            status_short, status_long, elapsed = _normalize_status(fx.get("event_status"))
            games.append({
                "provider": "allsportsapi",
                "providers": ["allsportsapi"],
                "game_id": fx.get("event_key"),
                "date": f"{fx.get('event_date')}T{fx.get('event_time')}",
                "home_team": fx.get("event_home_team"),
                "away_team": fx.get("event_away_team"),
                "home_team_key": fx.get("home_team_key"),
                "away_team_key": fx.get("away_team_key"),
                "home_logo": fx.get("home_team_logo"),
                "away_logo": fx.get("away_team_logo"),
                "league": fx.get("league_name"),
                "league_id": fx.get("league_key"),
                "venue": fx.get("event_stadium"),
                "status_short": status_short,
                "status_long": status_long,
                "home_score": home_score,
                "away_score": away_score,
                "elapsed": elapsed,
                "referee": fx.get("event_referee"),
            })
        return {"ok": True, "count": len(games), "games": games}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/games")
def allsports_games(date: str | None = None, league_id: str | None = None, refresh: bool = False):
    """List games using ONLY AllSports API fixtures.

    Maps AllSports fixture fields into the simplified game card shape expected by the
    existing frontend (home_team, away_team, league, scores, logos, etc.).

    Query params:
      date (default today) -> mapped to from/to same day
      league_id (optional) -> AllSports leagueId filter
    """
    _guard_allsports()
    d = date or datetime.utcnow().strftime("%Y-%m-%d")
    try:
        if refresh:
            allsports_client.clear_cache_for("Fixtures")
        resp = allsports_client.fixtures(d, d, leagueId=league_id)
        if not isinstance(resp, dict) or resp.get("success") != 1:
            return {"ok": False, "error": "AllSports fixtures error", "raw": resp}
        fixtures = resp.get("result") or []
        games = []
        for fx in fixtures:
            final_res = fx.get("event_final_result") or fx.get("event_halftime_result") or ""
            home_score = away_score = None
            if final_res and '-' in final_res:
                try:
                    parts = final_res.replace(" ", "").split('-')
                    home_score = int(parts[0]) if parts[0].isdigit() else None
                    away_score = int(parts[1]) if parts[1].isdigit() else None
                except Exception:
                    pass
            status_short, status_long, elapsed = _normalize_status(fx.get("event_status"))
            games.append({
                "provider": "allsportsapi",
                "providers": ["allsportsapi"],
                "game_id": fx.get("event_key"),
                "date": f"{fx.get('event_date')}T{fx.get('event_time')}",
                "home_team": fx.get("event_home_team"),
                "away_team": fx.get("event_away_team"),
                "home_team_key": fx.get("home_team_key"),
                "away_team_key": fx.get("away_team_key"),
                "home_logo": fx.get("home_team_logo"),
                "away_logo": fx.get("away_team_logo"),
                "league": fx.get("league_name"),
                "league_id": fx.get("league_key"),
                "venue": fx.get("event_stadium"),
                "status_short": status_short,
                "status_long": status_long,
                "home_score": home_score,
                "away_score": away_score,
                "elapsed": elapsed,
                "referee": fx.get("event_referee"),
            })
        return {"ok": True, "date": d, "count": len(games), "games": games}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/games/{game_id}/analytics")
def allsports_game_analytics(game_id: str, date: str | None = None):
    """AllSports-only analytics for one match (fixture + extras)."""
    _guard_allsports()
    target_date = date or datetime.utcnow().strftime("%Y-%m-%d")
    # Clean braces or encoded braces from id
    gid = str(game_id).strip().strip('{}')
    try:
        fx_resp = allsports_client.fixtures(target_date, target_date, matchId=gid, withPlayerStats="yes")
        if not isinstance(fx_resp, dict) or fx_resp.get("success") != 1:
            return {"ok": False, "error": "Fixture not found", "raw": fx_resp}
        items = fx_resp.get("result") or []
        if not items:
            return {"ok": False, "error": "Fixture list empty"}
        fx = items[0]
        final_res = fx.get("event_final_result") or fx.get("event_halftime_result") or ""
        home_score = away_score = None
        if final_res and '-' in final_res:
            parts = final_res.replace(" ", "").split('-')
            if len(parts) >= 2:
                if parts[0].isdigit():
                    home_score = int(parts[0])
                if parts[1].isdigit():
                    away_score = int(parts[1])
        game_info = {
            "fixture_id": fx.get("event_key"),
            "league": fx.get("league_name"),
            "league_id": fx.get("league_key"),
            "season": fx.get("league_season"),
            "round": fx.get("league_round"),
            "date": fx.get("event_date"),
            "time": fx.get("event_time"),
            "timestamp": None,
            "status_short": fx.get("event_status"),
            "status_long": fx.get("event_status"),
            "venue": fx.get("event_stadium"),
            "referee": fx.get("event_referee"),
            "home_team": {"id": fx.get("home_team_key"), "name": fx.get("event_home_team"), "logo": fx.get("home_team_logo")},
            "away_team": {"id": fx.get("away_team_key"), "name": fx.get("event_away_team"), "logo": fx.get("away_team_logo")},
            "goals": {"home": home_score, "away": away_score}
        }
        goals = fx.get("goalscorers") or []
        cards = fx.get("cards") or []
        highlight_moments = {"goals": goals, "cards": cards, "assists": []}
        videos = (allsports_client.videos(eventId=gid) or {}).get("result") or []
        odds = (allsports_client.odds(matchId=gid) or {}).get("result") or []
        probabilities = (allsports_client.probabilities(matchId=gid) or {}).get("result") or []
        standings = []
        topscorers = []
        league_id_val = fx.get("league_key")
        if league_id_val:
            standings = (allsports_client.standings(leagueId=league_id_val) or {}).get("result") or []
            topscorers = (allsports_client.topscorers(leagueId=league_id_val) or {}).get("result") or []
        h2h = []
        htk = fx.get("home_team_key")
        atk = fx.get("away_team_key")
        if htk and atk:
            h2h = (allsports_client.h2h(firstTeamId=htk, secondTeamId=atk) or {}).get("result") or []
        data = {
            "sources_used": ["allsportsapi"],
            "game_info": game_info,
            "highlight_moments": highlight_moments,
            "allsportsapi": {"raw": fx, "goalscorers": goals, "cards": cards},
            "videos": videos,
            "odds": odds,
            "probabilities": probabilities,
            "standings": standings,
            "topscorers": topscorers,
            "h2h": h2h
        }
        return {"ok": True, "game_id": gid, "date": target_date, "data": data, "providers": ["allsportsapi"]}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ---------------- AllSportsAPI Passthrough & Aggregation Endpoints ----------------

def _guard_allsports():
    if not os.environ.get("ALLSPORTS_API_KEY"):
        raise HTTPException(status_code=400, detail="ALLSPORTS_API_KEY not configured on server")

@app.get("/allsports/countries")
def allsports_countries():
    _guard_allsports()
    return allsports_client.countries()

@app.get("/allsports/leagues")
def allsports_leagues(countryId: str | None = Query(None)):
    _guard_allsports()
    return allsports_client.leagues(countryId=countryId)

@app.get("/allsports/fixtures")
def allsports_fixtures(from_date: str = Query(..., alias="from"), to_date: str = Query(..., alias="to"), timezone: str | None = None, countryId: str | None = None, leagueId: str | None = None, matchId: str | None = None, teamId: str | None = None, leagueGroup: str | None = None, withPlayerStats: str | None = None):
    _guard_allsports()
    return allsports_client.fixtures(from_date, to_date, timezone=timezone, countryId=countryId, leagueId=leagueId, matchId=matchId, teamId=teamId, leagueGroup=leagueGroup, withPlayerStats=withPlayerStats)

@app.get("/allsports/livescore")
def allsports_livescore(timezone: str | None = None, countryId: str | None = None, leagueId: str | None = None, matchId: str | None = None, withPlayerStats: str | None = None):
    _guard_allsports()
    return allsports_client.livescore(timezone=timezone, countryId=countryId, leagueId=leagueId, matchId=matchId, withPlayerStats=withPlayerStats)

@app.get("/allsports/h2h")
def allsports_h2h(firstTeamId: str, secondTeamId: str, timezone: str | None = None):
    _guard_allsports()
    return allsports_client.h2h(firstTeamId=firstTeamId, secondTeamId=secondTeamId, timezone=timezone)

@app.get("/allsports/standings")
def allsports_standings(leagueId: str):
    _guard_allsports()
    return allsports_client.standings(leagueId=leagueId)

@app.get("/allsports/topscorers")
def allsports_topscorers(leagueId: str):
    _guard_allsports()
    return allsports_client.topscorers(leagueId=leagueId)

@app.get("/allsports/teams")
def allsports_teams(leagueId: str | None = None, teamId: str | None = None, teamName: str | None = None):
    _guard_allsports()
    return allsports_client.teams(leagueId=leagueId, teamId=teamId, teamName=teamName)

@app.get("/allsports/players")
def allsports_players(playerId: str | None = None, playerName: str | None = None, leagueId: str | None = None, teamId: str | None = None):
    _guard_allsports()
    return allsports_client.players(playerId=playerId, playerName=playerName, leagueId=leagueId, teamId=teamId)

@app.get("/allsports/videos")
def allsports_videos(eventId: str):
    _guard_allsports()
    return allsports_client.videos(eventId=eventId)

@app.get("/allsports/odds")
def allsports_odds(from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to"), countryId: str | None = None, leagueId: str | None = None, matchId: str | None = None):
    _guard_allsports()
    kwargs = {}
    if from_date: kwargs['from'] = from_date
    if to_date: kwargs['to'] = to_date
    return allsports_client.odds(countryId=countryId, leagueId=leagueId, matchId=matchId, **kwargs)

@app.get("/allsports/probabilities")
def allsports_probabilities(from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to"), countryId: str | None = None, leagueId: str | None = None, matchId: str | None = None):
    _guard_allsports()
    kwargs = {}
    if from_date: kwargs['from'] = from_date
    if to_date: kwargs['to'] = to_date
    return allsports_client.probabilities(countryId=countryId, leagueId=leagueId, matchId=matchId, **kwargs)

@app.get("/allsports/odds/live")
def allsports_odds_live(countryId: str | None = None, leagueId: str | None = None, matchId: str | None = None, timezone: str | None = None):
    _guard_allsports()
    return allsports_client.odds_live(countryId=countryId, leagueId=leagueId, matchId=matchId, timezone=timezone)

@app.get("/allsports/full-odds")
def allsports_full_odds(from_date: str | None = Query(None, alias="from"), to_date: str | None = Query(None, alias="to"), countryId: str | None = None, leagueId: str | None = None, matchId: str | None = None):
    _guard_allsports()
    kwargs = {}
    if from_date: kwargs['from'] = from_date
    if to_date: kwargs['to'] = to_date
    return allsports_client.full_odds(countryId=countryId, leagueId=leagueId, matchId=matchId, **kwargs)


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