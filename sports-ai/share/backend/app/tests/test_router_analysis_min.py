from __future__ import annotations
# Minimal, self-contained router test that avoids env keys & network.
# - Adds sports-ai to sys.path for `backend.*` imports
# - Stubs optional deps BEFORE importing RouterCollector
# - Replaces provider calls with in-memory fakes

import sys, types, math
from pathlib import Path

# ensure sports-ai is importable so `backend.*` works
SPORTS_AI_DIR = Path(__file__).resolve().parents[3]  # .../sports-ai
if str(SPORTS_AI_DIR) not in sys.path:
    sys.path.insert(0, str(SPORTS_AI_DIR))

# stub TSDB collector to avoid importing real CollectorAgentV2
mod_collector = types.ModuleType("backend.app.agents.collector")
class _DummyCollectorAgentV2:
    def handle(self, req):
        return {"ok": False, "intent": req.get("intent"), "args_resolved": req.get("args"),
                "data": None, "error": "not_implemented", "meta": {"trace": []}}
mod_collector.CollectorAgentV2 = _DummyCollectorAgentV2
sys.modules["backend.app.agents.collector"] = mod_collector

# stub highlight_search to avoid bs4 dependency at import time
mod_hl = types.ModuleType("backend.app.services.highlight_search")
mod_hl.search_event_highlights = lambda args: {"ok": True, "query": "stub", "variants": ["stub"], "results": {}, "meta": {"source": "stub"}}
sys.modules["backend.app.services.highlight_search"] = mod_hl

try:
    # Correct package path (file is in app/routers/)
    from backend.app.routers.router_collector import RouterCollector
except ModuleNotFoundError:
    # Fallback: create namespace packages and load routerCollector by searching for it
    import types as _types, importlib.util as _ilu
    from pathlib import Path

    # Ensure parent namespace packages exist
    if "backend" not in sys.modules:
        _backend = _types.ModuleType("backend")
        _backend.__path__ = [str(SPORTS_AI_DIR / "backend")]
        sys.modules["backend"] = _backend
    if "backend.app" not in sys.modules:
        _app = _types.ModuleType("backend.app")
        _app.__path__ = [str(SPORTS_AI_DIR / "backend" / "app")]
        sys.modules["backend.app"] = _app
    if "backend.app.routers" not in sys.modules:
        _routers = _types.ModuleType("backend.app.routers")
        _routers.__path__ = [str(SPORTS_AI_DIR / "backend" / "app" / "routers")]
        sys.modules["backend.app.routers"] = _routers

    # Candidate paths
    APP_DIR = Path(__file__).resolve().parents[1]  # .../backend/app
    candidates = [
        APP_DIR / "routers" / "router_collector.py",
        SPORTS_AI_DIR / "backend" / "app" / "routers" / "router_collector.py",
    ]

    # Repo-wide search as last resort
    try:
        for p in (SPORTS_AI_DIR).rglob("router_collector.py"):
            candidates.append(p)
    except Exception:
        pass

    RC_PATH = next((p for p in candidates if p.exists()), None)
    if RC_PATH is None:
        raise ModuleNotFoundError(
            "routerCollector.py not found. Tried:\n  - " +
            "\n  - ".join(str(p) for p in candidates[:10])
        )

    _modname = "backend.app.routers.router_collector"
    _spec = _ilu.spec_from_file_location(_modname, str(RC_PATH))
    if _spec is None or _spec.loader is None:
        raise ModuleNotFoundError(f"Cannot build spec for {RC_PATH}")
    _module = _ilu.module_from_spec(_spec)
    sys.modules[_modname] = _module
    _spec.loader.exec_module(_module)  # type: ignore
    RouterCollector = _module.RouterCollector

# --- shared fake provider data (same shapes used by analysis tests) ---
def _mk_event_e1():
    return {
        "event_id": "E1",
        "match_id": "E1",
        "league_key": "L1",
        "event_home_team": "Alpha",
        "event_away_team": "Beta",
        "home_team_key": "T1",
        "away_team_key": "T2",
        "event_date": "2024-08-10",
        "event_time": "15:00",
        "event_odd_home": 2.10,
        "event_odd_draw": 3.25,
        "event_odd_away": 3.60,
        "status": "Not Started",
    }

