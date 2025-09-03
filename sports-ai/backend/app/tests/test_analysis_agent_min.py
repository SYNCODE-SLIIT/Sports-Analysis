# tests/test_analysis_agent_min.py
from __future__ import annotations
import importlib.util, sys
from pathlib import Path
import math

# ==== Load analysis_agent.py *directly by file path* (no package imports) ====
APP_DIR = Path(__file__).resolve().parents[1]  # .../backend/app
ANALYSIS_AGENT_PATH = APP_DIR / "agents" / "analysis_agent.py"

MODULE_NAME = "backend.app.agents.analysis_agent"  # fully-qualified name

spec = importlib.util.spec_from_file_location(MODULE_NAME, str(ANALYSIS_AGENT_PATH))
analysis_agent = importlib.util.module_from_spec(spec)
assert spec and spec.loader, "Failed to build import spec for analysis_agent.py"

# IMPORTANT: register in sys.modules BEFORE executing the module
sys.modules[MODULE_NAME] = analysis_agent
spec.loader.exec_module(analysis_agent)  # type: ignore

AnalysisAgent = analysis_agent.AnalysisAgent

# ==== Minimal in-memory fake provider (no network / env) ====
class FakeAllSports:
    def __init__(self):
        # Event with odds -> odds-implied branch
        self.event_E1 = {
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
        }
        # Event without odds -> fallback form branch
        self.event_E2 = {
            "event_id": "E2",
            "match_id": "E2",
            "league_key": "L2",
            "event_home_team": "Gamma",
            "event_away_team": "Delta",
            "home_team_key": "T3",
            "away_team_key": "T4",
            "event_date": "2024-08-12",
            "event_time": "18:30",
        }

        def fx(date, time, h_id, a_id, hs, as_):
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

        self.team_fixtures = {
            "T1": [
                fx("2024-08-01", "16:00", "T1", "X1", 2, 0),
                fx("2024-08-05", "16:00", "T1", "X2", 1, 1),
                fx("2024-08-07", "16:00", "X3", "T1", 0, 1),
                fx("2024-08-08", "16:00", "X4", "T1", 2, 2),
                fx("2024-08-09", "16:00", "T1", "X5", 0, 3),
            ],
            "T2": [
                fx("2024-08-01", "16:00", "T2", "Y1", 0, 1),
                fx("2024-08-03", "16:00", "Y2", "T2", 2, 2),
                fx("2024-08-06", "16:00", "T2", "Y3", 3, 1),
                fx("2024-08-08", "16:00", "Y4", "T2", 0, 2),
                fx("2024-08-09", "16:00", "T2", "Y5", 1, 0),
            ],
            "T3": [
                fx("2024-08-01", "16:00", "T3", "Z1", 2, 2),
                fx("2024-08-05", "16:00", "Z2", "T3", 0, 1),
                fx("2024-08-08", "16:00", "T3", "Z3", 1, 0),
            ],
            "T4": [
                fx("2024-08-02", "16:00", "T4", "W1", 0, 1),
                fx("2024-08-06", "16:00", "W2", "T4", 1, 1),
                fx("2024-08-09", "16:00", "T4", "W3", 2, 1),
            ],
        }

        def h2h(date, time, h_id, a_id, hs, as_):
            return {
                "event_date": date,
                "event_time": time,
                "homeTeamId": h_id,
                "awayTeamId": a_id,
                "home_score": hs,
                "away_score": as_,
                "event_status": "Match Finished",
            }

        self.h2h_map = {
            "T1-T2": [
                h2h("2024-07-31", "19:00", "T1", "T2", 1, 0),
                h2h("2024-06-20", "19:00", "T2", "T1", 2, 2),
                h2h("2024-05-14", "19:00", "T1", "T2", 0, 3),
            ]
        }

    def handle(self, request):
        intent = request.get("intent")
        args = request.get("args") or {}
        if intent == "event.get":
            eid = str(args.get("eventId") or args.get("matchId"))
            if eid == "E1":
                data = {"success": 1, "result": [self.event_E1]}
            elif eid == "E2":
                data = {"success": 1, "result": [self.event_E2]}
            else:
                data = {"success": 1, "result": []}
            return {"ok": True, "data": data, "meta": {"trace": [{"step": "fake_event_get"}]}}
        if intent == "fixtures.list":
            team_id = str(args.get("teamId"))
            data = {"success": 1, "result": list(self.team_fixtures.get(team_id) or [])}
            return {"ok": True, "data": data, "meta": {"trace": [{"step": "fake_fixtures_list"}]}}
        if intent == "h2h":
            key = str(args.get("h2h") or "")
            data = {"success": 1, "result": list(self.h2h_map.get(key) or [])}
            return {"ok": True, "data": data, "meta": {"trace": [{"step": "fake_h2h"}]}}
        return {"ok": False, "data": None, "error": "unsupported", "meta": {"trace": []}}

# ==== Tests ====
def test_winprob_with_odds():
    agent = AnalysisAgent(all_sports_agent=FakeAllSports())
    r = agent.handle("analysis.winprob", {"eventId": "E1"})
    assert r["ok"] is True
    assert r["data"]["method"] == "odds_implied"
    probs = r["data"]["probs"]
    s = probs["home"] + probs["draw"] + probs["away"]
    assert math.isclose(s, 1.0, rel_tol=1e-6, abs_tol=1e-6)
    for p in probs.values():
        assert 0.0 <= p <= 1.0

def test_winprob_fallback_without_odds():
    agent = AnalysisAgent(all_sports_agent=FakeAllSports())
    r = agent.handle("analysis.winprob", {"eventId": "E2"})
    assert r["ok"] is True
    assert r["data"]["method"] == "form_logistic"
    probs = r["data"]["probs"]
    s = probs["home"] + probs["draw"] + probs["away"]
    assert math.isclose(s, 1.0, rel_tol=1e-6, abs_tol=1e-6)

def test_form_and_h2h():
    agent = AnalysisAgent(all_sports_agent=FakeAllSports())
    f = agent.handle("analysis.form", {"eventId": "E1", "lookback": 5})
    assert f["ok"] and f["data"]["home_metrics"]["games"] > 0 and f["data"]["away_metrics"]["games"] > 0

    h = agent.handle("analysis.h2h", {"eventId": "E1", "lookback": 3})
    assert h["ok"] and h["data"]["sample_size"] >= 2