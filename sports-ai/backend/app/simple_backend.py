"""
Simplified FastAPI backend for game analytics
Works without complex imports
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests
import json
import os
from datetime import datetime, timedelta

app = FastAPI(title="Football Analytics API", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Configuration
API_KEY = "579c329ce5eb86ebad5e69f0eaceae06"
API_FOOTBALL_URL = "https://v3.football.api-sports.io/"

def get_demo_games():
    """Return demo games for testing"""
    now = datetime.now()
    return [
        {
            "provider": "demo",
            "game_id": "demo_1",
            "date": (now + timedelta(hours=2)).isoformat(),
            "timestamp": int((now + timedelta(hours=2)).timestamp()),
            "home_team": "Arsenal",
            "away_team": "Chelsea", 
            "league": "Premier League",
            "league_logo": "https://media.api-sports.io/football/leagues/39.png",
            "home_logo": "https://media.api-sports.io/football/teams/42.png",
            "away_logo": "https://media.api-sports.io/football/teams/49.png",
            "venue": "Emirates Stadium",
            "status_short": "NS",
            "status_long": "Not Started",
            "home_score": None,
            "away_score": None,
            "referee": "Anthony Taylor"
        },
        {
            "provider": "demo",
            "game_id": "demo_2",
            "date": now.isoformat(),
            "timestamp": int(now.timestamp()),
            "home_team": "Manchester United", 
            "away_team": "Liverpool",
            "league": "Premier League",
            "league_logo": "https://media.api-sports.io/football/leagues/39.png",
            "home_logo": "https://media.api-sports.io/football/teams/33.png",
            "away_logo": "https://media.api-sports.io/football/teams/40.png",
            "venue": "Old Trafford",
            "status_short": "HT",
            "status_long": "Halftime",
            "home_score": 1,
            "away_score": 2,
            "elapsed": 45,
            "referee": "Michael Oliver"
        },
        {
            "provider": "demo",
            "game_id": "demo_3",
            "date": (now - timedelta(hours=2)).isoformat(),
            "timestamp": int((now - timedelta(hours=2)).timestamp()),
            "home_team": "Manchester City",
            "away_team": "Tottenham",
            "league": "Premier League",
            "league_logo": "https://media.api-sports.io/football/leagues/39.png",
            "home_logo": "https://media.api-sports.io/football/teams/50.png", 
            "away_logo": "https://media.api-sports.io/football/teams/47.png",
            "venue": "Etihad Stadium",
            "status_short": "FT",
            "status_long": "Match Finished",
            "home_score": 3,
            "away_score": 1,
            "referee": "Paul Tierney"
        },
        {
            "provider": "demo",
            "game_id": "demo_4",
            "date": now.isoformat(),
            "timestamp": int(now.timestamp()),
            "home_team": "Real Madrid",
            "away_team": "Barcelona",
            "league": "La Liga",
            "league_logo": "https://media.api-sports.io/football/leagues/140.png",
            "home_logo": "https://media.api-sports.io/football/teams/541.png",
            "away_logo": "https://media.api-sports.io/football/teams/529.png",
            "venue": "Santiago Bernabéu",
            "status_short": "87'",
            "status_long": "Second Half",
            "home_score": 2,
            "away_score": 1,
            "elapsed": 87,
            "referee": "José Hernández"
        }
    ]

def fetch_api_football_games(date):
    """Fetch games from API-Football"""
    try:
        headers = {"x-apisports-key": API_KEY}
        params = {"date": date}
        
        response = requests.get(
            f"{API_FOOTBALL_URL}fixtures",
            headers=headers,
            params=params,
            timeout=10
        )
        
        if response.status_code != 200:
            return []
            
        data = response.json()
        games = []
        
        for fix in data.get("response", []):
            f = fix.get("fixture", {})
            l = fix.get("league", {})
            t = fix.get("teams", {})
            g = fix.get("goals", {})
            s = f.get("status", {})
            
            games.append({
                "provider": "api_football",
                "game_id": f.get("id"),
                "date": f.get("date"),
                "timestamp": f.get("timestamp"),
                "timezone": f.get("timezone"),
                "referee": f.get("referee"),
                "venue": (f.get("venue") or {}).get("name"),
                "venue_city": (f.get("venue") or {}).get("city"),
                "status_short": s.get("short"),
                "status_long": s.get("long"),
                "elapsed": s.get("elapsed"),
                "league_id": l.get("id"),
                "league": l.get("name"),
                "league_country": l.get("country"),
                "league_logo": l.get("logo"),
                "league_flag": l.get("flag"),
                "season": l.get("season"),
                "round": l.get("round"),
                "home_team_id": (t.get("home") or {}).get("id"),
                "home_team": (t.get("home") or {}).get("name"),
                "home_logo": (t.get("home") or {}).get("logo"),
                "home_winner": (t.get("home") or {}).get("winner"),
                "away_team_id": (t.get("away") or {}).get("id"),
                "away_team": (t.get("away") or {}).get("name"),
                "away_logo": (t.get("away") or {}).get("logo"),
                "away_winner": (t.get("away") or {}).get("winner"),
                "home_score": g.get("home"),
                "away_score": g.get("away"),
                "score": fix.get("score", {})
            })
            
        return games
        
    except Exception as e:
        print(f"API-Football error: {e}")
        return []

@app.get("/")
def read_root():
    """Root endpoint"""
    return {
        "message": "Football Analytics API",
        "version": "1.0.0",
        "endpoints": ["/games", "/health"]
    }

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.get("/games")
def get_games(date: str = None, league_id: int = None, source: str = "auto"):
    """
    Get games for a specific date
    
    Args:
        date: Date in YYYY-MM-DD format (default: today)
        league_id: Filter by league ID (optional)
        source: 'api', 'demo', or 'auto' (default: auto)
    """
    if not date:
        date = datetime.now().strftime('%Y-%m-%d')
    
    games = []
    
    if source == "demo":
        # Return demo data only
        games = get_demo_games()
    elif source == "api":
        # Try API only
        games = fetch_api_football_games(date)
    else:
        # Auto: try API first, fallback to demo
        games = fetch_api_football_games(date)
        if not games:
            games = get_demo_games()
    
    # Filter by league if specified
    if league_id and games:
        games = [g for g in games if g.get("league_id") == league_id]
    
    # Sort games: live first, then upcoming, then finished
    def sort_key(game):
        status = (game.get('status_long', '') or game.get('status_short', '')).lower()
        is_live = any(s in status for s in ['live', 'halftime', '1st half', '2nd half', 'ht']) or ('elapsed' in game and game['elapsed'])
        is_upcoming = any(s in status for s in ['ns', 'tbd', 'not started'])
        
        if is_live:
            return (0, game.get('timestamp', 0))
        elif is_upcoming:
            return (1, game.get('timestamp', 0))
        else:
            return (2, game.get('timestamp', 0))
    
    games.sort(key=sort_key)
    
    return games

@app.get("/analytics/{game_id}")
def get_game_analytics(game_id: str):
    """Get analytics for a specific game"""
    # For now, return mock analytics
    return {
        "game_id": game_id,
        "analytics": {
            "possession": {"home": 65, "away": 35},
            "shots": {"home": 12, "away": 8},
            "shots_on_target": {"home": 5, "away": 3},
            "corners": {"home": 6, "away": 2},
            "fouls": {"home": 8, "away": 12}
        },
        "events": [
            {"minute": 23, "type": "goal", "player": "Player A", "team": "home"},
            {"minute": 67, "type": "yellow_card", "player": "Player B", "team": "away"}
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