def _fx(date, time, h_id, a_id, hs, as_):
    return {
        "event_date": date,
        "event_time": time,
        "home_team_key": h_id,
        "away_team_key": a_id,
        "home_score": hs,
        "away_score": as_,
        "event_status": "Match Finished",
        "event_final_result": f"{hs} - {as_}",
    }

TEAM_FIX = {
    "T1": [
        _fx("2024-08-01", "16:00", "T1", "X1", 2, 0),
        _fx("2024-08-05", "16:00", "T1", "X2", 1, 1),
        _fx("2024-08-07", "16:00", "X3", "T1", 0, 1),
        _fx("2024-08-08", "16:00", "X4", "T1", 2, 2),
        _fx("2024-08-09", "16:00", "T1", "X5", 0, 3),
    ],
    "T2": [
        _fx("2024-08-01", "16:00", "T2", "Y1", 0, 1),
        _fx("2024-08-03", "16:00", "Y2", "T2", 2, 2),
        _fx("2024-08-06", "16:00", "T2", "Y3", 3, 1),
        _fx("2024-08-08", "16:00", "Y4", "T2", 0, 2),
        _fx("2024-08-09", "16:00", "T2", "Y5", 1, 0),
    ],
}

H2H_T1_T2 = [
    {"event_date": "2024-07-31", "event_time": "19:00", "homeTeamId": "T1", "awayTeamId": "T2", "home_score": 1, "away_score": 0},
    {"event_date": "2024-06-20", "event_time": "19:00", "homeTeamId": "T2", "awayTeamId": "T1", "home_score": 2, "away_score": 2},
    {"event_date": "2024-05-14", "event_time": "19:00", "homeTeamId": "T1", "awayTeamId": "T2", "home_score": 0, "away_score": 3},
]

def _allsports_body(intent: str, args: dict):
    # mirror AllSportsAdapter.call() shape
    if intent == "event.get":
        eid = str(args.get("eventId") or args.get("matchId"))
        data = {"success": 1, "result": [_mk_event_e1()]} if eid == "E1" else {"success": 1, "result": []}
    elif intent == "fixtures.list":
        tid = str(args.get("teamId") or "")
        data = {"success": 1, "result": list(TEAM_FIX.get(tid) or [])}
    elif intent == "h2h":
        key = str(args.get("h2h") or "")
        data = {"success": 1, "result": list(H2H_T1_T2 if key == "T1-T2" else [])}
    else:
        data = {"success": 1, "result": []}
    return {"ok": True, "data": data, "meta": {"provider": "allsports", "trace": [{"step": "fake"}]}}

class _FakeAllSports:
    # Mimic AllSportsRawAgent.handle used by AnalysisAgent inside RouterCollector
    def handle(self, request):
        intent = request.get("intent")
        args = request.get("args") or {}
        return _allsports_body(intent, args)

def test_router_analysis_match_insights(monkeypatch):
    rc = RouterCollector()
    # Make router's AllSports bridge and internal AnalysisAgent use fakes
    monkeypatch.setattr(rc, "_call_allsports", lambda intent, args: _allsports_body(intent, args))
    rc.analysis.sports = _FakeAllSports()

    resp = rc.handle({"intent": "analysis.match_insights", "args": {"eventId": "E1"}})
    assert resp["ok"] is True
    data = resp["data"]
    assert "winprob" in data and "form" in data and "h2h" in data
    probs = data["winprob"]["probs"]
    assert math.isclose(probs["home"] + probs["draw"] + probs["away"], 1.0, rel_tol=1e-6, abs_tol=1e-6)
    assert data["h2h"]["sample_size"] >= 2
    assert data["form"]["home_metrics"]["games"] > 0
    assert data["form"]["away_metrics"]["games"] > 0

def test_router_analysis_individual_intents(monkeypatch):
    rc = RouterCollector()
    monkeypatch.setattr(rc, "_call_allsports", lambda intent, args: _allsports_body(intent, args))
    rc.analysis.sports = _FakeAllSports()

    wp = rc.handle({"intent": "analysis.winprob", "args": {"eventId": "E1"}})
    assert wp["ok"] and wp["data"]["method"] == "odds_implied"

    fm = rc.handle({"intent": "analysis.form", "args": {"eventId": "E1", "lookback": 4}})
    assert fm["ok"] and fm["data"]["home_metrics"]["games"] > 0

    h2h = rc.handle({"intent": "analysis.h2h", "args": {"eventId": "E1", "lookback": 3}})
    assert h2h["ok"] and h2h["data"]["sample_size"] >= 2