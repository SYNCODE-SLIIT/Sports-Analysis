# Sports Analysis — Project Overview

## Quick task receipt & plan

- Task: Add a complete README at the repository root containing project structure, file descriptions, a deep dive into `sports-ai/backend/app/agents/collector.py`, API endpoints used, usage examples, limitations, and PDF instructions.
- Plan: Create `README.md` at repo root with a clear checklist, project layout, detailed collector reference, code usage examples, recommendations, and steps to produce a PDF.

## Checklist

- [x] Create a root `README.md` with a full project overview
- [x] Document folder/file responsibilities
- [x] Provide an in-depth explanation of `collector.py` (data shapes, helper functions, endpoints, public API)
- [x] Include usage examples and edge-cases
- [x] Add recommended improvements and testing suggestions
- [x] Provide instructions to generate a PDF from the Markdown

---

## Summary

This repository — "Sports Analysis" — contains a small sports analytics project with a backend collector client for TheSportsDB, frontend scaffolding, docs, and notebooks. The most important active component is the synchronous client at `sports-ai/backend/app/agents/collector.py`, which fetches leagues, teams, matches and timelines from TheSportsDB v1, normalizes responses into Python dataclasses, and applies a polite retry/throttle strategy suitable for backend use.

This README captures the full project structure and a detailed reference for `collector.py` so contributors and maintainers can understand, run, and extend the project.

---

## Project layout (top-level)

```
<repo root>
├─ README.md                # (this file)
├─ requirements.txt         # Python dependencies
├─ sports-ai/
│  ├─ README.md
│  ├─ backend/
│  │  ├─ app/
│  │  │  ├─ agents/
│  │  │  │  ├─ collector.py         # main HTTP client for TheSportsDB (detailed below)
│  │  │  │  ├─ demo_collector.py    # example/demo usage of the collector
│  │  │  │  └─ SAMPLE.md
│  │  │  ├─ models/                 # dataclasses or Pydantic models (placeholder)
│  │  │  ├─ routers/                # API route handlers (FastAPI/Flask) (placeholder)
│  │  │  └─ utils/                  # backend utilities (placeholder)
│  │  └─ tests/                     # unit tests (placeholder)
│  ├─ data/                         # datasets, fixtures (placeholder)
│  ├─ docs/                         # documentation (placeholder)
│  ├─ frontend/                     # UI code (placeholder)
│  └─ notebooks/                    # Jupyter notebooks (placeholder)
```

Files marked "placeholder" are present in the repo as `SAMPLE.md` or placeholder directories and should be replaced with real artifacts as the project grows.

---

## Root purpose & responsibilities

- Backend: provide APIs and data normalization for sports analytics using TheSportsDB.
- Frontend: UI scaffolding for presenting analytics and match data.
- Data: permanent or temporary storage of datasets/results used in analyses.
- Notebooks: exploratory data analysis and prototyping.

---

## Detailed reference: `sports-ai/backend/app/agents/collector.py`

This section documents the file fully so you can maintain, extend, or refactor it.

### Purpose

A tiny synchronous client for TheSportsDB (v1). It:

- Builds endpoint URLs using an API key from `THESPORTSDB_KEY` (defaults to the free dev key `"123"`).
- Applies retries and backoff on transient failures.
- Sleeps briefly between requests to stay reasonably under free-tier rate limits.
- Normalizes raw JSON rows into typed `dataclass` models for downstream use.
- Intentionally contains no printing or side effects; designed to be imported by backends or unit tests.

### Configuration

- `API_KEY = os.getenv("THESPORTSDB_KEY", "123")`
- `BASE_URL = f"https://www.thesportsdb.com/api/v1/json/{API_KEY}"`
- `TIMEOUT_S = 15.0` — per request timeout
- `PAUSE_S = 0.35` — polite sleep between calls (aims to keep under ~30 req/min)
- `RETRY_BACKOFFS = [0.5, 1.0, 2.0]` — simple retry delays for transient failures

### Data shapes (Python dataclasses)

- `League`:

  - id: str (from `idLeague`)
  - name: str (from `strLeague`)
  - sport: Optional[str] (from `strSport`)
  - country: Optional[str] (from `strCountry`)

