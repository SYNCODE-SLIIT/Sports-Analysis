from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/games")
def get_games(date: str = None):
    now = datetime.now()
    return [
        {
            "provider": "live_api",
            "game_id": "live_1", 
            "date": now.isoformat(),
            "home_team": "Arsenal",
            "away_team": "Chelsea", 
            "league": "Premier League",
            "league_logo": "https://media.api-sports.io/football/leagues/39.png",
            "home_logo": "https://media.api-sports.io/football/teams/42.png",
            "away_logo": "https://media.api-sports.io/football/teams/49.png",
            "venue": "Emirates Stadium",
            "status_short": "45+2",
            "status_long": "1st Half",
            "home_score": 1,
            "away_score": 0,
            "elapsed": 47,
            "referee": "Anthony Taylor"
        },
        {
            "provider": "live_api",
            "game_id": "live_2",
            "date": (now + timedelta(hours=3)).isoformat(),
            "home_team": "Manchester United",
            "away_team": "Liverpool",
            "league": "Premier League", 
            "league_logo": "https://media.api-sports.io/football/leagues/39.png",
            "home_logo": "https://media.api-sports.io/football/teams/33.png",
            "away_logo": "https://media.api-sports.io/football/teams/40.png",
            "venue": "Old Trafford",
            "status_short": "NS",
            "status_long": "Not Started",
            "home_score": None,
            "away_score": None, 
            "referee": "Michael Oliver"
        },
        {
            "provider": "live_api",
            "game_id": "live_3",
            "date": (now - timedelta(hours=1)).isoformat(),
            "home_team": "Real Madrid",
            "away_team": "Barcelona",
            "league": "La Liga",
            "league_logo": "https://media.api-sports.io/football/leagues/140.png",
            "home_logo": "https://media.api-sports.io/football/teams/541.png", 
            "away_logo": "https://media.api-sports.io/football/teams/529.png",
            "venue": "Santiago Bernabéu",
            "status_short": "FT",
            "status_long": "Match Finished",
            "home_score": 2,
            "away_score": 1,
            "referee": "José Hernández"
        }
    ]

@app.get("/")
def root():
    return {"message": "Football Analytics API is running!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8003)
