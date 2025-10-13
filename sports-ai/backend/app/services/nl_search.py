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
from typing import Any, Dict, Iterable, List, Optional, Tuple
from difflib import get_close_matches, SequenceMatcher

try:  # optional dependency for lightweight spell correction
    from spellchecker import SpellChecker
except ImportError:  # pragma: no cover - fallback when library missing
    SpellChecker = None  # type: ignore[assignment]


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
    "u.s.": "USA",
    "u.s.a.": "USA",
    "u s": "USA",
    "u s a": "USA",
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


MONTH_MAP: Dict[str, int] = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


WORD_NUMBER_MAP: Dict[str, int] = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
    "couple": 2,
    "few": 3,
}


CONTEXT_TRAILING_WORDS: set[str] = {
    "today",
    "tomorrow",
    "yesterday",
    "tonight",
    "live",
    "stream",
    "streams",
    "score",
    "scores",
    "result",
    "results",
    "fixture",
    "fixtures",
    "game",
    "games",
    "match",
    "matches",
    "day",
    "days",
    "week",
    "weeks",
    "month",
    "months",
    "year",
    "years",
    "highlight",
    "highlights",
    "video",
    "videos",
    "odds",
    "probabilities",
    "stats",
    "stat",
    "analysis",
    "preview",
    "recap",
    "news",
}


TEAM_LEADING_STOPWORDS: set[str] = {
    "for",
    "about",
    "regarding",
    "the",
    "vs",
    "v",
    "versus",
    "against",
}

TEAM_SUFFIX_STOPWORDS: set[str] = CONTEXT_TRAILING_WORDS | {"for"}

TEAM_TRAILING_MARKERS: set[str] = {
    "last",
    "next",
    "past",
    "this",
    "today",
    "tomorrow",
    "yesterday",
    "tonight",
}

H2H_SPLIT_REGEX = re.compile(r"\s+(?:vs\.?|versus|v|against)\s+|\s+[–—-]\s+|\s*@\s*", re.I)


TEAM_CANONICAL_BASE: Dict[str, str] = {
    "arsenal": "Arsenal",
    "aston villa": "Aston Villa",
    "atletico madrid": "Atletico Madrid",
    "atletico": "Atletico Madrid",
    "barcelona": "Barcelona",
    "bayern munich": "Bayern Munich",
    "benfica": "Benfica",
    "borussia dortmund": "Borussia Dortmund",
    "chelsea": "Chelsea",
    "everton": "Everton",
    "galatasaray": "Galatasaray",
    "inter milan": "Inter Milan",
    "juventus": "Juventus",
    "lazio": "Lazio",
    "leicester city": "Leicester City",
    "liverpool": "Liverpool",
    "manchester city": "Manchester City",
    "manchester united": "Manchester United",
    "napoli": "Napoli",
    "newcastle united": "Newcastle United",
    "paris saint germain": "Paris Saint Germain",
    "porto": "Porto",
    "psg": "Paris Saint Germain",
    "real madrid": "Real Madrid",
    "roma": "AS Roma",
    "sevilla": "Sevilla",
    "sporting cp": "Sporting CP",
    "tottenham hotspur": "Tottenham Hotspur",
    "valencia": "Valencia",
    "villarreal": "Villarreal",
    "wolfsburg": "Wolfsburg",
    "wolves": "Wolverhampton Wanderers",
    "wolverhampton wanderers": "Wolverhampton Wanderers",
    "ajax": "Ajax",
    "feyenoord": "Feyenoord",
    "celtic": "Celtic",
    "rangers": "Rangers",
    "ac milan": "AC Milan",
    "inter": "Inter Milan",
    "milan": "AC Milan",
    "boca juniors": "Boca Juniors",
    "river plate": "River Plate",
    "palmeiras": "Palmeiras",
    "flamengo": "Flamengo",
    "brighton & hove albion": "Brighton & Hove Albion",
    "brighton and hove albion": "Brighton & Hove Albion",
    "brighton hove albion": "Brighton & Hove Albion",
    "crystal palace": "Crystal Palace",
    "bayer leverkusen": "Bayer Leverkusen",
    "lille": "Lille",
    "deportivo la coruna": "Deportivo La Coruna",
    "paris saint-germain": "Paris Saint Germain",
    "real sociedad": "Real Sociedad",
    "real betis": "Real Betis",
}


