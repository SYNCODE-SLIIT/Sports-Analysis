from __future__ import annotations
from typing import Dict, List, Optional

# These helpers adapt to your RAW AllSports agent shape.
# They use pass-through intents defined in your game_analytics_agent.


def fetch_event(raw_agent, event_id: str) -> Optional[Dict]:
    """Fetch a single event by id, tolerating different param names and envelope shapes."""
    resp = raw_agent.act("event.get", params={"matchId": event_id})
    data = _unwrap(resp)
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict) and data:
        return data
    resp = raw_agent.act("fixtures.list", params={"matchId": event_id})
    items = _as_list(_unwrap(resp))
    for it in items:
        if str(it.get("id") or it.get("match_id") or it.get("fixture_id")) == str(event_id):
            return it
    return None


def fetch_team_recent_fixtures(raw_agent, team_id: str, limit: int = 20) -> List[Dict]:
    resp = raw_agent.act("fixtures.list", params={"teamId": team_id, "limit": limit, "order": "desc"})
    items = _as_list(_unwrap(resp))
    if not items:
        return []
    out = []
    for it in items:
        hid = str(it.get("home_id") or it.get("homeTeamId") or it.get("homeTeam") or "")
        aid = str(it.get("away_id") or it.get("awayTeamId") or it.get("awayTeam") or "")
        if team_id in (hid, aid):
            out.append(it)
    return out[:limit]


def fetch_head_to_head(raw_agent, team_a: str, team_b: str, limit: int = 50) -> List[Dict]:
    resp = raw_agent.act("fixtures.list", params={"teamA": team_a, "teamB": team_b, "limit": limit, "order": "desc"})
    items = _as_list(_unwrap(resp))
    if items:
        return items[:limit]

    a_recent = fetch_team_recent_fixtures(raw_agent, team_a, limit=limit)
    b_recent = fetch_team_recent_fixtures(raw_agent, team_b, limit=limit)
    b_ids = set(str(x.get("id") or x.get("match_id") or x.get("fixture_id")) for x in b_recent)
    out = [x for x in a_recent if str(x.get("id") or x.get("match_id") or x.get("fixture_id")) in b_ids]

    if not out:
        for fx in a_recent:
            hid = str(fx.get("home_id") or fx.get("homeTeamId") or fx.get("homeTeam") or "")
            aid = str(fx.get("away_id") or fx.get("awayTeamId") or fx.get("awayTeam") or "")
            if {hid, aid} == {str(team_a), str(team_b)}:
                out.append(fx)
    return out[:limit]


def _unwrap(resp) -> Optional[object]:
    if not resp:
        return None
    if isinstance(resp, dict):
        if "data" in resp:
            d = resp.get("data")
            if isinstance(d, dict) and "result" in d:
                return d.get("result")
            return d
        if "result" in resp:
            return resp.get("result")
    return resp


def _as_list(x) -> List[Dict]:
    if not x:
        return []
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        return [x]
    return []
