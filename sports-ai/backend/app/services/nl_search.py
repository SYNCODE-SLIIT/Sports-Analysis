"""
Lightweight natural language query parser for the collector agent.

Converts free‑text like "matches yesterday by premier league" or
"live la liga" into router/collector intents and args.

Design goals:
  - Zero dependencies (regex + datetime only)
  - Return multiple candidate interpretations ordered by confidence
  - Keep provider name fields (leagueName, teamName, countryName) to leverage
    AllSportsRawAgent's built‑in name→ID resolution
  - Do not call the router here; just parse
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


@dataclass
class NLParsed:
    text: str
    entities: Dict[str, Any]
    candidates: List[Dict[str, Any]]  # each: { intent, args, reason }

    def to_dict(self) -> Dict[str, Any]:
        return {"text": self.text, "entities": self.entities, "candidates": self.candidates}


def _fmt_date(dt: datetime) -> str:
    return dt.date().isoformat()


def _extract_date_window(s: str) -> Dict[str, str]:
    """Extract date or from/to window from text.
    Supports: today, yesterday, tomorrow, YYYY-MM-DD, dd/mm, dd-mm, last N days, past N days.
    """
    today = datetime.now(timezone.utc)
    ents: Dict[str, str] = {}

    low = s.lower()
    if re.search(r"\blive\b|\bnow\b", low):
        ents["live"] = True  # marker; not a date

    if re.search(r"\btoday\b", low):
        ents["date"] = _fmt_date(today)
        return ents
    if re.search(r"\byesterday\b", low):
        ents["date"] = _fmt_date(today - timedelta(days=1))
        return ents
    if re.search(r"\btomorrow\b", low):
        ents["date"] = _fmt_date(today + timedelta(days=1))
        return ents

    m_iso = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", s)
    if m_iso:
        ents["date"] = m_iso.group(1)
        return ents

    # dd/mm or dd-mm (assume current year)
    m_dm = re.search(r"\b(\d{1,2})[/-](\d{1,2})\b", s)
    if m_dm:
        y = today.year
        mm = int(m_dm.group(2))
        dd = int(m_dm.group(1))
        ents["date"] = f"{y}-{mm:02d}-{dd:02d}"
        return ents

    # last N days / past N days
    m_last = re.search(r"\b(last|past)\s+(\d{1,2})\s+days?\b", low)
    if m_last:
        n = int(m_last.group(2))
        n = max(1, min(n, 31))
        ents["from"] = _fmt_date(today - timedelta(days=n - 1))
        ents["to"] = _fmt_date(today)
        return ents

    return ents


def _extract_strings(s: str) -> Dict[str, str]:
    """Extract leagueName, teamName, countryName using simple patterns."""
    ents: Dict[str, str] = {}
    low = s.lower()

    # by <league>
    m_by = re.search(r"\bby\s+([^,;]+)$", s, flags=re.I)
    if m_by:
        ents["leagueName"] = m_by.group(1).strip()

    # in <country>
    m_in = re.search(r"\bin\s+([a-zA-Z ]+)(?:\b|$)", s, flags=re.I)
    if m_in:
        ents["countryName"] = m_in.group(1).strip()

    # A vs B pattern (useful for H2H)
    m_vs = re.split(r"\s+vs\.?\s+|\s+v\s+|\s+-\s+|\s+–\s+|\s+—\s+", s, flags=re.I)
    if len(m_vs) == 2:
        ents["teamA"] = m_vs[0].strip()
        ents["teamB"] = m_vs[1].strip()
    else:
        # Fallback: try to find a capitalized phrase as teamName, but avoid generic words
        m_team = re.search(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\b", s)
        if m_team:
            ents["teamName"] = m_team.group(1).strip()

    # common league keywords if not caught by "by"
    if "leagueName" not in ents:
        commons = [
            "premier league", "la liga", "bundesliga", "serie a", "ligue 1",
            "eredivisie", "mls", "champions league", "europa league",
        ]
        for k in commons:
            if k in low:
                ents["leagueName"] = k
                break

    return ents


def parse_nl_query(q: str) -> NLParsed:
    if not isinstance(q, str):
        q = str(q or "")
    q_stripped = q.strip()
    low = q_stripped.lower()

    ents: Dict[str, Any] = {}
    ents.update(_extract_date_window(q_stripped))
    ents.update(_extract_strings(q_stripped))

    # Heuristic: infer country for popular league aliases when not provided
    if "leagueName" in ents and "countryName" not in ents:
        ln = str(ents["leagueName"]).strip().lower()
        alias_country = {
            "premier league": "England",
            "la liga": "Spain",
            "bundesliga": "Germany",
            "serie a": "Italy",
            "ligue 1": "France",
            "eredivisie": "Netherlands",
            "mls": "USA",
        }
        for key, country in alias_country.items():
            if key in ln:
                ents["countryName"] = country
                break

    # topic intent hints
    topic: Optional[str] = None
    if re.search(r"\b(highlight|video|clips?)\b", low):
        topic = "highlights"
    elif re.search(r"\b(table|standings)\b", low):
        topic = "standings"
    elif re.search(r"\bodds?\b", low):
        topic = "odds"
    elif re.search(r"\bprob(abilities|s?)\b", low):
        topic = "probabilities"
    elif re.search(r"\bh2h|head\s*to\s*head\b", low):
        topic = "h2h"
    ents["topic"] = topic

    # Build candidate interpretations (ordered)
    cands: List[Dict[str, Any]] = []

    # 1) If A vs B: prefer H2H, then events.list filtered by team A
    if "teamA" in ents and "teamB" in ents:
        a, b = ents["teamA"], ents["teamB"]
        cands.append({
            "intent": "h2h",
            "args": {"h2h": f"{a}-{b}"},
            "reason": "Parsed 'A vs B' head-to-head",
        })
        # Also try fixtures around today to catch scheduled match
        win = _extract_date_window(q_stripped)
        args = {"teamName": a}
        args.update({k: v for k, v in win.items() if k in ("date", "from", "to")})
        cands.append({"intent": "events.list", "args": args, "reason": "Team A fixtures window"})

    # 2) Topic routing
    if topic == "highlights":
        args: Dict[str, Any] = {}
        for k in ("teamName", "leagueName", "countryName", "date"):
            if k in ents:
                args[k] = ents[k]
        cands.append({"intent": "video.highlights", "args": args, "reason": "Highlights topic"})
    elif topic == "standings" and ("leagueName" in ents or "countryName" in ents):
        args = {k: ents[k] for k in ("leagueName", "countryName") if k in ents}
        cands.append({"intent": "league.table", "args": args, "reason": "Standings topic"})
    elif topic == "odds":
        args = {k: ents[k] for k in ("leagueName", "teamName", "countryName", "date") if k in ents}
        cands.append({
            "intent": "odds.live" if ents.get("live") else "odds.list",
            "args": args,
            "reason": "Odds topic",
        })
    elif topic == "probabilities":
        # Provider probabilities require match context; fall back to events list
        args = {k: ents[k] for k in ("leagueName", "teamName", "countryName", "date") if k in ents}
        cands.append({"intent": "events.list", "args": args, "reason": "Find matches for probabilities"})

    # 3) General matches search
    # live → events.live; else events.list with date/from-to if present
    base_args: Dict[str, Any] = {}
    for k in ("leagueName", "teamName", "countryName"):
        if k in ents:
            base_args[k] = ents[k]
    if "date" in ents:
        # AllSports Fixtures supports from/to — mirror single day into window
        base_args["from"] = ents["date"]
        base_args["to"] = ents["date"]
    if "from" in ents and "to" in ents:
        base_args["from"] = ents["from"]
        base_args["to"] = ents["to"]

    if ents.get("live"):
        cands.append({"intent": "events.live", "args": base_args, "reason": "Live matches filter"})
    # Always include events.list as a catch‑all
    cands.append({"intent": "events.list", "args": base_args, "reason": "General fixtures search"})

    return NLParsed(text=q_stripped, entities=ents, candidates=cands)