- `MatchSummary`:

  - id: str (from `idEvent`)
  - date: Optional[str] (raw `dateEvent` as returned by the API)
  - league, home_team, away_team: Optional[str]
  - home_score / away_score: Optional[int] (parsed from `intHomeScore`, `intAwayScore`)
  - venue, status, video, thumb: Optional[str]

- `TimelineItem`:

  - minute: Optional[int] (from `intTime`)
  - type: str — normalized token like `GOAL`, `RED_CARD`, `YELLOW_CARD`, `SUB`, `PENALTY`, or `UNKNOWN`.
  - team, player, detail: Optional[str]
  - text: str — a human readable assembled line (e.g., `"45′ GOAL by John Doe (Team) — Header"`)

- `MatchPackage`:
  - event: MatchSummary
  - timeline: List[TimelineItem]
  - flags: Dict[str,bool] — keys: `has_timeline`, `has_stats`, `has_lineup`

### Internal helpers

- `_sleep(t: float = PAUSE_S)` — wraps `time.sleep` for consistent throttling.
- `_get(path: str, params: dict | None = None) -> dict | list` — core HTTP GET wrapper that:
  - Builds `url = f"{BASE_URL}/{path.lstrip('/')}``
  - Performs `httpx.get(url, params=params, timeout=TIMEOUT_S)`.
  - Retries on status codes 429 and 5xx, and on `httpx.TimeoutException`, `httpx.TransportError`, `httpx.HTTPStatusError`.
  - Uses `RETRY_BACKOFFS` between attempts.
  - Returns `{}` if the API returns a dict whose values are all `None` (special-case handling for some API responses).
  - Raises `RuntimeError` after exhausting retries.
- `_to_int(x)` — safely parses integers, returns `None` for empty/invalid inputs.
- `_country_aliases(name: str)` — returns common adjective/alias forms for a country name; used to fuzzily match league names to country.
- `_normalize_league`, `_normalize_match_row`, `_normalize_timeline_row` — convert raw JSON rows into the dataclasses above. `TYPE_MAP` is used to normalize timeline event labels.

### TheSportsDB endpoints used (v1)

The client calls these endpoints (paths match how collector constructs them):

- `search_all_leagues.php?c={country}&s={sport}` — filtered search by country & sport
- `all_leagues.php`
- `lookup_all_teams.php?id={league_id}`
- `search_all_teams.php?l={league_name}`
- `eventspastleague.php?id={league_id}`
- `eventsnextleague.php?id={league_id}`
- `eventslast.php?id={team_id}`
- `eventsnext.php?id={team_id}`
- `lookupevent.php?id={event_id}`
- `lookuptimeline.php?id={event_id}`
- `lookupeventstats.php?id={event_id}`
- `lookuplineup.php?id={event_id}`

Note: Endpoints return slightly different key names in JSON (`events`, `results`, `teams`, etc.) — the collector handles those variants.

### Public methods (behavior)

- `list_leagues(sport: str | None = None, country: str | None = None) -> List[League]`

  - If both `sport` and `country` are provided: calls `search_all_leagues.php` first. If that returns empty, falls back to `all_leagues.php` and applies a local filter using `_country_aliases` and sport matching.
  - Otherwise returns all leagues from `all_leagues.php`.
  - Sleeps between calls to respect `PAUSE_S`.

- `list_teams_in_league(league_id: str | None = None, league_name: str | None = None) -> List[dict]`

  - If `league_id` provided: calls `lookup_all_teams.php?id={league_id}`.
  - If `league_name` provided: calls `search_all_teams.php?l={league_name}`.
  - Returns pruned dicts containing keys: `idTeam`, `strTeam`, `strAlternate`, `strCountry`, `strStadium`, `strTeamBadge`.

- `list_matches_for_league(league_id: str, kind: str = "past", limit: int = 10) -> List[MatchSummary]`

  - `kind` controls whether to call `eventspastleague.php` or `eventsnextleague.php`.
  - Returns up to `limit` normalized `MatchSummary` items.

- `list_matches_for_team(team_id: str, kind: str = "last", limit: int = 5) -> List[MatchSummary]`

  - `kind` chosen between `eventslast.php` and `eventsnext.php`.

- `get_match(event_id: str) -> MatchPackage`
  - Calls `lookupevent.php?id={event_id}`, extracts first event row and normalizes to `MatchSummary`.
  - Calls `lookuptimeline.php?id={event_id}`, normalizes each timeline row.
  - Calls `lookupeventstats.php` and `lookuplineup.php` to set flags in `MatchPackage.flags`.

### Normalization specifics

- `TYPE_MAP` maps human labels to canonical tokens:
  - `"Goal" -> "GOAL"`
  - `"Red Card" -> "RED_CARD"`
  - `"Yellow Card" -> "YELLOW_CARD"`
  - `"Substitution" -> "SUB"`
  - `"Penalty" -> "PENALTY"`
- `_normalize_timeline_row` composes a `text` field from the minute, normalized type (with underscores replaced by spaces), player, team and detail for easy display.
- Scores are parsed via `_to_int`, returning `None` when missing or invalid.

### Error handling & retry semantics

- Retries on 429 and 5xx with backoff delays.
- Retries on `httpx` timeout and transport exceptions.
- After exhausting retries, `_get` raises `RuntimeError("HTTP failed after retries: ...")`.
- `_get` returns `{}` when the API returns a dict whose values are all `None` to signal an empty/no-data response for some endpoints.

### Example usage (synchronous)

```python
from sports-ai.backend.app.agents.collector import SportsDBCollector

