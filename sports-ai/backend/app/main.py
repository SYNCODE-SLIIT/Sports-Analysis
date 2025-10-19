import os
from fastapi import FastAPI, Body, APIRouter, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .routers.router_collector import RouterCollector
from .routers.chatbot import router as chatbot_router
from .services.highlight_search import search_event_highlights
from .services.nl_search import parse_nl_query
from .agents.analysis_agent import AnalysisAgent
from .agents.collector_agent import AllSportsRawAgent

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
allsports = AllSportsRawAgent()
analysis_agent = AnalysisAgent(allsports)

app.include_router(chatbot_router)


# # --- Debug: list routes at startup (helps diagnose 404 during dev) ---
# @app.on_event("startup")
# async def _show_routes():
#     try:
#         paths = sorted({r.path for r in app.routes})
#         print("[startup] Registered paths (count=", len(paths), "):")
#         for p in paths:
#             if p.startswith('/matches'):  # highlight the relevant ones
#                 print("   *", p)
#     except Exception as e:
#         print("[startup] Could not list routes:", e)

try:
    from .agents import summarizer
    app.mount("/summarizer", summarizer.app)
    print("[startup] summarizer mounted at /summarizer")
except Exception as e:
    print(f"[startup] summarizer not mounted: {e}")


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


@app.get('/matches/history_raw')
def matches_history_raw(days: int = 7, end_date: str | None = None):
    return router.get_history_raw(days=days, to_date=end_date)


@app.get('/history_raw')
def history_raw_flat(days: int = 7, end_date: str | None = None):
    return router.get_history_raw(days=days, to_date=end_date)

@app.get("/leagues")
def get_leagues():
    """Get all leagues from AllSports API"""
    return router.handle({"intent": "leagues.list", "args": {}})

@app.get("/leagues/")
def get_leagues_alias():
    """Get all leagues from AllSports API (with trailing slash)"""
    return router.handle({"intent": "leagues.list", "args": {}})

@matches_router.get("/debug_list", name="matches_debug_list")
def matches_debug_list():  # pragma: no cover
    return {"ok": True, "paths": sorted({r.path for r in app.routes if '/matches' in r.path})}

app.include_router(matches_router)

# --- Analysis endpoints (JSON, UI-consistent) ---
@app.get("/analysis/match-insights")
@app.get("/analysis/match_insights")
def api_match_insights(eventId: str = Query(..., description="Match eventId")):
    out = router.analysis.handle("analysis.match_insights", {"eventId": str(eventId)})
    if not out.get("ok"):
        raise HTTPException(status_code=502, detail=out.get("error") or "Analysis error")
    return out

@app.get("/analysis/winprob")
def api_winprob(
    eventId: str = Query(..., description="Match eventId"),
    source: str = Query("auto", pattern="^(auto|odds|h2h|form)$"),
    lookback: int = Query(10, ge=1, le=50),
    half_life: float | None = Query(None, description="Optional recency half-life override"),
    venue_weight: float | None = Query(None, description="Optional home advantage weight (1.0 = neutral)"),
):
    args = {
        "eventId": str(eventId),
        "source": source,
        "lookback": lookback,
    }
    if half_life is not None:
        try:
            args["half_life"] = float(half_life)
        except Exception:
            pass
    if venue_weight is not None:
        try:
            args["venue_weight"] = float(venue_weight)
        except Exception:
            pass
    out = router.analysis.handle("analysis.winprob", args)
    # Ensure output uses 'probs' (plural) not 'prob' (singular)
    if out.get("ok") and out.get("data"):
        if "prob" in out["data"] and "probs" not in out["data"]:
            out["data"]["probs"] = out["data"].pop("prob")
    if not out.get("ok"):
        raise HTTPException(status_code=502, detail=out.get("error") or "Analysis error")
    return out

@app.get("/analysis/form")
def api_form(
    eventId: str = Query(..., description="Match eventId to infer teams"),
    lookback: int = Query(5, ge=1, le=50),
):
    out = router.analysis.handle("analysis.form", {
        "eventId": str(eventId),
        "lookback": lookback,
    })
    if not out.get("ok"):
        raise HTTPException(status_code=502, detail=out.get("error") or "Analysis error")
    return out

