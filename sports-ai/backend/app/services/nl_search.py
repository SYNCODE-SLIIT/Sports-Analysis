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
from difflib import get_close_matches, SequenceMatcher


# Canonical league metadata (lowercase key -> (display_name, default_country))
LEAGUE_CANONICAL: Dict[str, tuple[str, Optional[str]]] = {
    "premier league": ("Premier League", "England"),
    "english premier league": ("Premier League", "England"),
    "epl": ("Premier League", "England"),
    "la liga": ("La Liga", "Spain"),
    "liga": ("La Liga", "Spain"),
    "bundesliga": ("Bundesliga", "Germany"),
    "serie a": ("Serie A", "Italy"),
    "ligue 1": ("Ligue 1", "France"),
    "eredivisie": ("Eredivisie", "Netherlands"),
    "mls": ("MLS", "USA"),
    "major league soccer": ("MLS", "USA"),
    "champions league": ("UEFA Champions League", None),
    "uefa champions league": ("UEFA Champions League", None),
    "europa league": ("UEFA Europa League", None),
    "uel": ("UEFA Europa League", None),
    "fa cup": ("FA Cup", "England"),
    "copa del rey": ("Copa del Rey", "Spain"),
    "primeira liga": ("Primeira Liga", "Portugal"),
    "eredivisie": ("Eredivisie", "Netherlands"),
    "jupiler pro league": ("Jupiler Pro League", "Belgium"),
    "pro league": ("Jupiler Pro League", "Belgium"),
    "brasileirao": ("Brasileirao", "Brazil"),
    "campeonato brasileiro": ("Brasileirao", "Brazil"),
    "ligue 1 uber eats": ("Ligue 1", "France"),
}

# Expand alias table without duplicating canonical keys
LEAGUE_ALIASES: Dict[str, str] = {
    "english league": "premier league",
    "england premier league": "premier league",
    "prem league": "premier league",
    "prem": "premier league",
    "spanish league": "la liga",
    "laliga": "la liga",
    "liga santander": "la liga",
    "german league": "bundesliga",
    "italian league": "serie a",
    "french league": "ligue 1",
    "dutch league": "eredivisie",
    "usa league": "mls",
    "major league": "mls",
    "ucl": "champions league",
    "uefa league": "champions league",
    "uel": "europa league",
    "english cup": "fa cup",
    "copa brasil": "brasileirao",
}

COUNTRY_CANONICAL: Dict[str, str] = {
    "england": "England",
    "eng": "England",
    "united kingdom": "England",
    "uk": "England",
    "spain": "Spain",
    "germany": "Germany",
    "italy": "Italy",
    "france": "France",
    "netherlands": "Netherlands",
    "holland": "Netherlands",
    "usa": "USA",
    "us": "USA",
    "u.s": "USA",
    "u.s.a": "USA",
    "america": "USA",
    "united states": "USA",
    "united states of america": "USA",
    "brazil": "Brazil",
    "portugal": "Portugal",
    "belgium": "Belgium",
    "mexico": "Mexico",
    "argentina": "Argentina",
    "turkey": "Turkey",
    "india": "India",
    "scotland": "Scotland",
    "wales": "Wales",
    "ireland": "Ireland",
}


def _closest_key(key: str, mapping: Dict[str, Any], cutoff: float = 0.78) -> Optional[str]:
    if key in mapping:
        return key
    matches = get_close_matches(key, mapping.keys(), n=1, cutoff=cutoff)
    return matches[0] if matches else None


def _normalize_league(raw: str) -> tuple[str, Optional[str]]:
    key = raw.strip().lower()
    if not key:
        return raw.strip(), None
    key = LEAGUE_ALIASES.get(key, key)
    resolved_key = _closest_key(key, LEAGUE_CANONICAL, cutoff=0.72)
    if resolved_key:
        league, country = LEAGUE_CANONICAL[resolved_key]
        return league, country
    return raw.strip(), None


def _normalize_country(raw: str) -> str:
    key = raw.strip().lower()
    if not key:
        return raw.strip()
    if key in COUNTRY_CANONICAL:
        return COUNTRY_CANONICAL[key]
    resolved_key = _closest_key(key, COUNTRY_CANONICAL, cutoff=0.8)
    if resolved_key:
        return COUNTRY_CANONICAL[resolved_key]
    words = key.split()
    for size in range(len(words), 0, -1):
        chunk = " ".join(words[:size])
        resolved = _closest_key(chunk, COUNTRY_CANONICAL, cutoff=0.8)
        if resolved:
            return COUNTRY_CANONICAL[resolved]
    if words:
        resolved_single = _closest_key(words[0], COUNTRY_CANONICAL, cutoff=0.75)
        if resolved_single:
            return COUNTRY_CANONICAL[resolved_single]
    return raw.strip()


def _fuzzy_league_from_text(text: str) -> Optional[tuple[str, Optional[str]]]:
    words = [w for w in re.findall(r"[a-zA-Z]+", text) if w]
    if not words:
        return None
    best_score = 0.0
    best: Optional[tuple[str, Optional[str]]] = None
    max_window = min(4, len(words))
    for window in range(max_window, 0, -1):
        for idx in range(len(words) - window + 1):
            chunk = " ".join(words[idx:idx + window]).lower()
            chunk = LEAGUE_ALIASES.get(chunk, chunk)
            resolved_key = _closest_key(chunk, LEAGUE_CANONICAL, cutoff=0.7)
            if not resolved_key:
                continue
            score = SequenceMatcher(None, resolved_key, chunk).ratio()
            if score > best_score:
                best_score = score
                best = LEAGUE_CANONICAL[resolved_key]
        if best_score >= 0.85:
            break
    return best


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
    parts = [p.strip() for p in re.split(r"\s+vs\.?\s+|\s+v\s+|\s+-\s+|\s+–\s+|\s+—\s+", s, flags=re.I) if p.strip()]
    if len(parts) >= 2:
        ents["teamA"] = parts[0]
        ents["teamB"] = parts[1]
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
        else:
            fuzzy = _fuzzy_league_from_text(low)
            if fuzzy:
                league_name, league_country = fuzzy
                ents["leagueName"] = league_name
                if league_country and "countryName" not in ents:
                    ents["countryName"] = league_country

    return ents


def parse_nl_query(q: str) -> NLParsed:
    if not isinstance(q, str):
        q = str(q or "")
    q_stripped = q.strip()
    low = q_stripped.lower()

    ents: Dict[str, Any] = {}
    ents.update(_extract_date_window(q_stripped))
    ents.update(_extract_strings(q_stripped))

    if "leagueName" in ents:
        league_fixed, inferred_country = _normalize_league(str(ents["leagueName"]))
        ents["leagueName"] = league_fixed
        if inferred_country and not ents.get("countryName"):
            ents["countryName"] = inferred_country

    if "countryName" in ents:
        ents["countryName"] = _normalize_country(str(ents["countryName"]))

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
        ents.setdefault("teamName", a)
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

    deduped: List[Dict[str, Any]] = []
    seen: set[tuple[str, tuple[tuple[str, Any], ...]]] = set()
    for cand in cands:
        args_items = tuple(sorted((cand.get("args") or {}).items()))
        key = (cand.get("intent"), args_items)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(cand)

    return NLParsed(text=q_stripped, entities=ents, candidates=deduped)
