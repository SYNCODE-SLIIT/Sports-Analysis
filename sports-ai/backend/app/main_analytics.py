"""
FastAPI endpoints for game analytics
- /games: List available games for user selection
- /analytics/{game_id}: Get analytics for selected game
Comments added for each endpoint.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from agents.game_analytics_agent import GameAnalyticsAgent
import logging
import os

# Add parent directory to path for imports
# sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

app = FastAPI()

# Allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount frontend static files
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/frontend", StaticFiles(directory=frontend_path, html=True), name="frontend")

logging.basicConfig(level=logging.INFO)

@app.get("/games")
def list_games(date: str = None, league_id: int = None):
    """Endpoint to list available games for user selection."""
    agent = GameAnalyticsAgent()
    try:
        games = agent.list_games(date=date, league_id=league_id)
        if not games:
            logging.warning(f"No games found for date: {date}")
        # Sort games: live/starting first, then by date
        sorted_games = sorted(games, key=lambda g: (
            0 if g.get('status_long', '').lower() in ['live', 'halftime', '1st half', '2nd half'] else
            1 if g.get('status_short', '') in ['NS', 'TBD'] else 2,
            g.get('timestamp', 0) or 0
        ))
        return sorted_games
    except Exception as e:
        logging.error(f"Error fetching games: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def read_root():
    """Redirect to game analytics page"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/frontend/pages/game-analytics.html")

@app.get("/analytics/{game_id}")
def get_analytics(game_id: int):
    """Endpoint to get analytics for selected game."""
    agent = GameAnalyticsAgent(game_id=game_id)
    try:
        analytics = agent.get_all_analytics()
        if not analytics:
            logging.warning(f"No analytics found for game_id: {game_id}")
        return analytics
    except Exception as e:
        logging.error(f"Error fetching analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Comments added for error handling and logging.
