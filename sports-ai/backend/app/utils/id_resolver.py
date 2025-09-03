# backend/app/utils/id_resolver.py
from typing import Any, Dict, List, Optional

EVENT_ID_KEYS = ("eventId", "event_id", "matchId", "fixture_id", "event_key", "idEvent", "idAPIfootball", "id")

def normalize_event_id(args: Dict[str, Any]) -> str:
    for k in EVENT_ID_KEYS:
        v = (args or {}).get(k)
        if v is not None and str(v).strip() != "":
            return str(v)
    raise ValueError("Missing required arg: eventId (any of: " + ", ".join(EVENT_ID_KEYS) + ")")

def pick_event_row_from_data(data: Any, eid: str) -> Optional[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if isinstance(data, dict):
        for key in ("result", "results", "events", "fixtures"):
            if isinstance(data.get(key), list):
                rows = data[key]
                break
        if not rows and data:
            rows = [data]
    elif isinstance(data, list):
        rows = data

    keys = ("match_id","event_id","event_key","fixture_id","idEvent","id","idAPIfootball")
    for r in rows:
        try:
            if any(str(r.get(k)) == str(eid) for k in keys):
                return r
        except Exception:
            continue

    return rows[0] if len(rows) == 1 else None