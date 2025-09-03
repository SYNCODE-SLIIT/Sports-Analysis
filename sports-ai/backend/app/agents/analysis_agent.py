from __future__ import annotations
import math
import datetime as dt
from typing import Dict, List, Optional, Tuple

from ..utils.odds import implied_probs_from_any, blend_probs
from ..utils.form import RecentFormSummary, summarize_recent_form, rating_from_form
from ..utils.ir import fetch_event, fetch_team_recent_fixtures, fetch_head_to_head
from ..schemas.analysis import (
    WinProbabilities, TeamForm, HeadToHead, MatchInsights,
)

HOME_ADVANTAGE_ELO = 60  # simple constant expressed in Elo points


def logistic_prob(elo_diff: float) -> float:
    """Logistic transform to probability using Elo-like scale."""
    return 1.0 / (1.0 + math.pow(10.0, -elo_diff / 400.0))


class AnalysisAgent:
    """
    High-level analysis agent that composes:
      - Win probability estimation (bookmaker odds + form-based Elo)
      - Team performance summaries (last N)
      - Head-to-head summaries

    It expects a RAW provider agent exposing pass-through endpoints.
    """

    def __init__(self, raw_provider_agent):
        self.raw = raw_provider_agent

    # ---------- Core public methods ----------
    def match_insights(self, event_id: str, n_form: int = 5, n_h2h: int = 10) -> MatchInsights:
        event = fetch_event(self.raw, event_id)
        if not event:
            raise ValueError(f"Event {event_id} not found")

        home_id, away_id = self._extract_team_ids(event)

        # 1) Forms
        home_recent = fetch_team_recent_fixtures(self.raw, home_id, limit=max(20, n_form * 3))
        away_recent = fetch_team_recent_fixtures(self.raw, away_id, limit=max(20, n_form * 3))
        home_form_summary = summarize_recent_form(home_id, home_recent, n=n_form)
        away_form_summary = summarize_recent_form(away_id, away_recent, n=n_form)

        # 2) Head-to-head
        h2h_fixtures = fetch_head_to_head(self.raw, home_id, away_id, limit=max(40, n_h2h * 4))
        h2h_summary = self._summarize_h2h(home_id, away_id, h2h_fixtures, n=n_h2h)

        # 3) Win probabilities
        win_probs = self._estimate_win_probs(event, home_form_summary, away_form_summary)

        return MatchInsights(
            event_id=str(event_id),
            home_team_id=str(home_id),
            away_team_id=str(away_id),
            generated_at = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
            win_probabilities=win_probs,
            home_form=self._to_team_form(home_form_summary),
            away_form=self._to_team_form(away_form_summary),
            head_to_head=h2h_summary,
        )

    def win_probabilities(self, event_id: str, n_form: int = 5) -> WinProbabilities:
        event = fetch_event(self.raw, event_id)
        if not event:
            raise ValueError(f"Event {event_id} not found")
        home_id, away_id = self._extract_team_ids(event)
        home_recent = fetch_team_recent_fixtures(self.raw, home_id, limit=max(20, n_form * 3))
        away_recent = fetch_team_recent_fixtures(self.raw, away_id, limit=max(20, n_form * 3))
        home_form_summary = summarize_recent_form(home_id, home_recent, n=n_form)
        away_form_summary = summarize_recent_form(away_id, away_recent, n=n_form)
        return self._estimate_win_probs(event, home_form_summary, away_form_summary)

    def team_form(self, team_id: str, n_form: int = 5) -> TeamForm:
        recent = fetch_team_recent_fixtures(self.raw, team_id, limit=max(20, n_form * 3))
        form = summarize_recent_form(team_id, recent, n=n_form)
        return self._to_team_form(form)

    def head_to_head(self, team_a: str, team_b: str, n_h2h: int = 10) -> HeadToHead:
        fixtures = fetch_head_to_head(self.raw, team_a, team_b, limit=max(40, n_h2h * 4))
        return self._summarize_h2h(team_a, team_b, fixtures, n=n_h2h)

    # ---------- Internals ----------
    def _estimate_win_probs(
        self,
        event: Dict,
        home_form: RecentFormSummary,
        away_form: RecentFormSummary,
    ) -> WinProbabilities:
        # A) Try bookmaker odds from event payload
        odds_probs = implied_probs_from_any(event)

        # B) Form-based Elo
        home_rating = rating_from_form(home_form)
        away_rating = rating_from_form(away_form)
        elo_diff = (home_rating + HOME_ADVANTAGE_ELO) - away_rating
        p_home = logistic_prob(elo_diff)
        p_away = logistic_prob(-elo_diff)
        # Rough draw probability heuristic
        closeness = 1.0 - abs(p_home - p_away)
        p_draw_form = 0.2 + 0.2 * closeness  # 0.2–0.4 depending on closeness
        denom = p_home + p_away + p_draw_form
        form_probs = {
            "home": p_home / denom,
            "draw": p_draw_form / denom,
            "away": p_away / denom,
        }

        # C) Blend (odds 0.7, form 0.3) if odds present; otherwise just form
        if odds_probs:
            blended = blend_probs(odds_probs, form_probs, w_odds=0.7)
            method = "blend:odds(0.7)+form(0.3)"
            sources = ["bookmaker_odds", "recent_form"]
        else:
            blended = form_probs
            method = "form_only"
            sources = ["recent_form"]

        return WinProbabilities(**blended, method=method, sources=sources)

    def _extract_team_ids(self, event: Dict) -> Tuple[str, str]:
        """Be flexible to provider schema keys."""
        def find(keys: List[str]) -> Optional[str]:
            for k in keys:
                v = event.get(k)
                if v:
                    return str(v)
            teams = event.get("teams") or {}
            for k in keys:
                v = teams.get(k)
                if v:
                    return str(v)
            return None

        home_id = find(["home_id", "homeTeam_id", "homeTeamId", "homeTeam", "home_team_id"]) or ""
        away_id = find(["away_id", "awayTeam_id", "awayTeamId", "awayTeam", "away_team_id"]) or ""
        if not home_id or not away_id:
            home = event.get("home") or {}
            away = event.get("away") or {}
            home_id = home_id or str(home.get("id") or home.get("team_id") or "")
            away_id = away_id or str(away.get("id") or away.get("team_id") or "")
        if not home_id or not away_id:
            raise KeyError("Could not extract home/away team ids from event payload")
        return home_id, away_id

    def _to_team_form(self, rf: RecentFormSummary) -> TeamForm:
        return TeamForm(
            team_id=str(rf.team_id),
            matches=rf.matches,
            wins=rf.wins,
            draws=rf.draws,
            losses=rf.losses,
            goals_for=rf.goals_for,
            goals_against=rf.goals_against,
            last_five=" ".join(rf.last_five),
            unbeaten_streak=rf.unbeaten_streak,
        )

    def _summarize_h2h(self, team_a: str, team_b: str, fixtures: List[Dict], n: int = 10) -> HeadToHead:
        fixtures_sorted = sorted(fixtures, key=lambda f: f.get("timestamp") or f.get("time") or f.get("date") or 0, reverse=True)
        picked = fixtures_sorted[:n]
        wins_a = wins_b = draws = 0
        recent = []
        total_gf_a = total_gf_b = 0
        for fx in picked:
            ha, aa = _extract_score(fx)
            total_gf_a += ha
            total_gf_b += aa
            outcome = _outcome_for_pair(fx, team_a, team_b)
            if outcome == "A":
                wins_a += 1
            elif outcome == "B":
                wins_b += 1
            else:
                draws += 1
            recent.append({
                "fixture_id": str(fx.get("id") or fx.get("match_id") or fx.get("fixture_id") or ""),
                "date": fx.get("date") or fx.get("time") or fx.get("timestamp"),
                "home_id": str(fx.get("home_id") or fx.get("homeTeamId") or fx.get("homeTeam") or ""),
                "away_id": str(fx.get("away_id") or fx.get("awayTeamId") or fx.get("awayTeam") or ""),
                "score": f"{ha}-{aa}",
                "winner": outcome,
            })
        matches = len(picked)
        avg_goals_a = total_gf_a / matches if matches else 0.0
        avg_goals_b = total_gf_b / matches if matches else 0.0
        return HeadToHead(
            team_a_id=str(team_a), team_b_id=str(team_b),
            matches=matches, wins_a=wins_a, wins_b=wins_b, draws=draws,
            recent=recent, avg_goals_a=avg_goals_a, avg_goals_b=avg_goals_b,
        )


def _extract_score(fx: Dict) -> Tuple[int, int]:
    """Try to extract a numeric home–away score from various common keys."""
    for keypair in [
        ("home_score", "away_score"),
        ("goals_home", "goals_away"),
        ("homeGoals", "awayGoals"),
        ("score_home", "score_away"),
    ]:
        h, a = fx.get(keypair[0]), fx.get(keypair[1])
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


def _outcome_for_pair(fx: Dict, team_a: str, team_b: str) -> str:
    """Return 'A', 'B', or 'D' for draw for a & b teams in a given fixture."""
    h, a = _extract_score(fx)
    home = str(fx.get("home_id") or fx.get("homeTeamId") or fx.get("homeTeam") or "")
    away = str(fx.get("away_id") or fx.get("awayTeamId") or fx.get("awayTeam") or "")
    if not home or not away:
        return "D"
    if h == a:
        return "D"
    winner_is_home = h > a
    if winner_is_home:
        return "A" if home == team_a else "B"
    else:
        return "A" if away == team_a else "B"
