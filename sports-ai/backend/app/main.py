import os
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .routers.router_collector import RouterCollector

app = FastAPI(title="Sports Collector HM (Unified)", version="0.3.0")

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
router = RouterCollector()                        # unified router over TSDB + AllSports

# --- JSON entrypoints (minimal surface) ---
@app.post("/collect")
def collect(request: dict = Body(...)):
    """Unified entrypoint: pass {"intent":..., "args":{...}}; routes between TSDB and AllSports."""
    return router.handle(request)

# --- Health ---
@app.get("/health")
def health():
    return {"ok": True, "service": app.title, "version": app.version}