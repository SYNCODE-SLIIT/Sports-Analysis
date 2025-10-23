# summarizer_service.py
from __future__ import annotations

import os
import uuid
import asyncio
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup

# -----------------------
# Config / Env
# -----------------------
AGENT_MODE = os.getenv("AGENT_MODE", "local")  # "local" or "http"
# If AGENT_MODE="http", set these to the microservice URLs for your agents
# Default to the running app's /collect endpoint so single-process dev works without env overrides
TSDB_AGENT_URL = os.getenv("TSDB_AGENT_URL", "http://127.0.0.1:8000/collect")
ALLSPORTS_AGENT_URL = os.getenv("ALLSPORTS_AGENT_URL", "http://127.0.0.1:8000/collect")

# LLM (Groq)
try:
    from groq import Groq
except Exception:
    Groq = None

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.35"))
NEWS_SUMMARY_USER_AGENT = os.getenv(
    "NEWS_SUMMARY_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
NEWS_SUMMARY_MAX_CHARS = int(os.getenv("NEWS_SUMMARY_MAX_CHARS", "12000"))
NEWS_SUMMARY_TIMEOUT = float(os.getenv("NEWS_SUMMARY_TIMEOUT", "12.0"))

# Optional: import your agents for local mode (robust to different import roots)
CollectorAgentV2 = None
AllSportsRawAgent = None
if AGENT_MODE == "local":
    try:
        # Prefer relative imports when running inside the package
        from .collector import CollectorAgentV2 as _Collector
        from .collector_agent import AllSportsRawAgent as _Raw
        CollectorAgentV2 = _Collector
        AllSportsRawAgent = _Raw
    except Exception:
        try:
            # Fallback to absolute package path
            from backend.app.agents.collector import CollectorAgentV2 as _Collector2
            from backend.app.agents.collector_agent import AllSportsRawAgent as _Raw2
            CollectorAgentV2 = _Collector2
            AllSportsRawAgent = _Raw2
        except Exception:
            # Final fallback: leave as None so HTTP mode will be used
            pass

# If AGENT_MODE was requested as 'local' but the local agent classes couldn't be
# imported, switch to HTTP mode automatically so the app continues to function
# when mounted in environments where local agents are not available.
if AGENT_MODE == "local" and (CollectorAgentV2 is None or AllSportsRawAgent is None):
    AGENT_MODE = "http"

import httpx
import re

app = FastAPI(title="Summarizer Agent", version="2.0")
# Enable CORS (same policy as main app) so frontend on other origins can call this mounted sub-app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------
# Models
# -----------------------
class SummarizeRequest(BaseModel):
    # Identify the match
    eventId: Optional[str] = None
    eventName: Optional[str] = None
    date: Optional[str] = None            # YYYY-MM-DD (optional disambiguation)
    season: Optional[str] = None          # e.g., "2024-2025"
    provider: str = Field(default="auto", pattern="^(auto|tsdb|allsports)$")
    # Options
    timezone: Optional[str] = None
    idempotency_key: Optional[str] = None
    trace_id: Optional[str] = None


class SummaryOut(BaseModel):
    ok: bool
    headline: str
    one_paragraph: str
    bullets: List[str]
    key_events: List[Dict[str, Any]]
    star_performers: List[Dict[str, Any]]
    numbers: Dict[str, Any]
    source_meta: Dict[str, Any]


# Lightweight event-brief schemas
class EventBriefItemIn(BaseModel):
    minute: Optional[str] = None
    type: Optional[str] = None  # goal | substitution | yellow card | red card | etc
    description: Optional[str] = None
    player: Optional[str] = None
    team: Optional[str] = None
    tags: Optional[List[str]] = None

class EventBriefsRequest(BaseModel):
    # Optional match context (not required)
    eventId: Optional[str] = None
    eventName: Optional[str] = None
    date: Optional[str] = None
    provider: str = Field(default="auto", pattern="^(auto|tsdb|allsports)$")
    events: List[EventBriefItemIn]

class EventBriefItemOut(BaseModel):
    minute: Optional[str] = None
    type: Optional[str] = None
    brief: str
    player_image: Optional[str] = None
    team_logo: Optional[str] = None
    player: Optional[str] = None
    player_id: Optional[str] = None

class EventBriefsOut(BaseModel):
    ok: bool
    items: List[EventBriefItemOut]


class NewsSummaryRequest(BaseModel):
    url: Optional[str] = None
    title: Optional[str] = None
    text: Optional[str] = None
    max_words: int = Field(default=150, ge=60, le=400)


class NewsSummaryOut(BaseModel):
    ok: bool
    title: Optional[str]
    summary: str
    bullets: List[str]
    url: Optional[str] = None
    original_word_count: Optional[int] = None


# -----------------------
# Utilities
# -----------------------
def new_trace_id() -> str:
    return f"tr_{uuid.uuid4().hex[:12]}"

def _short(s: str | None, n: int = 120) -> str:
    if not s:
        return ""
    return s if len(s) <= n else s[: n - 1] + "…"
# ⬇️ ADD THESE HELPERS RIGHT AFTER _short(...)
def word_count(s: str | None) -> int:
    return len((s or "").strip().split())

def _truncate_brief(s: str | None, max_words: int = 35) -> str:
    """Return a short brief: prefer full sentences up to max_words, otherwise cut to max_words words."""
    if not s:
        return ""
    txt = str(s).strip()
    # try to keep full sentences: split on sentence enders
    sentences = [seg.strip() for seg in re.split(r'(?<=[\.\!\?])\s+', txt) if seg.strip()]
    out = ""
    if sentences:
        # accumulate sentences until word limit reached
        words = 0
        parts: list[str] = []
        for sent in sentences:
            wc = len(sent.split())
            if words + wc <= max_words or not parts:
                parts.append(sent)
                words += wc
            else:
                break
        out = " ".join(parts)
    if not out:
        # fallback: cut by words
        w = txt.split()
        out = " ".join(w[:max_words])
        if len(w) > max_words:
            out = out.rstrip() + "…"
    return out

def _minute_of_first_goal(timeline: list[dict]) -> str | None:
    mins = []
    for ev in (timeline or []):
        kind = (ev.get("type") or ev.get("event") or ev.get("card") or "").lower()
        is_goal = (
            "goal" in kind
            or kind in {"g", "scorer", "score"}
            or bool(ev.get("home_scorer"))
            or bool(ev.get("away_scorer"))
        )
        if is_goal:
            m = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
            if m:
                mins.append(str(m).strip("′ '"))
    return mins[0] if mins else None

def _minute_of_equalizer(score_home: int | None, score_away: int | None, timeline: list[dict]) -> str | None:
    if score_home is None or score_away is None:
        return None
    h, a = 0, 0
    for ev in (timeline or []):
        kind = (ev.get("type") or ev.get("event") or "").lower()
        is_goal = (
            "goal" in kind
            or kind in {"g", "scorer", "score"}
            or bool(ev.get("home_scorer"))
            or bool(ev.get("away_scorer"))
        )
        if is_goal:
            side = (ev.get("team") or ev.get("side") or "").lower()
            # Infer side for AllSports shapes
            if not side:
                if ev.get("home_scorer") or ev.get("home_fault"): side = "home"
                elif ev.get("away_scorer") or ev.get("away_fault"): side = "away"
            if not side and ev.get("score"):
                try:
                    parts = [int(x) for x in str(ev["score"]).replace("-", " ").split() if x.isdigit()]
                    if len(parts) == 2:
                        h, a = parts[0], parts[1]
                except Exception:
                    pass
            else:
                if "home" in side: h += 1
                elif "away" in side: a += 1
            if h == a and h > 0:
                m = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
                return str(m).strip("′ '") if m else None
    return None


# -----------------------
# Article helpers
# -----------------------
def _normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _node_to_paragraphs(node) -> List[str]:
    if node is None:
        return []
    paragraphs: List[str] = []
    for tag in node.find_all(["p", "li", "h2", "h3"]):
        if tag.name in {"script", "style"}:
            continue
        snippet = tag.get_text(" ", strip=True)
        if not snippet:
            continue
        if len(snippet.split()) < 5:
            continue
        paragraphs.append(_normalize_spaces(snippet))
    return paragraphs


def _extract_article_text(soup: BeautifulSoup) -> str:
    if soup is None:
        return ""

    candidates: List[str] = []
    seen: set[int] = set()
    selectors = [
        "article",
        "main",
        "[role='main']",
        "section",
        "div[itemprop='articleBody']",
        "div[class*='article']",
        "div[class*='story']",
        "div[class*='content']",
    ]

    for selector in selectors:
        try:
            for node in soup.select(selector):
                if id(node) in seen:
                    continue
                seen.add(id(node))
                paras = _node_to_paragraphs(node)
                if not paras:
                    continue
                text = "\n\n".join(paras)
                if word_count(text) >= 80:
                    candidates.append(text)
        except Exception:
            continue

    if not candidates and soup.body:
        paras = _node_to_paragraphs(soup.body)
        if paras:
            candidates.append("\n\n".join(paras))

    if not candidates:
        paras = _node_to_paragraphs(soup)
        if paras:
            candidates.append("\n\n".join(paras))

    if not candidates:
        return ""

    return max(candidates, key=lambda txt: word_count(txt))


def _clip_article_text(text: str, max_chars: int = NEWS_SUMMARY_MAX_CHARS) -> str:
    if not text or len(text) <= max_chars:
        return text or ""
    clipped = text[:max_chars]
    last_space = clipped.rfind(" ")
    if last_space > max_chars * 0.6:
        clipped = clipped[:last_space]
    return clipped.strip()


async def _fetch_article_text(url: str) -> tuple[Optional[str], str]:
    headers = {"User-Agent": NEWS_SUMMARY_USER_AGENT}
    try:
        async with httpx.AsyncClient(headers=headers, timeout=NEWS_SUMMARY_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(url)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch article: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=f"Article fetch failed with status {response.status_code}")

    html = response.text or ""
    if not html.strip():
        raise HTTPException(status_code=502, detail="Article response was empty")

    soup = BeautifulSoup(html, "html.parser")

    title = None
    try:
        raw_title = soup.title.string if soup.title else None
        if raw_title:
            title = _normalize_spaces(raw_title)
    except Exception:
        title = None

    body_text = _extract_article_text(soup)
    if not body_text or word_count(body_text) < 40:
        raise HTTPException(status_code=502, detail="Unable to extract article body")
    return title, _clip_article_text(body_text)


async def _summarize_news_article(title: Optional[str], text: str, max_words: int = 150) -> Dict[str, Any]:
    cleaned = text.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail="Article text empty after cleaning")

    if Groq is None or not GROQ_API_KEY:
        paragraphs = cleaned.split("\n\n")
        snippet = " ".join(paragraphs[:4])
        summary = _truncate_brief(snippet, max_words)
        bullets: List[str] = []
        if paragraphs:
            bullets = [_truncate_brief(p, 25) for p in paragraphs[:3]]
        return {
            "title": title or "Article Summary",
            "summary": summary or snippet[:280],
            "bullets": [b for b in bullets if b],
        }

    system_prompt = (
        "You are a precise sports news editor. Summarize the provided article factually. "
        "Return concise copy with a neutral tone."
    )
    headline = title or ""
    user_prompt = (
        f"Title: {headline}\n\nArticle:\n{cleaned}\n\n"
        "Produce JSON with keys: summary (120-160 words narrative paragraph) and bullets (array of 3-5 punchy bullet points). "
        "Each bullet <= 24 words, no hype."
    )

    import json

    def _invoke():
        client = Groq(api_key=GROQ_API_KEY)
        return client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            model=GROQ_MODEL,
            temperature=min(LLM_TEMPERATURE, 0.4),
            response_format={"type": "json_object"},
            max_tokens=700,
        )

    try:
        chat = await asyncio.to_thread(_invoke)
        content = chat.choices[0].message.content if chat.choices else ""
        data = json.loads(content or "{}")
        summary = _normalize_spaces(str(data.get("summary") or data.get("synopsis") or ""))
        bullets_raw = data.get("bullets") or data.get("highlights") or []
        bullets_clean: List[str] = []
        if isinstance(bullets_raw, list):
            for item in bullets_raw:
                if isinstance(item, str) and item.strip():
                    bullets_clean.append(_normalize_spaces(item))
        if not summary:
            summary = _truncate_brief(cleaned, max_words)
        if not bullets_clean:
            bullets_clean = [
                _truncate_brief(part, 20)
                for part in cleaned.split("\n\n")[:3]
                if part.strip()
            ]
        return {
            "title": title or data.get("title") or "Article Summary",
            "summary": summary,
            "bullets": bullets_clean[:5],
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Summarizer LLM failed: {exc}") from exc


def _is_live_status(status: str | None) -> bool | None:
    s = (status or "").strip().lower()
    if not s:
        return None
    # Finished keywords (TSDB/AllSports variants)
    finished_keys = ["ft", "full", "finished", "match finished", "ended", "aet", "pen", "after extra time"]
    if any(k in s for k in finished_keys):
        return False
    # AllSports often uses numeric minutes or HT, 1st Half, etc.
    live_keys = ["live", "1st", "2nd", "half", "ht", "paused", "extra time", "stoppage"]
    if any(k in s for k in live_keys):
        return True
    # Pure number like "89" -> in-progress minute
    if s.isdigit():
        try:
            m = int(s)
            if 0 < m <= 140:
                return True
        except Exception:
            pass
    # Not started / scheduled
    ns_keys = ["ns", "not started", "scheduled", "postp", "postponed"]
    if any(k in s for k in ns_keys):
        return None
    return None


async def _extract_image_from_player_response(resp: Dict[str, Any]) -> Optional[str]:
    """Given a collector response for player.get / players.list, try to extract a usable image URL."""
    try:
        if not resp:
            return None
        # resp may be a dict with 'data' containing provider body
        body = None
        if isinstance(resp, dict):
            body = resp.get('data') or resp.get('result') or resp
        else:
            body = resp
        # common shapes: {'result': [player_obj,...]} or {'data': {'result':[...]} } or {'player': {...}}
        if isinstance(body, dict) and isinstance(body.get('result'), list) and body.get('result'):
            p = body['result'][0]
        elif isinstance(body, list) and body:
            p = body[0]
        elif isinstance(body, dict) and body.get('data') and isinstance(body.get('data'), dict) and isinstance(body['data'].get('result'), list):
            p = body['data']['result'][0]
        elif isinstance(body, dict) and isinstance(body.get('player'), dict):
            p = body.get('player')
        else:
            # try to find any dict in body that looks like a player
            p = None
            if isinstance(body, dict):
                for v in body.values():
                    if isinstance(v, dict):
                        # if this nested dict directly contains image keys, use it
                        p = v
                        break
                    if isinstance(v, list) and v and isinstance(v[0], dict):
                        p = v[0]
                        break
        if not p or not isinstance(p, dict):
            return None
        # look for common image keys
        for k in ('player_image','player_photo','photo','thumb','thumbnail','img','avatar','headshot','strThumb','strCutout','photo_url','player_cutout'):
            v = p.get(k)
            if v and isinstance(v, str) and v.strip():
                return v.strip()
        # nested under p.get('player')
        nested = p.get('player') or p.get('attributes') or p.get('profile')
        if isinstance(nested, dict):
            for k in ('photo','player_image','img','avatar','headshot','photo_url'):
                v = nested.get(k)
                if v and isinstance(v, str) and v.strip():
                    return v.strip()
    except Exception:
        pass
    return None


async def _resolve_player_images_for_items(items: List[Dict[str, Any]], trace: List[Dict[str, Any]]):
    """For summarizer items: if item has player_id but no player_image, call collector player.get to fetch and set player_image when available."""
    if not items:
        return items
    for it in items:
        try:
            if not isinstance(it, dict):
                continue
            if it.get('player_image'):
                continue
            pid = it.get('player_id') or (it.get('player') and None)
            if not pid:
                continue
            # call collector player.get
            try:
                presp = await call_tsdb_agent({'intent': 'player.get', 'args': {'playerId': str(pid)}}, trace)
                img = await _extract_image_from_player_response(presp)
                if img:
                    it['player_image'] = img
                else:
                    try:
                        print(f"[summarizer-debug] player.get returned (no image) for pid={pid} keys={list((presp or {}).keys())} peek={str((presp or {}) )[:400]}")
                    except Exception:
                        pass
                    # Fallback: try calling AllSports agent directly if TSDB returned empty
                    try:
                        asp = await call_allsports_agent({'intent': 'player.get', 'args': {'playerId': str(pid)}}, trace)
                        aimg = await _extract_image_from_player_response(asp)
                        if aimg:
                            it['player_image'] = aimg
                    except Exception:
                        pass
            except Exception:
                continue
        except Exception:
            continue
    return items


def _latest_minute(timeline: list[dict]) -> str | None:
    for ev in reversed(timeline or []):
        m = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
        if m:
            return str(m).strip("′ '")
    return None


async def _llm_event_briefs(context: Dict[str, Any], events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generate descriptive per-event briefs (1–3 sentences) for key timeline events.
    Uses Groq when available with compact, structured prompting; otherwise
    falls back to deterministic templates. Output is a list aligned to the
    input order with minute, type, brief, player_image and team_logo fields.
    """
    import json

    def _extract_images_from_event(e: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
        # Try many common keys across providers for player image and team/logo
        player_img = None
        team_logo = None
        players = e.get("players") or e.get("player") or []
        if isinstance(players, list) and players:
            p = players[0]
            if isinstance(p, dict):
                for k in ("player_image", "player_photo", "photo", "thumb", "playerImage", "strThumb", "strCutout", "thumbnail", "img", "avatar", "headshot"):
                    v = p.get(k)
                    if v:
                        player_img = v
                        break
        # event-level player image
        if not player_img:
            for k in ("player_image", "player_photo", "photo", "thumb", "img", "avatar", "headshot"):
                if e.get(k):
                    player_img = e.get(k)
                    break

        # team logos: check event.team or context teams/home/away
        team = e.get("team") or e.get("side") or None
        if isinstance(team, dict):
            for k in ("logo", "team_logo", "badge", "crest", "teamLogo", "strTeamBadge", "logoUrl"):
                if team.get(k):
                    team_logo = team.get(k)
                    break
        # common top-level match logos
        if not team_logo:
            match = ctx.get("match") or ctx.get("metadata") or ctx or {}
            for k in ("homeLogo", "awayLogo", "home_badge", "away_badge", "home_logo", "away_logo", "strTeamBadge"):
                if match.get(k):
                    team_logo = match.get(k)
                    break
        return player_img, team_logo

    # If Groq unavailable, deterministic fallback but include image extraction
    if Groq is None or not GROQ_API_KEY:
        out: List[Dict[str, Any]] = []
        for ev in events:
            t = (ev.get("type") or "").lower()
            minute = ev.get("minute") or ev.get("time")
            player = ev.get("player") or ev.get("home_scorer") or ev.get("away_scorer")
            team = ev.get("team") or ""
            desc = ev.get("description") or ev.get("text") or ev.get("event") or ""
            brief = desc or f"{t.title()} at {minute or '?'} by {player or 'unknown'} {('('+team+')') if team else ''}".strip()
            player_img, team_logo = _extract_images_from_event(ev, context)
            out.append({"minute": minute, "type": t or None, "brief": brief, "player_image": player_img, "team_logo": team_logo})
        return out

    # Build compact lines for events to include in the LLM prompt
    teams = context.get("teams") or {}
    score = context.get("score") or {}
    comp = context.get("competition") or ""
    header = f"{teams.get('home','')} vs {teams.get('away','')} — {comp} — score {score.get('home')}–{score.get('away')}"
    lines = []
    for i, ev in enumerate(events):
        minute = ev.get("minute") or ev.get("time") or ""
        kind = ev.get("type") or ev.get("event") or ev.get("card") or ev.get("info") or ""
        who = (
            ev.get("player")
            or ev.get("player_name")
            or ev.get("home_scorer")
            or ev.get("away_scorer")
            or ev.get("fault")
            or ""
        )
        team = ev.get("team") or ev.get("side") or ""
        note = ev.get("assist") or ev.get("score") or ev.get("result") or ev.get("description") or ""
        minute_label = (str(minute) + "′ ") if minute else ""
        line = f"[{i}] {minute_label}{kind}: {who} {note} {(f'team={team}' if team else '')}".strip()
        if len(line) > 200:
            line = line[:199] + "…"
        lines.append(line)

    system = (
        "You are an insightful football analyst. For each event, write a clear, vivid brief in 1–3 sentences (aim 25–65 words). "
        "Be strictly factual and use only provided data. Mention the minute, player and team when available. "
        "For goals, clarify whether it opens the scoring, levels the match, or changes the lead if score info is present. "
        "Return output as strict JSON with an 'items' array where each item has: index (int), brief (string), player_image (string|null), team_logo (string|null)."
    )

    user = (
        header
        + "\nEvents:\n- "
        + ("\n- ".join(lines) if lines else "None")
        + "\n\nRespond ONLY as a JSON object with key 'items' containing an array of objects: {\"items\":[{\"index\":number,\"brief\":string,\"player_image\":string|null,\"team_logo\":string|null}, ...]}."
    )

    client = Groq(api_key=GROQ_API_KEY)
    try:
        try:
            chat = await asyncio.to_thread(
                client.chat.completions.create,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                model=GROQ_MODEL,
                temperature=min(LLM_TEMPERATURE, 0.35),
                response_format={"type": "json_object"},
                max_tokens=800,
            )
            raw = chat.choices[0].message.content
            parsed = json.loads(raw)
            items = parsed.get("items") if isinstance(parsed, dict) else parsed
        except Exception as _e:
            try:
                print(f"[summarizer-error] Groq call/parse failed: {_e} raw_output={repr(raw)[:800]}")
            except Exception:
                print(f"[summarizer-error] Groq call/parse failed: {_e}")
            items = None

        out: List[Dict[str, Any]] = []
        if isinstance(items, list):
            for it in items:
                try:
                    if not isinstance(it, dict):
                        continue
                    i = it.get("index")
                    brief = it.get("brief")
                    player_image = it.get("player_image") if "player_image" in it else None
                    team_logo = it.get("team_logo") if "team_logo" in it else None
                    if isinstance(i, int) and isinstance(brief, str):
                        ev = events[i] if 0 <= i < len(events) else {}
                        # fallback to extracting images from event/context when LLM returned null
                        pi, tl = _extract_images_from_event(ev, context)
                        if not player_image:
                            player_image = pi
                        if not team_logo:
                            team_logo = tl
                        out.append({
                            "minute": ev.get("minute") or ev.get("time"),
                            "type": (ev.get("type") or ev.get("event") or ev.get("card") or "").lower() or None,
                            "brief": brief.strip(),
                            "player_image": player_image,
                            "team_logo": team_logo,
                        })
                except Exception:
                    continue
        if out:
            return out
    except Exception:
        # fall through to templates
        pass

    # Fallback template summaries (more descriptive) with image extraction
    templated: List[Dict[str, Any]] = []
    for ev in events:
        t = (ev.get("type") or ev.get("event") or ev.get("card") or "").lower()
        minute = ev.get("minute") or ev.get("time")
        player = ev.get("player") or ev.get("home_scorer") or ev.get("away_scorer") or ev.get("player_name")
        team = ev.get("team") or ev.get("side") or ""
        score_note = (ev.get("score") or "").strip()
        assist = (ev.get("assist") or "").strip()
        if t.startswith("goal") or t == "goal":
            parts = []
            who = player or "Unknown scorer"
            when = f"{minute or '?'}′"
            parts.append(f"{who} strikes at {when}{(' for '+team) if team else ''}")
            if assist:
                parts.append(f"after an assist from {assist}")
            if score_note:
                parts.append(f"({score_note})")
            brief = ". ".join([" ".join(parts), "A decisive moment that shifts the momentum."]).strip()
        elif "yellow" in t:
            who = player or "Unknown player"
            when = f"{minute or '?'}′"
            brief = f"{who}{(' ('+team+')') if team else ''} is booked at {when}. The caution tempers challenges and forces greater discipline.".strip()
        elif "red" in t:
            who = player or "Unknown player"
            when = f"{minute or '?'}′"
            brief = f"{who}{(' ('+team+')') if team else ''} is sent off at {when}, leaving the side a player short and changing the dynamic of the match.".strip()
        elif "substitution" in t or t == "sub":
            desc = ev.get("description")
            in_p = ev.get("in_player") or ev.get("substitution")
            out_p = ev.get("out_player")
            if desc:
                brief = desc
            else:
                who = (f"{in_p} for {out_p}" if (in_p or out_p) else "Change made")
                when = f"{minute or '?'}′"
                brief = f"Substitution at {when}{(' for '+team) if team else ''}: {who}. Fresh legs to alter the tempo.".strip()
        else:
            base = ev.get("description") or (t.title() if t else "Event")
            when = f"{minute or '?'}′"
            brief = f"{base} around {when}{(' ('+team+')') if team else ''}.".strip()
        pi, tl = _extract_images_from_event(ev, context)
        templated.append({"minute": minute, "type": t or None, "brief": brief, "player_image": pi, "team_logo": tl})
    return templated


# -----------------------
# Low-level agent callers
# -----------------------
async def call_tsdb_agent(payload: Dict[str, Any], trace: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Call CollectorAgentV2 either locally or via HTTP."""
    trace.append({"step": "call_tsdb_agent", "mode": AGENT_MODE, "intent": payload.get("intent")})
    if AGENT_MODE == "local":
        if not CollectorAgentV2:
            # Local agent not importable — fall through to HTTP behaviour
            pass
        try:
            agent = CollectorAgentV2()
            resp = agent.handle(payload)
            # If local handler signals failure, fall back to HTTP
            if isinstance(resp, dict) and resp.get("ok") is False:
                raise RuntimeError("local-tsdb-failed")
            return resp
        except Exception:
            # Try HTTP fallback when local mode fails at runtime
            async with httpx.AsyncClient(timeout=25) as client:
                r = await client.post(TSDB_AGENT_URL, json=payload)
                return r.json()
    else:
        # If the configured TSDB_AGENT_URL targets this same FastAPI app's /collect
        # and we can import the main.collect handler, call it directly to avoid
        # making a loopback HTTP request which may fail in single-process dev.
        try:
            if (TSDB_AGENT_URL and ("127.0.0.1" in TSDB_AGENT_URL or "localhost" in TSDB_AGENT_URL) and TSDB_AGENT_URL.rstrip('/').endswith('/collect')):
                try:
                    from backend.app.main import collect as main_collect
                    # main.collect expects a request dict
                    return main_collect(payload)
                except Exception:
                    pass
        except Exception:
            pass
        async with httpx.AsyncClient(timeout=25) as client:
            # Debug: log outgoing HTTP payload
            try:
                print(f"[summarizer-debug] POST TSDB_AGENT_URL={TSDB_AGENT_URL} payload={str(payload)[:800]}")
            except Exception:
                pass
            r = await client.post(TSDB_AGENT_URL, json=payload)
            return r.json()

async def call_allsports_agent(payload: Dict[str, Any], trace: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Call AllSportsRawAgent either locally or via HTTP."""
    trace.append({"step": "call_allsports_agent", "mode": AGENT_MODE, "intent": payload.get("intent")})
    if AGENT_MODE == "local":
        if not AllSportsRawAgent:
            # Local agent not importable — fall through to HTTP behaviour
            pass
        try:
            agent = AllSportsRawAgent()
            resp = agent.handle(payload)
            if isinstance(resp, dict) and resp.get("ok") is False:
                raise RuntimeError("local-allsports-failed")
            return resp
        except Exception:
            async with httpx.AsyncClient(timeout=25) as client:
                r = await client.post(ALLSPORTS_AGENT_URL, json=payload)
                return r.json()
    else:
        try:
            if (ALLSPORTS_AGENT_URL and ("127.0.0.1" in ALLSPORTS_AGENT_URL or "localhost" in ALLSPORTS_AGENT_URL) and ALLSPORTS_AGENT_URL.rstrip('/').endswith('/collect')):
                try:
                    from backend.app.main import collect as main_collect
                    return main_collect(payload)
                except Exception:
                    pass
        except Exception:
            pass
        async with httpx.AsyncClient(timeout=25) as client:
            # Debug: log outgoing HTTP payload
            try:
                print(f"[summarizer-debug] POST ALLSPORTS_AGENT_URL={ALLSPORTS_AGENT_URL} payload={str(payload)[:800]}")
            except Exception:
                pass
            r = await client.post(ALLSPORTS_AGENT_URL, json=payload)
            return r.json()


# -----------------------
# Normalizers (minimal, safe)
# These convert TSDB/AllSports raw-ish payloads into a tiny internal shape
# for prompting: teams, score, venue, date, competition, timeline, stats, lineup.
# -----------------------
def norm_tsdb_event(bundle: Dict[str, Any]) -> Dict[str, Any]:
    """
    bundle = data from CollectorAgentV2 event.get:
    {
      "event": {...},                       # (picked candidate if uniquely resolved)
      "candidates": [...],                  # for transparency
      "timeline": [...], "stats": [...], "lineup": [...]
    }
    """
    ev = (bundle or {}).get("event") or {}
    # Basic keys often present in TSDB event objects
    home = ev.get("strHomeTeam") or ev.get("strHomeTeamBadge") or ""
    away = ev.get("strAwayTeam") or ev.get("strAwayTeamBadge") or ""
    hs = ev.get("intHomeScore") or ev.get("intHomeScoreFT") or ev.get("intHomeGoal") or None
    as_ = ev.get("intAwayScore") or ev.get("intAwayScoreFT") or ev.get("intAwayGoal") or None
    comp = ev.get("strLeague") or ""
    round_ = ev.get("intRound") or ev.get("strRound") or ""
    venue = ev.get("strVenue") or ""
    date = ev.get("dateEventLocal") or ev.get("dateEvent") or ev.get("strTimestamp") or ""
    time_local = ev.get("strTimeLocal") or ev.get("strTime") or ""
    status = ev.get("strStatus") or ev.get("strProgress") or ""

    # Coerce provider expansions to lists (TSDB returns "Patreon Only" string for timeline without paid key)
    raw_tl = (bundle or {}).get("timeline") or []
    raw_stats = (bundle or {}).get("stats") or []
    raw_lineup = (bundle or {}).get("lineup") or []
    tl_list = raw_tl if isinstance(raw_tl, list) else []
    stats_list = raw_stats if isinstance(raw_stats, list) else []
    lineup_list = raw_lineup if isinstance(raw_lineup, list) else []

    return {
        "provider": "tsdb",
        "teams": {"home": home, "away": away},
        "score": {"home": _safe_int(hs), "away": _safe_int(as_)},
        "competition": comp,
        "round": round_,
        "venue": venue,
        "date": date,
        "time_local": time_local,
        "status": status,
        "event_id": ev.get("idEvent"),
        "timeline": tl_list,
        "stats": stats_list,
        "lineup": lineup_list,
        "raw_event": ev,
    }

def norm_allsports_event(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    raw = AllSportsRawAgent event.get response:
      {"data": { "success":1, "result":[{...match...}] }, ...}
    We'll pick the first result if present.
    """
    body = (raw or {}).get("data") or {}
    result = None
    if isinstance(body, dict):
        items = body.get("result") or body.get("result_prev") or []
        if isinstance(items, list) and items:
            result = items[0]
    ev = result or {}

    # AllSports field names (typical)
    home = ev.get("event_home_team") or ev.get("home_team") or ""
    away = ev.get("event_away_team") or ev.get("away_team") or ""
    hs = ev.get("event_final_result", "").split("-")[0].strip() if ev.get("event_final_result") else ev.get("home_score")
    as_ = ev.get("event_final_result", "").split("-")[1].strip() if ev.get("event_final_result") else ev.get("away_score")
    comp = ev.get("league_name") or ""
    # Venue appears under various keys across providers; check multiple
    venue = (
        ev.get("stadium")
        or ev.get("venue")
        or ev.get("event_stadium")
        or ev.get("event_venue")
        or ev.get("stadium_name")
        or ev.get("venue_name")
        or ev.get("match_stadium")
        or ""
    )
    date = ev.get("event_date") or ev.get("event_date_start") or ev.get("match_date") or ""
    time_local = ev.get("event_time") or ev.get("match_time") or ""
    status = ev.get("event_status") or ev.get("match_status") or ""

    # Best-effort timeline: provider sometimes returns goals/cards under events keys
    # We'll check a few common places
    timeline = ev.get("goalscorers") or ev.get("cards") or ev.get("substitutes") or []
    # Some providers expose a flat timeline list under 'events' or 'timeline'
    if not timeline:
        timeline = ev.get("events") or ev.get("timeline") or []

    return {
        "provider": "allsports",
        "teams": {"home": home, "away": away},
        "score": {"home": _safe_int(hs), "away": _safe_int(as_)},
        "competition": comp,
        "round": ev.get("league_round") or ev.get("round") or "",
        "venue": venue,
        "date": date,
        "time_local": time_local,
        "status": status,
        "event_id": ev.get("match_id") or ev.get("event_key") or ev.get("id"),
        "timeline": timeline,
        "stats": ev.get("statistics") or ev.get("match_statistics") or [],
        "lineup": ev.get("lineups") or ev.get("lineup") or [],
        "raw_event": ev,
    }

def _safe_int(x: Any) -> Optional[int]:
    try:
        if x is None or x == "":
            return None
        return int(str(x).strip())
    except Exception:
        return None


def _find_player_image_in_bundle(bundle: Dict[str, Any], player_name: str) -> Optional[str]:
    """Best-effort: search bundle.lineup, bundle.raw_event and other places for a player image URL matching player_name."""
    if not bundle or not player_name:
        return None
    # Normalize lineup into a flat list of player dicts
    lineup = bundle.get("lineup") or {}
    lineup_players = []
    if isinstance(lineup, dict):
        # common shapes: {'home_team': {...}, 'away_team': {...}} or {'home_team': [...], 'away_team': [...]}
        for side in ("home_team", "away_team", "home", "away"):
            section = lineup.get(side)
            if isinstance(section, dict):
                # collect common arrays inside a section
                for arr_k in ("starting_lineups", "starting", "players", "substitutes", "starting_lineup"):
                    arr = section.get(arr_k) or []
                    if isinstance(arr, list):
                        lineup_players.extend(arr)
            elif isinstance(section, list):
                lineup_players.extend(section)
    elif isinstance(lineup, list):
        lineup_players = lineup

    for p in (lineup_players or []):
        try:
            if not isinstance(p, dict):
                continue
            name = (p.get("name") or p.get("player") or p.get("full_name") or p.get("player_name") or p.get("player") or "").strip()
            if not name:
                continue
            # simple case-insensitive contains match
            if player_name.lower() in name.lower() or name.lower() in player_name.lower():
                for k in ("player_image", "player_photo", "photo", "thumb", "thumbnail", "img", "avatar", "headshot", "strThumb", "strCutout", "cutout", "player_cutout", "photo_url"):
                    v = p.get(k)
                    if v:
                        return v
        except Exception:
            continue

    # check raw_event nested structures for common keys
    raw = bundle.get("raw_event") or {}
    # sometimes players are under 'players' or 'players_list' or 'goalscorers'
    for key in ("players", "players_list", "squad", "lineups", "lineup", "goalscorers", "goals"):
        arr = raw.get(key) or []
        if isinstance(arr, list):
            for p in arr:
                try:
                    if not isinstance(p, dict):
                        continue
                    name = (p.get("name") or p.get("player") or p.get("full_name") or p.get("player_name") or "").strip()
                    if not name:
                        continue
                    if player_name.lower() in name.lower() or name.lower() in player_name.lower():
                        for k in ("player_image", "player_photo", "photo", "thumb", "thumbnail", "img", "avatar", "headshot", "strThumb", "player_cutout", "photo_url"):
                            v = p.get(k)
                            if v:
                                return v
                except Exception:
                    continue
    return None


def _find_player_id_in_bundle(bundle: Dict[str, Any], player_name: Optional[str] = None, minute: Optional[str] = None) -> Optional[str]:
    """Try to locate a player id in the normalized bundle by matching timeline entries (scorer/assist) or lineup keys.
    Returns the first non-empty id string found.
    """
    if not bundle:
        return None
    # 1) check timeline for matching scorer/assist entries
    tl = bundle.get("timeline") or []
    if isinstance(tl, list):
        for ev in tl:
            try:
                # match by minute if provided
                if minute and str(ev.get("time") or ev.get("minute") or ev.get("time_elapsed") or "").strip() != str(minute).strip():
                    continue
                for side in ("home", "away"):
                    scorer = ev.get(f"{side}_scorer") or ev.get(f"{side}Scorer") or ev.get("scorer")
                    scorer_id = ev.get(f"{side}_scorer_id") or ev.get(f"{side}ScorerId") or ev.get(f"{side}_scorerKey") or ev.get(f"{side}_scorer_id")
                    if scorer and scorer_id:
                        if not player_name or (player_name.lower() in str(scorer).lower() or str(scorer).lower() in player_name.lower()):
                            return str(scorer_id)
                # fallback generic id fields
                for k in ("player_id", "playerKey", "player_key", "id"):
                    if ev.get(k):
                        return str(ev.get(k))
            except Exception:
                continue
    # 2) check lineup for player_key-like fields
    lineup = bundle.get("lineup") or {}
    candidates = []
    if isinstance(lineup, dict):
        for section_key in ("home_team", "away_team", "home", "away"):
            section = lineup.get(section_key) or {}
            if isinstance(section, dict):
                for arr_key in ("starting_lineups", "starting", "players", "substitutes", "starting_lineup"):
                    arr = section.get(arr_key) or []
                    if isinstance(arr, list):
                        candidates.extend(arr)
            elif isinstance(section, list):
                candidates.extend(section)
    elif isinstance(lineup, list):
        candidates = lineup

    for p in candidates:
        try:
            if not isinstance(p, dict):
                continue
            name = (p.get("player") or p.get("name") or p.get("player_name") or p.get("full_name") or "").strip()
            if player_name and name and not (player_name.lower() in name.lower() or name.lower() in player_name.lower()):
                continue
            for k in ("player_key", "playerKey", "player_id", "playerId", "id", "player_key_id"):
                if p.get(k):
                    return str(p.get(k))
        except Exception:
            continue
    return None


# -----------------------
# Orchestration
# -----------------------
async def fetch_event_bundle(req: SummarizeRequest, trace: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], str, Dict[str, Any]]:
    """
    Return (normalized, provider_used, raw_sources)
    Strategy:
      - If provider=="tsdb" → TSDB only
      - If provider=="allsports" → AllSports only
      - If "auto" → try TSDB (with expansions), if too thin → consult AllSports
    """
    raw_sources: Dict[str, Any] = {"tsdb": None, "allsports": None}

    # Use AllSports only
    if req.provider in ("auto", "allsports", "tsdb"):
        as_args = {}
        if req.eventId:     # RawAgent maps eventId -> matchId
            as_args["eventId"] = req.eventId
        as_payload = {"intent": "event.get", "args": as_args}
        allsports = await call_allsports_agent(as_payload, trace)
        raw_sources["allsports"] = allsports
        if allsports.get("ok"):
            norm = norm_allsports_event(allsports)
            # If venue missing, leave as-is; enrichment will try AllSports venue.get later
            if norm["teams"]["home"] or norm["teams"]["away"]:
                return norm, "allsports", raw_sources

    return None, "none", raw_sources


async def enrich_missing_venue(bundle: Dict[str, Any], req: SummarizeRequest, trace: List[Dict[str, Any]]) -> Dict[str, Any]:
    """If venue is empty, attempt to resolve via TSDB venue.get using eventName/eventId."""
    if (bundle.get("venue") or "").strip():
        return bundle

    # Best-effort event name
    ev_name = (req.eventName or "").strip()
    if not ev_name:
        raw = bundle.get("raw_event") or {}
        ev_name = (
            raw.get("strEvent")
            or raw.get("strEventAlternate")
            or (f"{raw.get('event_home_team')} vs {raw.get('event_away_team')}" if raw.get('event_home_team') or raw.get('event_away_team') else "")
        ) or ""

    # Build args; CollectorAgentV2.venue.get requires venueId or eventName (+optional eventId)
    args = {}
    if ev_name:
        args["eventName"] = ev_name
    if req.eventId:
        args["eventId"] = req.eventId
    if not args:
        return bundle

    try:
        resp = await call_tsdb_agent({"intent": "venue.get", "args": args}, trace)
        if resp.get("ok"):
            data = resp.get("data") or {}
            ven = (data.get("venue") or {})
            name = ven.get("strVenue") or ven.get("strStadium") or ven.get("strName")
            if name:
                bundle = dict(bundle)
                bundle["venue"] = name
    except Exception:
        pass
    return bundle


def build_llm_prompt(bundle: Dict[str, Any]) -> Tuple[str, str]:
    """Return (system, user) prompts for the LLM with stronger guidance; adapts if match is live."""
    teams = bundle["teams"]
    score = bundle["score"]
    comp = bundle["competition"]
    venue = bundle["venue"]
    date = bundle["date"]
    time_local = bundle["time_local"]
    status = bundle["status"]
    timeline = bundle["timeline"]
    stats = bundle["stats"]
    lineup = bundle["lineup"]

    is_live = _is_live_status(status)
    last_min = _latest_minute(timeline)
    system = (
        "You are an elite football match reporter. Use ONLY the provided data; never invent names or stats. "
        "Write precise, vivid, factual prose that highlights momentum, turning points, and context. "
        f"The one_paragraph MUST be between 200 and 300 words."
    )

    # Build timeline bullets (stringified) — include AllSports fields (trim to keep prompt small)
    tl_lines = []
    for ev in (timeline or []):
        minute = ev.get("time") or ev.get("time_elapsed") or ev.get("minute") or ev.get("event_time")
        # Determine event type and player across providers
        kind = (ev.get("type") or ev.get("event") or ev.get("card") or ev.get("info") or ev.get("event_type") or "").strip()
        # AllSports goal/career fields
        scorer = ev.get("player") or ev.get("player_name") or ev.get("scorer") or ev.get("home_scorer") or ev.get("away_scorer")
        # Cards sometimes in home_fault/away_fault
        fault = ev.get("home_fault") or ev.get("away_fault")
        sub_on = ev.get("substitution") or ev.get("in_player")
        sub_off = ev.get("out_player")
        who = scorer or fault or sub_on or sub_off
        note = ev.get("assist") or ev.get("score") or ev.get("result") or ev.get("info_time") or ""
        # If type is missing but we can infer
        if not kind:
            if ev.get("home_scorer") or ev.get("away_scorer") or ev.get("scorer"):
                kind = "Goal"
            elif ev.get("card"):
                kind = str(ev.get("card"))
            elif sub_on or sub_off:
                kind = "Substitution"
        line = f"{(str(minute)+'′ ') if minute else ''}{kind} — {(who or 'Unknown').strip()} {(note or '').strip()}".strip()
        # hard-cap each line to ~180 chars to reduce token bloat
        if len(line) > 180:
            line = line[:179] + "…"
        tl_lines.append(line)

    # Trim very long timelines: keep first 48 and last 12 (if many) to capture opening + decisive late events
    if len(tl_lines) > 60:
        tl_lines = tl_lines[:48] + ["… (timeline truncated) …"] + tl_lines[-12:]

    # Primary stats (TSDB often [{"strStat","intHome","intAway"}])
    stats_pairs = []
    if isinstance(stats, list):
        for st in stats[:12]:
            name = st.get("strStat") or st.get("type") or st.get("name")
            h = st.get("intHome") or st.get("home") or st.get("home_value")
            a = st.get("intAway") or st.get("away") or st.get("away_value")
            if name and (h is not None or a is not None):
                stats_pairs.append(f"{name}: {h}-{a}")
    stats_hint = " | ".join(stats_pairs) if stats_pairs else "None"

    # Story hints derived from data to encourage richer detail (still non-hallucinatory)
    first_goal_min = _minute_of_first_goal(timeline)
    eq_min = _minute_of_equalizer(score.get("home"), score.get("away"), timeline)
    flow_hint = []
    if first_goal_min:
        flow_hint.append(f"Opening goal around {first_goal_min}′.")
    if eq_min:
        flow_hint.append(f"Equalizer around {eq_min}′.")
    if not flow_hint and (score.get("home") is not None and score.get("away") is not None):
        flow_hint.append("Scoreline changes inferred from final score; exact minutes not fully available.")

    header = "Final Score" if is_live is False else ("Current Score" if is_live else "Score")
    live_line = "Live update — do not assume final result" if is_live else ("Not started" if is_live is None and not timeline else "")

    user = f"""
Match: {teams.get('home','')} vs {teams.get('away','')}
{header}: {score.get('home')}–{score.get('away')}
Competition/Stage: {comp}
Venue: {venue or 'Unknown'}
Date/Time: {date or 'Unknown'} {time_local or ''}
Status: {status or 'Unknown'}{(' | ' + live_line) if live_line else ''}
Latest minute seen: {last_min or 'n/a'}

Timeline (minute • event • player • note):
- """ + ("\n- ".join(tl_lines) if tl_lines else "None") + """

Key stats (home-away):
""" + stats_hint + """

Story hints:
- """ + ("\n- ".join(flow_hint) if flow_hint else "None") + """

Write JSON only with keys:
headline (short), one_paragraph (single paragraph, """ \
+ f"""200-300 words, include: {'current state and likely themes so far' if is_live else 'result'}; phases (first half vs second half) when supported by data; minutes for the opening goal and equalizer if present; how momentum changed; any notable absences of data like venue/stats),""" \
+ """ bullets (3-6 crisp points), key_events (minute,type,player,note), star_performers (name,reason), numbers (home_score,away_score).

Rules:
- If a data point (scorer, venue, stats) is missing, explicitly note that it was not provided; do not guess.
- If the match is live, DO NOT write as if it has finished; clearly frame as a live update based on current score and minute.
- Prefer concrete minutes and competition context when available.
- Keep language active and specific; avoid clichés.
"""
    return system, user



async def run_llm(system: str, user: str) -> Dict[str, Any]:
    """Call Groq LLM to produce structured JSON, enforcing longer one_paragraph with a single retry if needed."""
    if Groq is None or not GROQ_API_KEY:
        return {
            "headline": "Match Report Unavailable",
            "one_paragraph": "LLM is not configured. Set GROQ_API_KEY.",
            "bullets": [],
            "key_events": [],
            "star_performers": [],
            "numbers": {},
        }

    client = Groq(api_key=GROQ_API_KEY)

    def _content():
        schema_hint = f"""Respond ONLY in JSON with keys:
{{
  "headline": str,
  "one_paragraph": str,   // MUST be between 200-300 words, single paragraph
  "bullets": [str, ...],  // 3-6 items
  "key_events": [{{"minute": str, "type": str, "player": str, "note": str}}, ...],
  "star_performers": [{{"name": str, "reason": str}}, ...],
  "numbers": {{"home_score": int|null, "away_score": int|null}}
}}
Do not add extra fields.
"""
        return schema_hint + "\n\nDATA:\n" + user

    async def _call():
        return await asyncio.to_thread(
            client.chat.completions.create,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": _content()},
            ],
            model=GROQ_MODEL,
            temperature=LLM_TEMPERATURE,
            response_format={"type": "json_object"},
            max_tokens=1200,
        )

    # First try
    import json
    try:
        chat = await _call()
        raw = chat.choices[0].message.content
        try:
            out = json.loads(raw)
        except Exception:
            out = {
                "headline": "Match Report",
                "one_paragraph": (raw or "")[:800],
                "bullets": [],
                "key_events": [],
                "star_performers": [],
                "numbers": {},
            }
    except Exception as e:
        # Fallback gracefully on API errors (e.g., json_validate_failed or token limits)
        return {
            "headline": "Match Report Unavailable",
            "one_paragraph": "The summarization model could not produce a JSON response within limits. Returning a minimal fallback.",
            "bullets": [],
            "key_events": [],
            "star_performers": [],
            "numbers": {},
        }

    # Enforce paragraph length once
    para = out.get("one_paragraph") or ""
    wc = word_count(para)
    if wc < 200 or wc > 300:
        reinforce = (
            system
            + f" The one_paragraph MUST be between 200-300 words. "
              "Preserve facts; do not invent missing data. Expand with momentum and context only from provided info."
        )
        try:
            chat2 = await asyncio.to_thread(
                client.chat.completions.create,
                messages=[
                    {"role": "system", "content": reinforce},
                    {"role": "user", "content": _content()},
                ],
                model=GROQ_MODEL,
                temperature=LLM_TEMPERATURE,
                response_format={"type": "json_object"},
                max_tokens=1200,
            )
            try:
                out = json.loads(chat2.choices[0].message.content)
            except Exception:
                pass  # keep first response if second parse fails
        except Exception:
            # keep first response if second call fails
            pass

    return out


# -----------------------
# FastAPI routes
# -----------------------
@app.post("/summarize/news", response_model=NewsSummaryOut)
async def summarize_news(req: NewsSummaryRequest):
    if not req.url and not req.text:
        raise HTTPException(status_code=400, detail="url or text is required")

    title = (req.title or "").strip() or None
    article_text = (req.text or "").strip()
    original_word_count = word_count(article_text) if article_text else 0

    if req.url:
        fetched_title, fetched_text = await _fetch_article_text(req.url)
        if not title and fetched_title:
            title = fetched_title
        # Use fetched text when provided text missing or extremely short
        if not article_text or word_count(article_text) < 40:
            article_text = fetched_text
            original_word_count = word_count(fetched_text)
        elif not original_word_count:
            original_word_count = word_count(fetched_text)

    if not article_text:
        raise HTTPException(status_code=422, detail="No article text available to summarize")

    clipped = _clip_article_text(article_text)
    summary_payload = await _summarize_news_article(title, clipped, max_words=req.max_words)
    if not isinstance(summary_payload, dict):
        summary_payload = {"title": title or "Article Summary", "summary": clipped, "bullets": []}
    summary_title = summary_payload.get("title") or title or "Article Summary"
    summary_text = summary_payload.get("summary") or clipped
    summary_bullets_raw = summary_payload.get("bullets") or []
    summary_bullets = [
        _normalize_spaces(str(item))
        for item in summary_bullets_raw
        if isinstance(item, str) and item.strip()
    ]
    return NewsSummaryOut(
        ok=True,
        title=summary_title,
        summary=summary_text,
        bullets=list(summary_bullets),
        url=req.url,
        original_word_count=original_word_count or word_count(article_text),
    )


@app.post("/summarize", response_model=SummaryOut)
async def summarize(req: SummarizeRequest):
    trace: List[Dict[str, Any]] = []
    trace_id = req.trace_id or new_trace_id()
    idempotency_key = req.idempotency_key or trace_id
    trace.append({"trace_id": trace_id, "idempotency_key": idempotency_key})

    # Fetch event bundle from agents
    bundle, provider_used, raw_sources = await fetch_event_bundle(req, trace)
    if not bundle:
        # Build a graceful error response
        src_notes = {
            "tsdb_ok": (raw_sources.get("tsdb") or {}).get("ok"),
            "allsports_ok": (raw_sources.get("allsports") or {}).get("ok"),
            "tsdb_err": (raw_sources.get("tsdb") or {}).get("error"),
            "allsports_err": (raw_sources.get("allsports") or {}).get("error"),
        }
        # Helpful server-side log to correlate incoming browser requests with backend traces
        try:
            req_summary = req.model_dump() if hasattr(req, 'model_dump') else dict(req)
        except Exception:
            req_summary = str(req)
        try:
            ts_head = _short(str(raw_sources.get('tsdb'))[:800])
            as_head = _short(str(raw_sources.get('allsports'))[:800])
        except Exception:
            ts_head = as_head = ''
        print(f"[summarizer-log] missing bundle trace_id={trace_id} idempotency_key={idempotency_key} req={str(req_summary)[:800]} sources={src_notes} ts_head={ts_head} as_head={as_head}")
        raise HTTPException(
            status_code=404,
            detail={"reason": "Event not found or too little data to summarize", "sources": src_notes, "trace": trace},
        )

    # Enrich missing venue via TSDB if possible
    bundle = await enrich_missing_venue(bundle, req, trace)

    # Prompt LLM
    system, user = build_llm_prompt(bundle)
    llm_out = await run_llm(system, user)

    # Assemble final shape
    summary = {
        "ok": True,
        "headline": llm_out.get("headline") or "Match Report",
        "one_paragraph": llm_out.get("one_paragraph") or "",
        "bullets": llm_out.get("bullets") or [],
        "key_events": llm_out.get("key_events") or [],
        "star_performers": llm_out.get("star_performers") or [],
        "numbers": llm_out.get("numbers") or {
            "home_score": bundle["score"]["home"],
            "away_score": bundle["score"]["away"],
        },
        "source_meta": {
            "provider_used": provider_used,
            "bundle": {
                "teams": bundle["teams"],
                "score": bundle["score"],
                "competition": bundle["competition"],
                "venue": bundle["venue"],
                "date": bundle["date"],
                "time_local": bundle["time_local"],
                "status": bundle["status"],
                "event_id": bundle["event_id"],
            },
            "trace": trace,
            "raw_peek": {
                "tsdb_head": _short(str(raw_sources.get("tsdb"))[:800]),
                "allsports_head": _short(str(raw_sources.get("allsports"))[:800]),
            },
        },
    }
    return summary


@app.post("/summarize/events", response_model=EventBriefsOut, response_model_exclude_none=False)
async def summarize_events(req: dict):
    """Summarize a list of timeline events (goals/cards/substitutions) into short natural-language briefs.
    This does not fetch provider data; it uses the given events and optional context only.
    """
    # minimal context for better phrasing (optional)
    context = {
        "teams": {},
        "score": {},
        "competition": "",
    }
    # Attempt to enrich context by fetching the normalized event bundle when eventId/eventName present
    try:
        if req.get("eventId") or req.get("eventName"):
            trace: List[Dict[str, Any]] = []
            # Build a SummarizeRequest-like object to pass to fetch_event_bundle
            sr = SummarizeRequest(
                eventId=req.get("eventId"),
                eventName=req.get("eventName"),
                date=req.get("date"),
                provider=req.get("provider") or "auto",
            )
            bundle, provider_used, raw_sources = await fetch_event_bundle(sr, trace)
            if bundle:
                # attach normalized bundle under context to allow fallback image/logo extraction
                context.update({
                    "teams": bundle.get("teams") or {},
                    "score": bundle.get("score") or {},
                    "competition": bundle.get("competition") or "",
                    "match": bundle,
                })
    except Exception:
        # best-effort only
        pass

    try:
        # Validate incoming shape explicitly to catch pre-handler issues
        try:
            parsed = EventBriefsRequest(**(req or {}))
        except Exception as ve:
            try:
                print(f"[summarizer-error] summarize_events validation failed: {ve} req_raw={str(req)[:800]}")
            except Exception:
                pass
            raise HTTPException(status_code=400, detail="Invalid request shape for summarize/events")

        # Only accept up to 24 events to keep prompt tight
        raw_events = list(parsed.events or [])[:24]
        # Convert Pydantic models to plain dicts for downstream helpers
        events: List[Dict[str, Any]] = []
        for ev in raw_events:
            try:
                if hasattr(ev, "model_dump"):
                    events.append(ev.model_dump())
                elif hasattr(ev, "dict"):
                    events.append(ev.dict())
                else:
                    events.append(dict(ev))
            except Exception:
                # fallback: coerce via str representation
                try:
                    events.append(dict(ev))
                except Exception:
                    events.append({})

        # Generate briefs (LLM or fallback)
        briefs = await _llm_event_briefs(context, events)
        # Ensure briefs is a list aligned with input events; if LLM returned a match-level one_paragraph
        # or a single item, we must convert/trim it to per-event short briefs.
        if not isinstance(briefs, list):
            # If the LLM returned a dict with 'items' or a one_paragraph, convert
            if isinstance(briefs, dict) and isinstance(briefs.get('items'), list):
                briefs = briefs.get('items')
            else:
                # Not a list: fall back to templated per-event briefs below
                briefs = []
        # backfill images/team logos from normalized bundle when possible
        bundle = context.get("match") or {}

        # map back to output items, with backfills
        items: List[Dict[str, Any]] = []
        # If there are fewer briefs than events, or briefs seems to be a single long paragraph,
        # synthesize short templated briefs for missing entries.
        templated_short: List[Dict[str, Any]] = []
        for ev in events:
            t = (ev.get('type') or ev.get('event') or '').lower()
            minute = ev.get('minute') or ev.get('time')
            player = ev.get('player') or ev.get('player_name') or ev.get('home_scorer') or ev.get('away_scorer') or None
            team = ev.get('team') or ev.get('side') or ''
            short = ''
            if player:
                short = f"{player} — {t.title() if t else 'Event'} ({minute or '?'}')"
            else:
                short = f"{t.title() if t else 'Event'} ({minute or '?'}')"
            templated_short.append({"minute": minute, "type": t or None, "brief": _truncate_brief(short), "player_image": None, "team_logo": None})

        # Now iterate and fill items using briefs when present, otherwise templated_short
        for i in range(len(events)):
            b = briefs[i] if i < len(briefs) and isinstance(briefs[i], dict) else templated_short[i]
            if not isinstance(b, dict):
                b = {}
            # pick up values the LLM returned (if any); default to empty string for stability
            pi = b.get("player_image") if b.get("player_image") is not None else ""
            tl = b.get("team_logo") if b.get("team_logo") is not None else ""

            # Backfill player image from bundle using the primary player in the corresponding event
            if not pi:
                ev = events[i] if i < len(events) else {}
                candidate_player = (
                    ev.get("player")
                    or ev.get("player_name")
                    or ev.get("home_scorer")
                    or ev.get("away_scorer")
                    or ev.get("description")
                    or ""
                )
                if candidate_player and bundle:
                    found = _find_player_image_in_bundle(bundle, candidate_player)
                    if found:
                        pi = found

            # Backfill team logo from known bundle keys if missing
            if not tl and bundle:
                # common normalized keys
                for key in ("homeLogo", "awayLogo", "home_badge", "away_badge", "home_logo", "away_logo", "strTeamBadge"):
                    v = bundle.get(key)
                    if v:
                        tl = v
                        break
                # fallback to raw_event search
                if not tl:
                    raw = bundle.get("raw_event") or {}
                    for key in ("team_logo", "logo", "badge", "crest", "strTeamBadge"):
                        v = raw.get(key)
                        if v:
                            tl = v
                            break

            # include primary player name so frontend can resolve images from Players endpoint
            ev = events[i] if i < len(events) else {}
            primary_player = (
                ev.get("player") or ev.get("player_name") or ev.get("home_scorer") or ev.get("away_scorer") or None
            )
            # common player id keys if available in event shapes
            player_id = (
                ev.get("player_id") or ev.get("playerId") or ev.get("player_key") or ev.get("id") or ev.get("playerIdRef")
            )
            # If player_id missing, try to locate via bundle timeline/lineup
            if not player_id and primary_player and bundle:
                try:
                    found_id = _find_player_id_in_bundle(bundle, primary_player, ev.get("minute") or ev.get("time"))
                    if found_id:
                        player_id = found_id
                except Exception:
                    pass
            # Enforce short brief length here to guarantee tooltip brevity
            brief_text = b.get("brief") or ""
            brief_text = _truncate_brief(brief_text, max_words=35)
            items.append({
                "minute": b.get("minute"),
                "type": b.get("type"),
                "brief": brief_text,
                "player_image": pi,
                "team_logo": tl,
                "player": primary_player,
                "player_id": player_id,
            })

        # Best-effort: resolve missing player images by calling player.get for returned player_ids
        try:
            trace2: List[Dict[str, Any]] = []
            await _resolve_player_images_for_items(items, trace2)
            # attach trace to top-level for debugging if needed
            if trace2:
                # include minimal trace in logs
                try:
                    print(f"[summarizer-debug] player image resolve trace: {trace2}")
                except Exception:
                    pass
        except Exception:
            pass

        # Return raw JSON response to preserve keys exactly as provided
        return JSONResponse(content={"ok": True, "items": items})
    except Exception as e:
        # Log server-side for diagnostics and return a helpful 500
        try:
            print(f"[summarizer-error] summarize_events failed: {str(e)}")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Internal error while generating event briefs")
