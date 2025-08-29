import os
from fastapi import FastAPI, Body, APIRouter
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

# --- Debug: list routes at startup (helps diagnose 404 during dev) ---
@app.on_event("startup")
async def _show_routes():
    try:
        paths = sorted({r.path for r in app.routes})
        print("[startup] Registered paths (count=", len(paths), "):")
        for p in paths:
            if p.startswith('/matches'):  # highlight the relevant ones
                print("   *", p)
    except Exception as e:
        print("[startup] Could not list routes:", e)

# --- JSON entrypoints (minimal surface) ---
@app.post("/collect")
def collect(request: dict = Body(...)):
    """Unified entrypoint: pass {"intent":..., "args":{...}}; routes between TSDB and AllSports."""
    return router.handle(request)

# --- Health ---
@app.get("/health")
def health():
    return {"ok": True, "service": app.title, "version": app.version}


# # --- Added convenience endpoint for UI ---
# @app.get("/matches/summary")
# def matches_summary(date: str | None = None):
#     """Return combined live + finished matches for a date (live always current).
#     Live matches are always fetched 'now'; finished matches come from events.list for date.
#     """
#     return router.get_live_and_finished(date=date)


# New preferred path (/matches/details) — same payload as /matches/summary
@app.get("/matches/details")
def matches_details(date: str | None = None):
    """Alias endpoint (preferred). Returns same structure as /matches/summary.
    Added to satisfy frontend rename request."""
    return router.get_live_and_finished(date=date)

# Additional aliases (defensive for typos / trailing slash / singular) ---
# @app.get("/matches/summary/")
@app.get("/matches/details/")
@app.get("/matches/detail")
@app.get("/matches/detail/")
@app.get("/matches")
@app.get("/matches/")
def matches_details_alias(date: str | None = None):  # pragma: no cover (simple alias)
    return router.get_live_and_finished(date=date)


@app.get("/matches/history")
def matches_history(days: int = 7, end_date: str | None = None):
    """Return historical matches grouped by league for the past 'days' ending at end_date (UTC today default)."""
    return router.get_history(days=days, to_date=end_date)

# Aliases for history (trailing slash / alternative naming)
@app.get("/matches/history/")
@app.get("/matches/historical")
@app.get("/matches/historical/")
def matches_history_alias(days: int = 7, end_date: str | None = None):  # pragma: no cover
    return router.get_history(days=days, to_date=end_date)

@app.get('/matches/history_dual')
def matches_history_dual(days: int = 7, end_date: str | None = None):
    """Dual-provider aggregation: fetch events.list from both providers per day, merge, group by league."""
    return router.get_history_dual(days=days, to_date=end_date)

# Flat aliases (in case /matches prefix not accessible in current deployment)
@app.get('/history')
def history_flat(days: int = 7, end_date: str | None = None):  # pragma: no cover
    return router.get_history(days=days, to_date=end_date)

@app.get('/history_dual')
def history_dual_flat(days: int = 7, end_date: str | None = None):  # pragma: no cover
    return router.get_history_dual(days=days, to_date=end_date)

# --- Additional router to reinforce /matches/history path (defensive) ---
matches_router = APIRouter(prefix="/matches", tags=["matches"])

@matches_router.get("/history", name="matches_history_router")
def matches_history_router(days: int = 7, end_date: str | None = None):
    return router.get_history(days=days, to_date=end_date)

@matches_router.get("/history/", name="matches_history_router_slash")
def matches_history_router_slash(days: int = 7, end_date: str | None = None):  # pragma: no cover
    return router.get_history(days=days, to_date=end_date)


@matches_router.get("/history_debug", name="matches_history_debug")
def matches_history_debug(days: int = 7, end_date: str | None = None):  # pragma: no cover
    """Debug endpoint: return dual-provider merged history plus per-day provider counts
    This helps debug missing leagues by showing what each provider returned per date.
    """
    from datetime import datetime, timedelta, timezone

    # Use the dual merge result (ensures we show merged leagues/events)
    dual = router.get_history_dual(days=days, to_date=end_date)

    # Build date list (cap at 31 days)
    days_eff = max(1, min(days, 31))
    end_dt = datetime.strptime(end_date, '%Y-%m-%d') if end_date else datetime.now(timezone.utc)
    date_list = [(end_dt - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(days_eff)]

    per_day = []
    for d in date_list:
        ts = router._call_tsdb('events.list', {'date': d})
        asr = router._call_allsports('events.list', {'date': d})

        def _count_ev(resp):
            if not resp or not isinstance(resp, dict):
                return 0
            data = resp.get('data') or {}
            ev = data.get('events') or data.get('result') or data.get('results') or []
            return len(ev)

        per_day.append({
            'date': d,
            'tsdb_ok': bool(ts.get('ok')),
            'tsdb_count': _count_ev(ts),
            'allsports_ok': bool(asr.get('ok')),
            'allsports_count': _count_ev(asr),
            'tsdb_meta': ts.get('meta'),
            'allsports_meta': asr.get('meta'),
        })

    return {"ok": True, "debug": {"dual": dual, "per_day": per_day}}

@matches_router.get("/debug_list", name="matches_debug_list")
def matches_debug_list():  # pragma: no cover
    return {"ok": True, "paths": sorted({r.path for r in app.routes if '/matches' in r.path})}

app.include_router(matches_router)

# Global debug route to inspect all registered paths
@app.get("/_debug/routes")
def _debug_routes():  # pragma: no cover
    return {"count": len(app.routes), "paths": sorted({r.path for r in app.routes})}