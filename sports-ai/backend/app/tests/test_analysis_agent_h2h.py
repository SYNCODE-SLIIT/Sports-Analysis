# -*- coding: utf-8 -*-
from backend.app.agents.analysis_agent import AnalysisAgent


class FakeAllSports:
    def handle(self, req):
        intent = req.get("intent")
        args = req.get("args") or {}
        if intent == "event.get":
            # Minimal event payload with IDs/names recognized by AnalysisAgent
            return {
                "ok": True,
                "data": {
                    "event_key": "E1",
                    "event_home_team_id": "T100",
                    "event_away_team_id": "T200",
                    "event_home_team": "Alpha FC",
                    "event_away_team": "Beta FC",
                },
            }
        if intent == "h2h":
            # Newest-first H2H rows; includes both same and reversed orientations
            return {
                "ok": True,
                "data": {
                    "H2H": [
                        {  # same orientation (Alpha home)
                            "event_home_team_id": "T100",
                            "event_away_team_id": "T200",
                            "home_team_goal": 2,
                            "away_team_goal": 1,
                        },
                        {  # reversed (Beta home)
                            "event_home_team_id": "T200",
                            "event_away_team_id": "T100",
                            "home_team_goal": 0,
                            "away_team_goal": 0,
                        },
                        {  # same orientation
                            "event_home_team_id": "T100",
                            "event_away_team_id": "T200",
                            "home_team_goal": 1,
                            "away_team_goal": 3,
                        },
                    ]
                },
            }
        return {"ok": False, "error": "unsupported"}


def test_h2h_winprob_dirichlet():
    agent = AnalysisAgent(all_sports_agent=FakeAllSports())

    res = agent.handle(
        "analysis.winprob",
        {
            "eventId": "E1",
            "source": "h2h",
            "lookback": 3,
            "half_life": 2.0,
            "venue_weight": 1.25,
        },
    )
    assert res["ok"] is True
    assert res["data"]["method"] == "h2h_dirichlet"

    p = res["data"]["probs"]
    assert set(p) == {"home", "draw", "away"}
    assert abs((p["home"] + p["draw"] + p["away"]) - 1.0) < 1e-6
    for v in p.values():
        assert 0.0 < v < 1.0

    # sample size is reported under inputs
    assert res["data"]["inputs"]["sample_size"] == 3