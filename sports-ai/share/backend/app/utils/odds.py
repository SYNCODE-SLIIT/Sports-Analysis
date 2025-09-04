from __future__ import annotations
from typing import Dict, Optional


def implied_probs_from_any(event: Dict) -> Optional[Dict[str, float]]:
    """
    Extract decimal odds from common fields in an event and convert to implied probabilities.
    Removes overround by proportional normalization.

    Supported key patterns (case-insensitive-ish):
      - odd_home / odd_draw / odd_away
      - homeOdds / drawOdds / awayOdds
      - odds: { home: x, draw: y, away: z }
      - markets/outcomes arrays (first 1X2 market)
    """
    odds = None

    candidates = [
        (event.get("odd_home"), event.get("odd_draw"), event.get("odd_away")),
        (event.get("homeOdds"), event.get("drawOdds"), event.get("awayOdds")),
    ]
    for trio in candidates:
        if all(_is_num(v) for v in trio):
            odds = {"home": float(trio[0]), "draw": float(trio[1]), "away": float(trio[2])}
            break

    if odds is None:
        o = event.get("odds") or {}
        home = o.get("home") or o.get("H") or o.get("1")
        draw = o.get("draw") or o.get("D") or o.get("X")
        away = o.get("away") or o.get("A") or o.get("2")
        if all(_is_num(v) for v in (home, draw, away)):
            odds = {"home": float(home), "draw": float(draw), "away": float(away)}

    if odds is None:
        markets = event.get("markets") or []
        for m in markets:
            if _looks_match_winner_market(m):
                outcomes = m.get("outcomes") or []
                got = {}
                for out in outcomes:
                    name = (out.get("name") or out.get("label") or "").lower()
                    price = out.get("price") or out.get("odds")
                    if not _is_num(price):
                        continue
                    if name in ("home", "1", "home win"):
                        got["home"] = float(price)
                    elif name in ("draw", "x"):
                        got["draw"] = float(price)
                    elif name in ("away", "2", "away win"):
                        got["away"] = float(price)
                if len(got) == 3:
                    odds = got
                    break

    if not odds:
        return None

    imp = {k: (1.0 / v) for k, v in odds.items() if v and v > 0}
    s = sum(imp.values())
    if s <= 0:
        return None
    return {k: v / s for k, v in imp.items()}


def blend_probs(p_odds: Dict[str, float], p_form: Dict[str, float], w_odds: float = 0.7) -> Dict[str, float]:
    w_form = 1.0 - w_odds
    return {
        "home": p_odds.get("home", 0.0) * w_odds + p_form.get("home", 0.0) * w_form,
        "draw": p_odds.get("draw", 0.0) * w_odds + p_form.get("draw", 0.0) * w_form,
        "away": p_odds.get("away", 0.0) * w_odds + p_form.get("away", 0.0) * w_form,
    }


def _looks_match_winner_market(m: Dict) -> bool:
    name = (m.get("name") or m.get("key") or "").lower()
    return any(tok in name for tok in ("1x2", "match winner", "result"))


def _is_num(x) -> bool:
    try:
        return x is not None and float(x) == float(x)
    except Exception:
        return False
