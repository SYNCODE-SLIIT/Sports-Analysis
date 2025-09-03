"""Lightweight, zero-cost highlight search helper.

Builds structured search queries for a specific match event (e.g. goal at 67',
player name, teams) and attempts a VERY shallow scrape of public search result
pages (DuckDuckGo + site:youtube.com) to extract a few candidate highlight
links. This avoids the need for the YouTube Data API (no key / quota), while
remaining conservative (no aggressive crawling, only first page, low timeout).

Returned shape (example):
{
  "ok": true,
  "query": "Arsenal vs Chelsea 67' Saka goal 2025",
  "variants": ["Arsenal vs Chelsea 67' Saka goal 2025", ...],
  "results": {
     "youtube_search_url": "https://www.youtube.com/results?search_query=...",
     "duckduckgo_search_url": "https://duckduckgo.com/html/?q=...",
     "duckduckgo_scraped": [
         {"title": "...", "url": "https://www.youtube.com/watch?v=...", "videoId": "..."}
     ]
  },
  "meta": {"source": "duckduckgo_html", "scraped_count": 3}
}

If scraping fails (layout change / network), we still return the constructed
search URLs so the frontend can open them in a new tab.

NOTE: This performs HTML scraping of public pages. Keep request volume low to
avoid breaching service rate limits. Consider adding a tiny in-memory cache if
throttling becomes necessary.
"""
from __future__ import annotations

from typing import Dict, Any, List
import re
import urllib.parse
import requests
from bs4 import BeautifulSoup  # type: ignore

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

def _clean_text(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def build_query(args: Dict[str, Any]) -> Dict[str, Any]:
    home = _clean_text(args.get("homeTeam") or args.get("event_home_team"))
    away = _clean_text(args.get("awayTeam") or args.get("event_away_team"))
    minute = str(args.get("minute") or args.get("event_minute") or "").strip("'")
    player = _clean_text(args.get("player") or args.get("player_name") or args.get("scorer"))
    event_type = _clean_text(args.get("event_type") or args.get("type") or args.get("detail") or args.get("event_type2"))
    date = _clean_text(args.get("date") or args.get("event_date"))  # YYYY-MM-DD
    year = date.split("-")[0] if date else ""

    # Keyword heuristics
    evt_kw = []
    if event_type:
        lowered = event_type.lower()
        if "goal" in lowered and "pen" in lowered:
            evt_kw.append("penalty goal")
        elif "goal" in lowered and "own" in lowered:
            evt_kw.append("own goal")
        elif "goal" in lowered:
            evt_kw.append("goal")
        elif any(k in lowered for k in ["red", "yellow"]):
            evt_kw.append("red card" if "red" in lowered else "yellow card")
        elif "sub" in lowered:
            evt_kw.append("substitution")
        elif "var" in lowered:
            evt_kw.append("VAR")
    if not evt_kw and event_type:
        evt_kw.append(event_type)

    core = f"{home} vs {away}".strip()
    parts: List[str] = [core]
    if minute:
        parts.append(f"{minute}'")
    if player:
        parts.append(player)
    parts += evt_kw
    if year:
        parts.append(year)
    base_query = _clean_text(" ".join(p for p in parts if p))

    variants = [base_query]
    # Add a couple of variants to broaden search if needed
    if minute and evt_kw:
        variants.append(base_query.replace(f"{minute}'", f"{minute} minute"))
    if "goal" in " ".join(evt_kw) and player:
        variants.append(f"{player} {core} goal {year}".strip())

    return {"base": base_query, "variants": list(dict.fromkeys(v for v in variants if v))}


def _scrape_duckduckgo(q: str, max_results: int = 5) -> List[Dict[str, Any]]:
    ddg_q = urllib.parse.quote_plus(q + " site:youtube.com")
    url = f"https://duckduckgo.com/html/?q={ddg_q}"
    try:
        r = requests.get(url, timeout=8, headers={"User-Agent": USER_AGENT})
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
        out: List[Dict[str, Any]] = []
        for a in soup.select("a.result__a"):
            href = a.get("href") or ""
            if "youtube.com/watch" not in href:
                continue
            title = _clean_text(a.get_text())
            # Extract videoId
            vid = None
            m = re.search(r"[?&]v=([A-Za-z0-9_-]{6,})", href)
            if m:
                vid = m.group(1)
            out.append({"title": title, "url": href, "videoId": vid})
            if len(out) >= max_results:
                break
        return out
    except Exception:
        return []


def search_event_highlights(args: Dict[str, Any]) -> Dict[str, Any]:
    built = build_query(args)
    base = built["base"]
    variants = built["variants"]

    # Try scraping first variant
    scraped = _scrape_duckduckgo(variants[0]) if variants else []
    yt_search_url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote_plus(base)
    ddg_search_url = "https://duckduckgo.com/?q=" + urllib.parse.quote_plus(base + " site:youtube.com")

    return {
        "ok": True,
        "query": base,
        "variants": variants,
        "results": {
            "youtube_search_url": yt_search_url,
            "duckduckgo_search_url": ddg_search_url,
            "duckduckgo_scraped": scraped,
        },
        "meta": {"source": "duckduckgo_html", "scraped_count": len(scraped)},
    }


__all__ = ["search_event_highlights", "build_query"]
