
import math
from backend.app.routers.router_collector import RouterCollector
from backend.app.agents.analysis_agent import AnalysisAgent

# Stub raw provider used *by* AnalysisAgent inside the collector
class FakeRaw:
    def __init__(self):
        self.events = {"E": {"id": "E", "home_id": "H", "away_id": "A",
                             "odds": {"home": 2.0, "draw": 3.4, "away": 3.8}}}
        self.fixtures = [
            {"id": "f1", "home_id": "H", "away_id": "A",
             "home_score": 2, "away_score": 1, "timestamp": 200},
            {"id": "f2", "home_id": "H", "away_id": "X",
             "home_score": 0, "away_score": 0, "timestamp": 100},
            {"id": "f3", "home_id": "A", "away_id": "Y",
             "home_score": 1, "away_score": 3, "timestamp": 90},
            {"id": "f4", "home_id": "A", "away_id": "H",
             "home_score": 2, "away_score": 2, "timestamp": 80},
        ]

    def act(self, intent: str, params: dict):
        if intent == "event.get":
            return {"data": self.events.get(str(params.get("matchId")))}
        if intent == "fixtures.list":
            team = params.get("teamId")
            teamA = params.get("teamA")
            teamB = params.get("teamB")
            out = list(self.fixtures)
            if teamA and teamB:
                out = [fx for fx in out if {fx["home_id"], fx["away_id"]} == {teamA, teamB}]
            elif team:
                out = [fx for fx in out if team in (fx["home_id"], fx["away_id"])]
            out.sort(key=lambda f: f.get("timestamp", 0), reverse=True)
            lim = params.get("limit")
            if isinstance(lim, int):
                out = out[:lim]
            return {"data": out}
        return {"data": None}

def _sum_probs(p):
    return p["home"] + p["draw"] + p["away"]

def test_collector_analysis_winprob():
    rc = RouterCollector()
    # Swap in our stub-backed analysis agent
    rc.analysis = AnalysisAgent(FakeRaw())

    resp = rc.handle({"intent": "analysis.winprob", "args": {"eventId": "E"}})
    assert resp["ok"] is True
    probs = resp["data"]  # WinProbabilities as dict
    assert set(probs.keys()) >= {"home", "draw", "away", "method", "sources"}
    assert math.isclose(_sum_probs(probs), 1.0, rel_tol=0, abs_tol=1e-9)

def test_collector_analysis_match_insights():
    rc = RouterCollector()
    rc.analysis = AnalysisAgent(FakeRaw())

    resp = rc.handle({"intent": "analysis.match_insights", "args": {"eventId": "E"}})
    assert resp["ok"] is True
    mi = resp["data"]  # MatchInsights as dict
    assert mi["event_id"] == "E"
    assert "win_probabilities" in mi and "head_to_head" in mi
    s = _sum_probs(mi["win_probabilities"])
    assert math.isclose(s, 1.0, abs_tol=1e-9)

def test_collector_analysis_form_and_h2h():
    rc = RouterCollector()
    rc.analysis = AnalysisAgent(FakeRaw())

    f = rc.handle({"intent": "analysis.form", "args": {"teamId": "H"}})
    assert f["ok"] is True
    assert set(f["data"].keys()) >= {"team_id", "matches", "wins", "draws", "losses"}

    h2h = rc.handle({"intent": "analysis.h2h", "args": {"teamA": "H", "teamB": "A"}})
    assert h2h["ok"] is True
    assert set(h2h["data"].keys()) >= {"matches", "wins_a", "wins_b", "draws"}