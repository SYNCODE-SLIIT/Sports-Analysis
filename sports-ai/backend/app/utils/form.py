from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass
class RecentFormSummary:
    team_id: str
    matches: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    last_five: List[str]  # like ["W","D","L","W","W"]
    unbeaten_streak: int


_RESULT_KEYS = [
    ("home_score", "away_score"),
    ("goals_home", "goals_away"),
    ("homeGoals", "awayGoals"),
]


def summarize_recent_form(team_id: str, fixtures: List[Dict], n: int = 5) -> RecentFormSummary:
    fixtures_sorted = sorted(fixtures, key=lambda f: f.get("timestamp") or f.get("time") or f.get("date") or 0, reverse=True)
    picked = fixtures_sorted[:n]
    wins = draws = losses = 0
    gf = ga = 0
    last_labels: List[str] = []
    unbeaten = 0

    for fx in picked:
        is_home = _is_home_team(fx, team_id)
        hs, as_ = _score(fx)
        if is_home:
            gf += hs
            ga += as_
            outcome = _outcome(hs, as_)
        else:
            gf += as_
            ga += hs
            outcome = _outcome(as_, hs)

        last_labels.append(outcome)
        if outcome == "W":
            wins += 1
            unbeaten += 1
        elif outcome == "D":
            draws += 1
            unbeaten += 1
        else:
            losses += 1
            unbeaten = 0

    return RecentFormSummary(
        team_id=str(team_id),
        matches=len(picked),
        wins=wins,
        draws=draws,
        losses=losses,
        goals_for=gf,
        goals_against=ga,
        last_five=last_labels,
        unbeaten_streak=unbeaten,
    )


def rating_from_form(rf: RecentFormSummary) -> float:
    """Map recent form to an Elo-like rating around 1500."""
    if rf.matches == 0:
        return 1500.0
    points = rf.wins * 3 + rf.draws
    ppm = points / float(rf.matches)
    gd = rf.goals_for - rf.goals_against
    return 1500.0 + 80.0 * (ppm - 1.5) + 5.0 * gd


def _is_home_team(fx: Dict, team_id: str) -> bool:
    home = str(fx.get("home_id") or fx.get("homeTeamId") or fx.get("homeTeam") or "")
    if not home:
        team = fx.get("home") or {}
        home = str(team.get("id") or team.get("team_id") or "")
    return home == str(team_id)


def _score(fx: Dict) -> Tuple[int, int]:
    for hk, ak in _RESULT_KEYS:
        h, a = fx.get(hk), fx.get(ak)
        if h is not None and a is not None:
            try:
                return int(h), int(a)
            except Exception:
                pass
    score = fx.get("score") or fx.get("scores") or {}
    for pair in [("home", "away"), ("localteam", "visitorteam")]:
        h, a = score.get(pair[0]), score.get(pair[1])
        if h is not None and a is not None:
            try:
                return int(h), int(a)
            except Exception:
                pass
    return 0, 0


def _outcome(our: int, opp: int) -> str:
    if our > opp:
        return "W"
    if our == opp:
        return "D"
    return "L"