TEAM_ALIASES: Dict[str, str] = {
    "man utd": "Manchester United",
    "man united": "Manchester United",
    "man u": "Manchester United",
    "mufc": "Manchester United",
    "man city": "Manchester City",
    "man c": "Manchester City",
    "mcfc": "Manchester City",
    "mancity": "Manchester City",
    "lfc": "Liverpool",
    "l'pool": "Liverpool",
    "lpool": "Liverpool",
    "fc barcelona": "Barcelona",
    "barca": "Barcelona",
    "fcb": "Barcelona",
    "fc bayern": "Bayern Munich",
    "fcbayern": "Bayern Munich",
    "paris sg": "Paris Saint Germain",
    "paris st germain": "Paris Saint Germain",
    "tottenham": "Tottenham Hotspur",
    "spurs": "Tottenham Hotspur",
    "hotspur": "Tottenham Hotspur",
    "as roma": "AS Roma",
    "acmilan": "AC Milan",
    "inter": "Inter Milan",
    "inter milano": "Inter Milan",
    "intermilan": "Inter Milan",
    "borussia": "Borussia Dortmund",
    "dortmund": "Borussia Dortmund",
    "atleti": "Atletico Madrid",
    "atletico de madrid": "Atletico Madrid",
    "real madrid cf": "Real Madrid",
    "real madrid club de futbol": "Real Madrid",
    "losc": "Lille",
    "leverkusen": "Bayer Leverkusen",
    "juve": "Juventus",
    "gala": "Galatasaray",
    "sporting": "Sporting CP",
    "villareal": "Villarreal",
    "benfica lisbon": "Benfica",
    "newcastle": "Newcastle United",
    "wolverhampton": "Wolverhampton Wanderers",
    "palace": "Crystal Palace",
    "brighton": "Brighton & Hove Albion",
    "villa": "Aston Villa",
    "psg": "Paris Saint Germain",
    "betis": "Real Betis",
    "real betis balompie": "Real Betis",
    "real sociedad de futbol": "Real Sociedad",
    "naples": "Napoli",
    "porto fc": "Porto",
    "ajax amsterdam": "Ajax",
    "feyenoord rotterdam": "Feyenoord",
    "sevilla fc": "Sevilla",
    "club america": "Club America",
}


TEAM_CANONICAL: Dict[str, str] = {**TEAM_CANONICAL_BASE, **TEAM_ALIASES}