c = SportsDBCollector()
leagues = c.list_leagues(sport="Soccer", country="England")
if leagues:
    first = leagues[0]
    teams = c.list_teams_in_league(league_id=first.id)
    matches = c.list_matches_for_league(league_id=first.id, kind="past", limit=5)
    if matches:
        match_pkg = c.get_match(event_id=matches[0].id)
        # Access match_pkg.event, match_pkg.timeline, match_pkg.flags
```

### Edge cases & behaviors to watch

- Some API responses use `events` vs `results` vs `teams` keys. Collector handles common variants but API changes could break assumptions.
- The API often returns empty or `null` strings; normalization uses empty string or `None` depending on context.
- The special-case logic that returns `{}` for a dict with all-`None` values is based on observed API behavior — if the API changes format, this may need updating.

### Known limitations & recommended improvements

- Synchronous design: switch to `httpx.AsyncClient` if you integrate with async frameworks such as FastAPI.
- Connection pooling: replace repeated `httpx.get` calls with a persistent `httpx.Client` (or `AsyncClient`) instance to reuse connections and reduce overhead.
- Caching: add an in-memory TTL cache (or Redis) for repeated requests like league/team lists.
- Rate limit handling: honor `Retry-After` header on 429, and add adaptive throttling.
- Data validation: consider Pydantic models to validate and coerce API responses.
- Date parsing: convert `dateEvent` to `datetime.date` for consistent handling.
- Tests: add unit tests for normalization functions and API calls using mocking (e.g., `respx` for `httpx`).

---

## Development recommendations & next steps

- Add unit tests for `_normalize_*` functions and for `_get` using mocked HTTP responses.
- Create `demo_collector.py` examples that call the collector and write JSON fixtures to `sports-ai/data/` for offline testing.
- Add a small FastAPI router in `sports-ai/backend/app/routers/` that exposes endpoints backed by `SportsDBCollector`.
- Consider adding typed Pydantic models and migrating dataclasses to Pydantic for schema validation.

---

## How to generate a PDF from this README

If you want a PDF copy of this README, install `pandoc` and a PDF engine (like `wkhtmltopdf` or a TeX distribution). Then run:

```sh
pandoc README.md -o project_overview.pdf
```

Or use any Markdown → PDF tool or editor that supports exporting to PDF.

---

## Where to find things in the repo

- Collector: `sports-ai/backend/app/agents/collector.py`
- Demo usage: `sports-ai/backend/app/agents/demo_collector.py`
- Requirements: `requirements.txt`

---

## Final notes

This README is intended to be a single source of truth for the repository's current state and the `collector.py` client. If you want, I can:

- Add targeted unit tests for the collector (with mocked HTTP responses),
- Create an async refactor using `httpx.AsyncClient`, or
- Generate the PDF in-repo and commit the PDF file as `docs/project_overview.pdf`.

Tell me which of those you'd like next and I will implement it.
