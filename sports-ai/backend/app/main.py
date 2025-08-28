import os
import requests
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .agents.collector import CollectorAgentV2
from .agents.game_analytics_agent import AllSportsCollectorAgent

app = FastAPI(title="Sports Collector HM", version="0.2.0-min")

# --- Optional Frontend static mount (serves /frontend/pages/index.html) ---
try:
    # main.py lives at sports-ai/backend/app/main.py -> go up three levels to project root
    _SPORTS_ROOT = Path(__file__).resolve().parent.parent.parent
    _FRONTEND_DIR = _SPORTS_ROOT / "frontend"
    if _FRONTEND_DIR.exists():
        app.mount("/frontend", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
    else:
        print(f"[startup] Frontend directory not found at {_FRONTEND_DIR}, /frontend mount skipped")
except Exception as _e:
    print("[startup] Failed to mount /frontend static dir:", _e)

# --- CORS (open for dev; tighten in prod) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Agents ---
collector_agent = CollectorAgentV2()              # TheSportsDB-focused JSON agent
allsports_agent = AllSportsCollectorAgent()       # AllSports API JSON agent

# --- JSON entrypoints (minimal surface) ---
@app.post("/collect")
def collect(request: dict = Body(...)):
    """CollectorAgentV2 entrypoint: pass {"intent":..., "args":{...}}"""
    return collector_agent.handle(request)

@app.post("/allsports")
def allsports_collect(request: dict = Body(...)):
    """AllSportsCollectorAgent entrypoint: pass {"intent":..., "args":{...}}"""
    return allsports_agent.handle(request)

# --- Health ---
@app.get("/health")
def health():
    return {"ok": True, "service": app.title, "version": app.version}