def _sanitize_alias(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def _contains_phrase(sanitized_text: str, phrase: str) -> bool:
    sanitized_phrase = _sanitize_alias(phrase)
    if not sanitized_phrase:
        return False
    return f" {sanitized_phrase} " in f" {sanitized_text} "


def _is_league_or_country_phrase(phrase: str) -> bool:
    sanitized = _sanitize_alias(phrase)
    return sanitized in LEAGUE_SANITIZED_LOOKUP or sanitized in COUNTRY_SANITIZED_LOOKUP


TEAM_SANITIZED_LOOKUP: Dict[str, str] = {_sanitize_alias(k): v for k, v in TEAM_CANONICAL.items()}


LEAGUE_SANITIZED_LOOKUP: Dict[str, tuple[str, Optional[str]]] = {
    _sanitize_alias(k): v for k, v in LEAGUE_CANONICAL.items()
}

COUNTRY_SANITIZED_LOOKUP: Dict[str, str] = {_sanitize_alias(k): v for k, v in COUNTRY_CANONICAL.items()}

LEAGUE_ALIAS_SANITIZED: Dict[str, str] = {_sanitize_alias(k): v for k, v in LEAGUE_ALIASES.items()}


TEAM_LOOKUP_ORDERED: List[Tuple[str, str]] = sorted(
    ((k, v) for k, v in TEAM_CANONICAL.items()),
    key=lambda item: len(item[0]),
    reverse=True,
)


def _build_spell_vocab() -> set[str]:
    vocab: set[str] = set()

    def add_phrase(phrase: str) -> None:
        for token in _sanitize_alias(phrase).split():
            if token:
                vocab.add(token)

    for key in LEAGUE_CANONICAL:
        add_phrase(key)
    for display, country in LEAGUE_CANONICAL.values():
        add_phrase(display)
        if country:
            add_phrase(country)
    for alias in LEAGUE_ALIASES.keys():
        add_phrase(alias)
    for value in COUNTRY_CANONICAL.values():
        add_phrase(value)
    for key in COUNTRY_CANONICAL.keys():
        add_phrase(key)
    for key in TEAM_CANONICAL.keys():
        add_phrase(key)

    for keyword in (
        "highlight",
        "highlights",
        "video",
        "videos",
        "table",
        "standings",
        "odds",
        "probabilities",
        "probability",
        "today",
        "yesterday",
        "tomorrow",
        "live",
        "stream",
        "streams",
        "fixture",
        "fixtures",
        "match",
        "matches",
        "game",
        "games",
        "last",
        "past",
        "next",
        "days",
        "weeks",
        "months",
        "year",
    ):
        add_phrase(keyword)

    return vocab


SPELL_DOMAIN_VOCAB: set[str] = _build_spell_vocab()

if SpellChecker:
    SPELL_CHECKER = SpellChecker(distance=1)
    SPELL_CHECKER.word_frequency.load_words(SPELL_DOMAIN_VOCAB)
else:  # pragma: no cover - fallback when spellchecker not installed
    SPELL_CHECKER = None


def _spell_correct_token(token: str) -> Optional[str]:
    if not SPELL_CHECKER:
        return None
    cleaned = re.sub(r"[^a-z]", "", token.lower())
    if len(cleaned) < 3:
        return None
    if cleaned in SPELL_DOMAIN_VOCAB:
        return None
    candidate = SPELL_CHECKER.correction(cleaned)
    if not candidate or candidate == cleaned:
        return None
    if candidate not in SPELL_DOMAIN_VOCAB:
        return None
    if SequenceMatcher(None, cleaned, candidate).ratio() < 0.78:
        return None
    return candidate


def _spell_correct_phrase(text: str) -> str:
    if not SPELL_CHECKER:
        return text
    tokens = re.split(r"\s+", text.strip())
    corrected: List[str] = []
    for token in tokens:
        if not token:
            continue
        candidate = _spell_correct_token(token)
        corrected.append(candidate or token.lower())
    return " ".join(corrected) if corrected else text


def _apply_spell_corrections(text: str) -> str:
    if not SPELL_CHECKER:
        return text

    def repl(match: re.Match[str]) -> str:
        token = match.group(0)
        candidate = _spell_correct_token(token)
        return candidate or token

    return re.sub(r"\b[a-z]{3,}\b", repl, text)


def _has_keyword(text: str, keywords: Iterable[str], cutoff: float = 0.84) -> bool:
    tokens = re.findall(r"[a-z]+", text)
    keyword_set = set(keywords)
    for token in tokens:
        if token in keyword_set:
            return True
        if get_close_matches(token, keyword_set, n=1, cutoff=cutoff):
            return True
    return False


def _closest_key(key: str, mapping: Dict[str, Any], cutoff: float = 0.78) -> Optional[str]:
    if key in mapping:
        return key
    matches = get_close_matches(key, mapping.keys(), n=1, cutoff=cutoff)
    return matches[0] if matches else None


def _normalize_league(raw: str) -> tuple[str, Optional[str]]:
    original = raw.strip()
    if not original:
        return original, None

    key = _spell_correct_phrase(original.lower())
    alias = LEAGUE_ALIASES.get(key)
    if alias:
        key = alias

    resolved_key = _closest_key(key, LEAGUE_CANONICAL, cutoff=0.7)
    if resolved_key:
        return LEAGUE_CANONICAL[resolved_key]

    sanitized = _sanitize_alias(key)
    alias_sanitized = LEAGUE_ALIAS_SANITIZED.get(sanitized)
    if alias_sanitized:
        sanitized = _sanitize_alias(alias_sanitized)

    if sanitized in LEAGUE_SANITIZED_LOOKUP:
        return LEAGUE_SANITIZED_LOOKUP[sanitized]

    resolved_sanitized = _closest_key(sanitized, LEAGUE_SANITIZED_LOOKUP, cutoff=0.74)
    if resolved_sanitized:
        return LEAGUE_SANITIZED_LOOKUP[resolved_sanitized]

    return original, None


def _normalize_country(raw: str) -> str:
    original = raw.strip()
    key = _spell_correct_phrase(original.lower())
    if not key:
        return original
    if key in COUNTRY_CANONICAL:
        return COUNTRY_CANONICAL[key]
    sanitized = _sanitize_alias(key)
    if sanitized in COUNTRY_SANITIZED_LOOKUP:
        return COUNTRY_SANITIZED_LOOKUP[sanitized]
    resolved_key = _closest_key(key, COUNTRY_CANONICAL, cutoff=0.8)
    if resolved_key:
        return COUNTRY_CANONICAL[resolved_key]
    resolved_sanitized = _closest_key(sanitized, COUNTRY_SANITIZED_LOOKUP, cutoff=0.82)
    if resolved_sanitized:
        return COUNTRY_SANITIZED_LOOKUP[resolved_sanitized]
    words = sanitized.split()
    for size in range(len(words), 0, -1):
        chunk = " ".join(words[:size])
        resolved = _closest_key(chunk, COUNTRY_SANITIZED_LOOKUP, cutoff=0.82)
        if resolved:
            return COUNTRY_SANITIZED_LOOKUP[resolved]
    if words:
        resolved_single = _closest_key(words[0], COUNTRY_SANITIZED_LOOKUP, cutoff=0.78)
        if resolved_single:
            return COUNTRY_SANITIZED_LOOKUP[resolved_single]
    return original


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


def _normalize_team(raw: str) -> str:
    original = raw.strip()
    if not original:
        return original
    key = _spell_correct_phrase(original.lower())
    sanitized = _sanitize_alias(key)
    if sanitized in TEAM_SANITIZED_LOOKUP:
        return TEAM_SANITIZED_LOOKUP[sanitized]
    resolved = _closest_key(sanitized, TEAM_SANITIZED_LOOKUP, cutoff=0.78)
    if resolved:
        return TEAM_SANITIZED_LOOKUP[resolved]
    return original


def _cleanup_team_phrase(phrase: str) -> str:
    cleaned = re.sub(r"[.,;:]+", " ", phrase).strip()
    tokens = [tok for tok in cleaned.split() if tok]
    while tokens and tokens[0].lower() in TEAM_LEADING_STOPWORDS:
        tokens.pop(0)
    for idx, token in enumerate(tokens):
        if token.lower() in TEAM_TRAILING_MARKERS:
            tokens = tokens[:idx]
            break
    while tokens and tokens[-1].lower() in TEAM_SUFFIX_STOPWORDS and len(tokens) > 1:
        tokens.pop()
    while tokens and tokens[-1].isdigit():
        tokens.pop()
    return " ".join(tokens).strip()


def _extract_h2h_pair(text: str) -> Optional[Tuple[str, str]]:
    parts = [p.strip() for p in H2H_SPLIT_REGEX.split(text, maxsplit=1) if p.strip()]
    if len(parts) >= 2:
        team_a_raw = parts[0]
        team_b_raw = parts[1]
        secondary = [p.strip() for p in H2H_SPLIT_REGEX.split(team_b_raw, maxsplit=1) if p.strip()]
        if secondary:
            team_b_raw = secondary[0]
        team_a = _cleanup_team_phrase(team_a_raw)
        team_b = _cleanup_team_phrase(team_b_raw)
        if team_a and team_b:
            return _normalize_team(team_a), _normalize_team(team_b)
    return None


def _extract_team_candidate(text: str, normalized_low: str) -> Optional[str]:
    patterns = [
        r"\b(?:for|about|regarding|follow|watch)\s+([a-z0-9 .'\-&]+)",
        r"\bteam\s+([a-z0-9 .'\-&]+)",
        r"\bclub\s+([a-z0-9 .'\-&]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            candidate = _cleanup_team_phrase(match.group(1))
            if candidate and not _is_league_or_country_phrase(candidate):
                return _normalize_team(candidate)

    sanitized_low = _sanitize_alias(normalized_low)
    for alias, canonical in TEAM_LOOKUP_ORDERED:
        if _contains_phrase(sanitized_low, alias):
            return canonical

    m_team = re.search(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,3})\b", text)
    if m_team:
        candidate = _cleanup_team_phrase(m_team.group(1))
        if candidate and not _is_league_or_country_phrase(candidate):
            return _normalize_team(candidate)

    return None


@dataclass
class NLParsed:
    text: str
    entities: Dict[str, Any]
    candidates: List[Dict[str, Any]]  # each: { intent, args, reason }

    def to_dict(self) -> Dict[str, Any]:
        return {"text": self.text, "entities": self.entities, "candidates": self.candidates}


def _fmt_date(dt: datetime) -> str:
    return dt.date().isoformat()


def _safe_date(year: int, month: int, day: int) -> Optional[datetime]:
    try:
        return datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return None


def _extract_date_window(s: str) -> Dict[str, str]:
    """Extract date, from/to window, or live marker from text with fuzzy matching."""
    today = datetime.now(timezone.utc)
    ents: Dict[str, str] = {}

    low = s.lower()
    normalized_low = _apply_spell_corrections(low)

    if re.search(r"\b(live|now)\b", normalized_low):
        ents["live"] = True  # marker; not a date

    def _safe_date_range(start: datetime, end: datetime) -> Dict[str, str]:
        ents["from"] = _fmt_date(start)
        ents["to"] = _fmt_date(end)
        return ents

    def _set_single(day: datetime) -> Dict[str, str]:
        ents["date"] = _fmt_date(day)
        return ents

    if re.search(r"\btoday\b", normalized_low):
        return _set_single(today)
    if re.search(r"\byesterday\b", normalized_low):
        return _set_single(today - timedelta(days=1))
    if re.search(r"\btomorrow\b", normalized_low):
        return _set_single(today + timedelta(days=1))
    if re.search(r"\btonight\b", normalized_low):
        return _set_single(today)

    # ISO or YYYY/MM/DD
    m_iso = re.search(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", normalized_low)
    if m_iso:
        year, month, day = map(int, m_iso.groups())
        dt = _safe_date(year, month, day)
        if dt:
            return _set_single(dt)

    # dd/mm(/yyyy) or dd-mm(-yyyy) - default to current year when missing
    m_dmy = re.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", normalized_low)
    if m_dmy:
        day = int(m_dmy.group(1))
        month = int(m_dmy.group(2))
        year = int(m_dmy.group(3)) if m_dmy.group(3) else today.year
        if year < 100:
            year += 2000
        dt = _safe_date(year, month, day)
        if dt:
            return _set_single(dt)

    # Month name variants (Oct 13 / 13 Oct / October 13, 2025)
    month_patterns = [
        r"\b(?P<month>[a-z]{3,})\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?(?:,\s*(?P<year>\d{2,4}))?\b",
        r"\b(?P<day>\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?P<month>[a-z]{3,})(?:,\s*(?P<year>\d{2,4}))?\b",
    ]
    for pattern in month_patterns:
        m = re.search(pattern, normalized_low)
        if m:
            month_key = m.group("month")
            day = int(m.group("day"))
            year_str = m.group("year")
            month = MONTH_MAP.get(month_key)
            if month:
                year = today.year
                if year_str:
                    year = int(year_str)
                    if year < 100:
                        year += 2000
                dt = _safe_date(year, month, day)
                if dt:
                    return _set_single(dt)

    def _word_to_int(word: str) -> Optional[int]:
        word = word.strip()
        if not word:
            return None
        if word.isdigit():
            return int(word)
        if word in WORD_NUMBER_MAP:
            return WORD_NUMBER_MAP[word]
        if "-" in word:
            total = 0
            for chunk in word.split("-"):
                if chunk not in WORD_NUMBER_MAP:
                    return None
                total += WORD_NUMBER_MAP[chunk]
            return total
        return None

    # last/past X days (numeric or word)
    m_last = re.search(r"\b(last|past)\s+([a-z\-]+|\d+)\s+days?\b", normalized_low)
    if m_last:
        span = _word_to_int(m_last.group(2))
        if span:
            span = max(1, min(span, 60))
            return _safe_date_range(today - timedelta(days=span - 1), today)

    # next X days
    m_next = re.search(r"\bnext\s+([a-z\-]+|\d+)\s+days?\b", normalized_low)
    if m_next:
        span = _word_to_int(m_next.group(1))
        if span:
            span = max(1, min(span, 60))
            return _safe_date_range(today, today + timedelta(days=span - 1))

    # last/next week, month, year quick ranges
    if re.search(r"\b(last|past)\s+week\b", normalized_low):
        return _safe_date_range(today - timedelta(days=6), today)
    if re.search(r"\bnext\s+week\b", normalized_low):
        return _safe_date_range(today, today + timedelta(days=6))
    if re.search(r"\b(last|past)\s+month\b", normalized_low):
        return _safe_date_range(today - timedelta(days=29), today)
    if re.search(r"\bnext\s+month\b", normalized_low):
        return _safe_date_range(today, today + timedelta(days=29))
    if re.search(r"\b(last|past)\s+year\b", normalized_low):
        return _safe_date_range(today - timedelta(days=364), today)

    return ents


def _extract_strings(s: str, normalized_low: Optional[str] = None) -> Dict[str, str]:
    """Extract leagueName, teamName, countryName, and vs pairs from text."""
    ents: Dict[str, str] = {}
    normalized = normalized_low if normalized_low is not None else _apply_spell_corrections(s.lower())
    sanitized_low = _sanitize_alias(normalized)

    # by <league>
    m_by = re.search(r"\bby\s+([^,;]+)$", s, flags=re.I)
    if m_by:
        league_candidate = m_by.group(1).strip(" .")
        if league_candidate:
            ents["leagueName"] = league_candidate

    # in/from <country>
    country_patterns = [
        r"\b(?:in|from)\s+([a-zA-Z][a-zA-Z .']+)",
        r"\bcountry\s*[:=]\s*([a-zA-Z][a-zA-Z .']+)",
    ]
    for pattern in country_patterns:
        m_country = re.search(pattern, s, flags=re.I)
        if not m_country:
            continue
        candidate = m_country.group(1)
        candidate = re.split(
            r"\b(?:league|team|match|matches|game|games|vs|versus|against|highlights?|videos?|results?|scores?|odds?)\b",
            candidate,
            maxsplit=1,
            flags=re.I,
        )[0]
        candidate = re.sub(r"^\s*the\s+", "", candidate.strip(" .,"), flags=re.I)
        if candidate:
            ents["countryName"] = candidate
            break

    # A vs B pattern
    h2h = _extract_h2h_pair(s)
    if h2h:
        ents["teamA"], ents["teamB"] = h2h
    else:
        team_candidate = _extract_team_candidate(s, normalized)
        if team_candidate:
            ents["teamName"] = team_candidate

    if "leagueName" not in ents:
        # Direct alias match
        for alias, canonical in LEAGUE_ALIASES.items():
            if _contains_phrase(sanitized_low, alias):
                ents["leagueName"] = canonical
                break

    if "leagueName" not in ents:
        for key, (display, country) in LEAGUE_CANONICAL.items():
            if _contains_phrase(sanitized_low, key):
                ents["leagueName"] = display
                if country and "countryName" not in ents:
                    ents["countryName"] = country
                break

    if "leagueName" not in ents:
        fuzzy = _fuzzy_league_from_text(normalized)
        if fuzzy:
            league_name, league_country = fuzzy
            ents["leagueName"] = league_name
            if league_country and "countryName" not in ents:
                ents["countryName"] = league_country

    if "countryName" not in ents:
        for key, country in COUNTRY_CANONICAL.items():
            if _contains_phrase(sanitized_low, key):
                ents["countryName"] = country
                break

    return ents


def parse_nl_query(q: str) -> NLParsed:
    if not isinstance(q, str):
        q = str(q or "")
    q_stripped = q.strip()
    low = q_stripped.lower()
    normalized_low = _apply_spell_corrections(low)

    ents: Dict[str, Any] = {}
    ents.update(_extract_date_window(q_stripped))
    ents.update(_extract_strings(q_stripped, normalized_low))

    if "leagueName" in ents:
        league_fixed, inferred_country = _normalize_league(str(ents["leagueName"]))
        ents["leagueName"] = league_fixed
        if inferred_country and not ents.get("countryName"):
            ents["countryName"] = inferred_country

    if "countryName" in ents:
        ents["countryName"] = _normalize_country(str(ents["countryName"]))

    if "teamName" in ents:
        ents["teamName"] = _normalize_team(str(ents["teamName"]))
    if "teamA" in ents:
        ents["teamA"] = _normalize_team(str(ents["teamA"]))
    if "teamB" in ents:
        ents["teamB"] = _normalize_team(str(ents["teamB"]))

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
    highlight_keywords = {"highlight", "highlights", "video", "videos", "clip", "clips"}
    standings_keywords = {"table", "standings"}
    odds_keywords = {"odds", "odd"}
    probabilities_keywords = {"probability", "probabilities", "prob"}
    if _has_keyword(normalized_low, highlight_keywords):
        topic = "highlights"
    elif _has_keyword(normalized_low, standings_keywords):
        topic = "standings"
    elif _has_keyword(normalized_low, odds_keywords):
        topic = "odds"
    elif _has_keyword(normalized_low, probabilities_keywords):
        topic = "probabilities"
    elif re.search(r"\bh2h\b", normalized_low) or re.search(r"head\s*to\s*head", normalized_low):
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
        if "date" in args:
            date_val = args.pop("date")
            args["from"] = date_val
            args["to"] = date_val
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
