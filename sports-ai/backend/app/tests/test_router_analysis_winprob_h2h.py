# -*- coding: utf-8 -*-
from backend.app.routers.router_collector import RouterCollector


class FakeAllSports:
    def handle(self, req):
        intent = req.get("intent")
        if intent == "event.get":
            return {
                "ok": True,
                "data": {
                    "event_key": "E99",
                    "event_home_team_id": "H1",
                    "event_away_team_id": "A1",
                    "event_home_team": "Homey",
                    "event_away_team": "Awayy",
                },
            }
        if intent == "h2h":
            return {
                "ok": True,
                "data": [
                    {"event_home_team_id": "H1", "event_away_team_id": "A1", "home_team_goal": 3, "away_team_goal": 1},
                    {"event_home_team_id": "A1", "event_away_team_id": "H1", "home_team_goal": 1, "away_team_goal": 1},
                    {"event_home_team_id": "H1", "event_away_team_id": "A1", "home_team_goal": 0, "away_team_goal": 2},
                ],
            }
        return {"ok": False, "error": "unsupported"}


def test_router_analysis_winprob_h2h(monkeypatch):
    rc = RouterCollector()
    # Inject fake AllSports into analysis agent
    rc.analysis.sports = FakeAllSports()

    out = rc.handle({
        "intent": "analysis.winprob",
        "args": {"eventId": "E99", "source": "h2h", "lookback": 3},
    })
    assert out["ok"] is True
    assert out["data"]["method"] == "h2h_dirichlet"

    prob = out["data"]["probs"]
    assert abs(sum(prob.values()) - 1.0) < 1e-6