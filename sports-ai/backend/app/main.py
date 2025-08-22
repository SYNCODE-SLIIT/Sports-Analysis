from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import leagues, matches, teams

app = FastAPI(title="Sports AI Collector", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(leagues.router)
app.include_router(matches.router)
app.include_router(teams.router)

@app.get("/health")
def health():
    return {"ok": True}