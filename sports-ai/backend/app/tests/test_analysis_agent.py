import pytest

from backend.app.agents.analysis_agent import AnalysisAgent

class FakeRaw:
    def __init__(self):
        self.events = {
            "123": {
                "id": "123",
                "home_id": "H",
                "away_id": "A",
                "odds": {"home": 2.00, "draw": 3.40, "away": 3.80},
            }
        }
        # Most recent first (higher timestamp newer)
        self.fixtures = [
            # H home vs A away — H wins 2-1
            {"id": "f1", "home_id": "H", "away_id": "A", "home_score": 2, "away_score": 1, "timestamp": 200},
            # H away vs X home — draw 0-0
            {"id": "f2", "home_id": "X", "away_id": "H", "home_score": 0, "away_score": 0, "timestamp": 190},
            # A home vs Y away — A loses 1-3
            {"id": "f3", "home_id": "A", "away_id": "Y", "home_score": 1, "away_score": 3, "timestamp": 180},
            # A home vs H away — draw 2-2
            {"id": "f4", "home_id": "A", "away_id": "H", "home_score": 2, "away_score": 2, "timestamp": 170},
        ]

    def act(self, intent: str, params: dict):
        if intent == "event.get":
            mid = str(params.get("matchId"))
            return {"data": self.events.get(mid)}
        if intent == "fixtures.list":
            team = params.get("teamId")
            if team:
                out = [fx for fx in self.fixtures if team in (fx.get("home_id"), fx.get("away_id"))]
                out = sorted(out, key=lambda f: f.get("timestamp"), reverse=True)
                lim = params.get("limit") or len(out)
                return {"data": out[:lim]}
            teamA = params.get("teamA")
            teamB = params.get("teamB")
            if teamA and teamB:
                out = [fx for fx in self.fixtures if {fx.get("home_id"), fx.get("away_id")} == {teamA, teamB}]
                out = sorted(out, key=lambda f: f.get("timestamp"), reverse=True)
                lim = params.get("limit") or len(out)
                return {"data": out[:lim]}
            return {"data": self.fixtures}
        return {"data": None}


def test_win_probs_with_odds_and_form():
    agent = AnalysisAgent(FakeRaw())
    r = agent.win_probabilities("123")
    assert 0.0 < r.home < 1.0
    assert 0.0 < r.draw < 1.0
    assert 0.0 < r.away < 1.0
    s = r.home + r.draw + r.away
    assert abs(s - 1.0) < 1e-6


def test_team_form_summary():
    agent = AnalysisAgent(FakeRaw())
    f = agent.team_form("H")
    assert f.team_id == "H"
    assert f.matches > 0
    assert isinstance(f.last_five, str)


def test_h2h_summary():
    agent = AnalysisAgent(FakeRaw())
    h2h = agent.head_to_head("H", "A")
    assert h2h.matches >= 2
    assert h2h.wins_a + h2h.wins_b + h2h.draws == h2h.matches


def test_match_insights():
    agent = AnalysisAgent(FakeRaw())
    mi = agent.match_insights("123")
    assert mi.event_id == "123"
    assert mi.home_team_id == "H"
    assert mi.away_team_id == "A"
    assert 0.0 <= mi.win_probabilities.home <= 1.0