@app.get("/analysis/h2h")
def api_h2h(
    eventId: str | None = Query(None, description="Match eventId (preferred)"),
    teamA: str | None = Query(None, description="Team A (fallback if no eventId)"),
    teamB: str | None = Query(None, description="Team B (fallback if no eventId)"),
    lookback: int = Query(10, ge=1, le=50),
):
    if eventId:
        out = router.analysis.handle("analysis.h2h", {"eventId": str(eventId), "lookback": lookback})
    else:
        if not (teamA and teamB):
            raise HTTPException(status_code=400, detail="Provide eventId or teamA+teamB")
        out = router.handle({"intent": "analysis.h2h", "args": {"teamA": teamA, "teamB": teamB, "lookback": lookback}})
    if not out.get("ok"):
        raise HTTPException(status_code=502, detail=out.get("error") or "Analysis error")
    return out

# Global debug route to inspect all registered paths
@app.get("/_debug/routes")
def _debug_routes():  # pragma: no cover
    return {"count": len(app.routes), "paths": sorted({r.path for r in app.routes})}


# --- Event highlight search (free-form, no provider key needed) ---
@app.get('/highlight/event')
def highlight_event(home: str, away: str, minute: int | None = None, player: str | None = None,
                    event_type: str | None = None, date: str | None = None):
    args = {
        'homeTeam': home,
        'awayTeam': away,
        'minute': minute,
        'player': player,
        'event_type': event_type,
        'date': date,
    }
    return search_event_highlights(args)


def _extract_items(intent: str, data: dict) -> list:
    """Best-effort list extraction from router responses."""
    if not isinstance(data, dict):
        return []

    # Events / fixtures style payloads
    keys = ('events', 'result', 'results', 'matches')
    for key in keys:
        val = data.get(key)
        if isinstance(val, list):
            return val
        if isinstance(val, dict) and intent == 'h2h':
            merged = []
            for arr in val.values():
                if isinstance(arr, list):
                    merged.extend(arr)
            if merged:
                return merged

    return []


@app.post('/search/nl')
def nl_search(payload: dict = Body(...)):
    """Lightweight natural-language search entrypoint for the dashboard."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")

    query_raw = payload.get('query')
    if not query_raw:
        query_raw = payload.get('q')
    query = str(query_raw or '').strip()
    if not query:
        raise HTTPException(status_code=400, detail="Provide 'query' or 'q'.")

    limit_raw = payload.get('limit')
    try:
        limit = int(limit_raw) if limit_raw is not None else 3
    except (TypeError, ValueError):
        limit = 3
    limit = max(1, min(limit, 5))

    parsed = parse_nl_query(query)
    parsed_dict = parsed.to_dict()

    evaluated = []
    hits = []

    for cand in parsed.candidates:
        intent = cand.get('intent')
        args = cand.get('args') or {}
        if not isinstance(intent, str):
            continue

        resp = router.handle({"intent": intent, "args": args})
        data = resp.get('data') if isinstance(resp, dict) else None
        items = _extract_items(intent, data or {})
        empty = router._is_empty(data) if hasattr(router, '_is_empty') else not items
        ok = bool(resp.get('ok')) and not empty

        record = {
            'intent': intent,
            'reason': cand.get('reason'),
            'args': args,
            'ok': ok,
            'empty': empty,
            'count': len(items) if isinstance(items, list) else 0,
            'items': items,
            'data': data,
            'source': (resp.get('meta') or {}).get('source') if isinstance(resp, dict) else None,
            'meta': resp.get('meta') if isinstance(resp, dict) else None,
            'error': resp.get('error') if isinstance(resp, dict) else None,
        }

        evaluated.append(record)
        if ok:
            hits.append(record)
            if len(hits) >= limit:
                break

    return {
        'ok': bool(hits),
        'query': query,
        'parsed': parsed_dict,
        'results': evaluated,
        'hits': hits,
        'limit': limit,
        'meta': {'hit_count': len(hits)}
    }
