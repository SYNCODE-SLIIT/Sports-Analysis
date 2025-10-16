# Sports Analysis – Extended Project Guide

> This is an extended, comprehensive guide. The original `README.md` is left untouched. Use this document when you need full architectural, operational, and contributor-level detail.

---
## 1. Purpose & High-Level Architecture
The project unifies two football (soccer) data providers:
- TheSportsDB (TSDB) – free/open structured sports data.
- AllSportsAPI – broader live, odds, probabilities, comments, video endpoints.

A routing layer (`RouterCollector`) accepts a generic JSON request `{intent, args}` and delegates to provider-specific agents:

```
          +-----------------+         +-------------------+
Request → | RouterCollector | → TSDB → | CollectorAgentV2 | (rule-based, curated)
          |   (routing)     |    ↓    +-------------------+
          |                 |    ↘
          |                 |     → AllSports → AllSportsRawAgent (pass-through)
          +-----------------+
                     ↓
                 Unified JSON response (raw provider data, no cross-provider normalization)
```

Supporting pieces:
- Adapters (`TSDBAdapter`, `AllSportsAdapter`) wrap agents to unify return shape for the router.
- FastAPI app (`backend/app/main.py`) exposes HTTP endpoints (`/collect`, `/health`).
- Utility HTTP layer for TSDB (`utils/http_client.py`).
- Cache directory stores pre-fetched fixture snapshots (JSON).
- Frontend static HTML (simple pages) optionally served under `/frontend`.

---
## 2. Quick Start
### 2.1 Prerequisites
- Python 3.10+
- Internet access for live API calls
- (Optional) API keys:
  - `THESPORTSDB_API_KEY` (defaults to public demo key `3` if unset)
  - `ALLSPORTS_API_KEY` (REQUIRED for AllSports endpoints; no default)

### 2.2 Install
```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2.3 Environment Variables
Create `.env` at repo root (auto-loaded by `run_server.py`):
```
THESPORTSDB_API_KEY=3
ALLSPORTS_API_KEY=your_all_sports_key_here
# Optional overrides
ALLSPORTS_BASE_URL=https://apiv2.allsportsapi.com/football/
```

### 2.4 Run the API Server
```bash
python run_server.py --port 8000
```
Visit:
- Health: http://127.0.0.1:8000/health
- Unified endpoint: POST http://127.0.0.1:8000/collect
- Static frontend (if present): http://127.0.0.1:8000/frontend/pages/index.html

### 2.5 Example curl Calls
List leagues (TSDB primary):
```bash
curl -s -X POST http://127.0.0.1:8000/collect \
  -H 'Content-Type: application/json' \
  -d '{"intent":"leagues.list","args":{"name":"Premier"}}' | jq '.data.leagues[0:2]'
```
List live events (AllSports primary):
```bash
curl -s -X POST http://127.0.0.1:8000/collect \
  -H 'Content-Type: application/json' \
  -d '{"intent":"events.live","args":{}}' | jq '.data.result[0:1]'
```
Fetch a venue via event name (TSDB primary):
```bash
curl -s -X POST http://127.0.0.1:8000/collect \
  -H 'Content-Type: application/json' \
  -d '{"intent":"venue.get","args":{"eventName":"Arsenal vs Chelsea"}}'
```

### 2.6 Livescore Script (Direct AllSports Client)
```bash
python fetch_livescore.py
```
(Adjust `sys.path` in the script if you relocate directories.)

### 2.7 Notebooks
Open any notebook under `sports-ai/notebooks/` in Jupyter Lab:
```bash
jupyter lab
```
Ensure the virtualenv kernel is selected; install missing libs as needed.

---
## 3. File & Directory Reference
Top-level:
```
.
├─ README.md                # Original concise overview
├─ README_EXTENDED.md       # This extended guide
├─ requirements.txt         # Pinned dependency list
├─ run_server.py            # Launcher that patches sys.path and starts FastAPI/uvicorn
├─ fetch_livescore.py       # Standalone AllSports livescore demo script
├─ openapi.json             # (If present) OpenAPI schema snapshot / placeholder
├─ port_check.ps1           # PowerShell utility (likely to test port availability)
└─ sports-ai/               # Core application package (hyphen requires path patch at runtime)
```
`sports-ai/`:
```
 sports-ai/
 ├─ __init__.py             # Marks package root (empty / future globals)
 ├─ backend/
 │  ├─ __init__.py
 │  ├─ app/
 │  │  ├─ main.py           # FastAPI app wiring: mounts /frontend, sets CORS, /collect route
 │  │  ├─ main_analytics.py # (Aux analytics entrypoint - not invoked by router; extend as needed)
 │  │  ├─ agents/
 │  │  │   ├─ collector.py          # CollectorAgentV2 (TSDB rule-based agent)
 │  │  │   ├─ game_analytics_agent.py # AllSportsRawAgent (pass-through)
 │  │  ├─ adapters/
 │  │  │   ├─ tsdb_adapter.py       # Wraps CollectorAgentV2 to a uniform shape
 │  │  │   ├─ allsports_adapter.py  # Wraps AllSportsRawAgent likewise
 │  │  ├─ routers/
 │  │  │   ├─ router_collector.py   # RouterCollector: provider routing & fallback logic
 │  │  ├─ utils/
 │  │  │   ├─ http_client.py        # Minimal GET wrapper for TSDB (requests)
 │  │  ├─ cache/                    # Cached fixture JSON snapshots (date-stamped)
 │  │  ├─ models/                   # (Placeholder for shared schemas or Pydantic models)
 │  │  └─ ... (future modules)
 │  ├─ tests/                       # Placeholder (add unit/integration tests here)
 ├─ data/                           # Sample / raw data exports or offline fixtures
 ├─ docs/                           # Extended docs, generated artefacts (add diagrams here)
 ├─ frontend/
 │  ├─ pages/                       # HTML pages; served under /frontend/pages/
 │  ├─ components/                  # Reusable HTML fragments/components
 │  ├─ utils/                       # Frontend-side helper scripts (placeholder)
 └─ notebooks/                      # Jupyter experiments / prototyping
```

### Purpose Highlights
- `collector.py`: Implements intent capability methods (`_cap_*`) for TSDB, with ID/name resolution, multi-step fallbacks, and trace logging.
- `game_analytics_agent.py`: Provides AllSportsRawAgent with name→ID augmentation and minimal tracing; zero normalization.
- `router_collector.py`: Decides primary provider per intent; executes fallback if primary fails or returns an "empty" payload.
- `adapters/*.py`: Standardizes agent responses to `{ok, data, error, meta.trace}` so router logic stays simple.
- `http_client.py`: Encapsulates TSDB base URL + API key injection; resilient to errors (returns minimal dict with `error` key).
- `cache/*.json`: Snapshot of previously retrieved fixture lists; useful for local exploration or regression comparison.
- `frontend/pages/*.html`: Static prototypes (e.g., `football-analytics-final.html`).
- `requirements.txt`: Mixed stack (FastAPI, ML/audio/vision libs). Only a subset is needed for API core; consider trimming for deployment.

---
## 4. Agents & Routing Details
### 4.1 CollectorAgentV2 (TSDB)
- Entry: `handle({intent, args})`.
- Supported intents (primary set):
  - `leagues.list`, `countries.list`, `sports.list`, `league.get`, `league.table`
  - `teams.list`, `team.get`, `team.equipment`
  - `players.list`, `player.get`, `player.honours`, `player.former_teams`, `player.milestones`, `player.contracts`, `player.results`
  - `events.list`, `event.get`, `event.results`, `event.tv`, `video.highlights`, `venue.get`, `seasons.list`
- Implementation style: each intent maps to a `_cap_<name>` method returning `(data_dict, resolved_args)`.
- Resolution helpers perform multi-call strategies (e.g. league ID by name via `/search_all_leagues` then fallback) and may raise custom errors:
  - `CollectorError`, `AmbiguousError`, `NotFoundError`.
- Tracing: each HTTP call appends `{step: 'http_get', path, params}` to a per-request trace list.

### 4.2 AllSportsRawAgent
- Intent coverage (pass-through) includes: leagues, fixtures/events, livescore, teams, players, standings, videos, odds, probabilities, comments, seasons.
- Resolves `countryName` → `countryId`, `leagueName` → `leagueId`, and attempts `teamName` → `teamId`.
- Adds `_ts` cache-buster and keeps provider shape verbatim (no `result` manipulation).

### 4.3 RouterCollector
- Defines two sets: `tsdb_first` and `allsports_first`.
- Decision algorithm:
  1. Execute primary provider.
  2. If `ok` AND payload not "empty" (custom heuristics) → return.
  3. If fallback exists → call fallback; if fallback returns non-empty success → return fallback.
  4. Else return primary result (even if failure) with trace merging.
- Empty detection heuristics examine typical provider keys: `events`, `teams`, `players`, `table`, and AllSports `result`/`success` patterns.

### 4.4 Adapters
- Prepend an adapter trace marker.
- Guarantee uniform keys for router consumption.

---
## 5. Intents Reference (Selected)
| Intent | Primary | Args (common) | Notes |
|--------|---------|--------------|-------|
| leagues.list | TSDB | name? | Filters by substring match (TSDB) or falls back to AllSports. |
| teams.list | TSDB | teamName | Multi-path: name search, league roster, country filter. |
| team.get | TSDB | teamId or teamName | Safeguards against upstream mismatches; layered fallback. |
| events.list | TSDB | leagueId / leagueName / teamId / date | Chooses proper endpoint based on args. |
| event.get | TSDB | eventName (+eventId) | ID-only disabled due to upstream inconsistency; expansions supported. |
| players.list | AllSports | playerName / teamId | TSDB fallback for legacy player search if needed. |
| events.live | AllSports | leagueId? | Livescore feed; router falls back to TSDB nonequivalent only for symmetry. |
| league.table | TSDB | leagueId/leagueName + season | Raw standings. |
| video.highlights | TSDB | eventName (+eventId) | AllSports has own Videos intent as well (router chooses per sets). |
| venue.get | TSDB | venueId or eventName | Resolves event then venue. |

(See source for full list; this table highlights core flows.)

---
## 6. Data Flow Example (teams.list by leagueName)
1. Client POSTs `/collect` with `{intent:"teams.list", args:{"leagueName":"English Premier League"}}`.
2. Router selects TSDB primary → Adapter → CollectorAgentV2.
3. Collector attempts `/search_all_teams.php` with sport filter; if empty retries without filter.
4. If still empty: resolves league ID via `_resolve_league_id` then calls `/lookup_all_teams.php`.
5. If still empty and AllSports fallback enabled, router triggers fallback.
6. Response returns raw team rows + trace showing each HTTP attempt.

---
## 7. Running in Different Contexts
### 7.1 Development (Auto Reload)
```bash
python run_server.py --reload --port 8000 --debug
```
### 7.2 Production (Example – basic)
Use a process manager (e.g., `gunicorn` with `uvicorn.workers.UvicornWorker`) after ensuring `sports-ai` is importable; or build a container adding the project root to `PYTHONPATH`.

### 7.3 Offline / Fixture Mode
You can cache JSON responses in `backend/app/cache/` or `sports-ai/data/` and wire a simple layer to load from disk when network is unavailable (not implemented yet; add a flag like `OFFLINE_MODE=1`).

---
## 8. Testing Strategy (Recommended)
Add tests under `sports-ai/backend/tests/`:
- `test_tsdb_resolution.py` – mock `get_json` to verify league/team resolution branches.
- `test_router_fallback.py` – simulate empty primary and valid fallback.
- `test_all_sports_name_resolution.py` – confirm name→ID augmentation.
Use `pytest` + `responses` (for `requests`) or hand-crafted fakes.

Example skeleton:
```python
# sports-ai/backend/tests/test_router_fallback.py
from sports-ai.backend.app.routers.router_collector import RouterCollector

def test_empty_primary_fallback(monkeypatch):
    r = RouterCollector()
    # monkeypatch r.tsdb.call to return empty
    ...
```

---
## 9. Performance & Scaling Considerations
- Current design is synchronous & blocking: under load, concurrency limited by worker processes.
- Upgrade path: convert TSDB agent to async (aiohttp or httpx.AsyncClient) + FastAPI async endpoints.
- Add caching (LRU or Redis) for stable resources: league lists, team rosters.
- Implement request collapsing for simultaneous identical intents.

---
## 10. Security & Operational Notes
- Never commit real provider API keys; use `.env` or deployment secrets.
- Rate limits: add adaptive backoff; TSDB free tier is sensitive to rapid bursts.
- Logging: integrate structured logging (uvicorn + loguru/standard logging). Include request ID correlation for multi-call traces.
- Validation: consider Pydantic models for request body (currently raw `dict`).

---
## 11. Extending the System
| Goal | Change |
|------|--------|
| Add new provider | Create new `XAdapter` + raw agent; register routing rule. |
| Normalize cross-provider schema | Introduce a `normalizers/` layer producing canonical DTOs. |
| Caching | Add `services/cache_service.py` and wrap `_http` calls. |
| Observability | Add metrics (Prometheus) counting intents, fallbacks, errors. |
| Async support | Replace blocking I/O with async HTTP clients & `async def` endpoints. |

---
## 12. Troubleshooting
| Symptom | Cause | Action |
|---------|-------|--------|
| `NO_API_KEY` error for AllSports | Missing env var | Set `ALLSPORTS_API_KEY` and restart. |
| `UNKNOWN_INTENT` | Typo in intent | Check router/adapters for allowed intents. |
| Event mismatch (wrong data) | TSDB `lookupevent.php` inconsistency | Use name-based search path (already enforced in `event.get`). |
| Empty fallback chain | Both providers returned empty or failed | Inspect `meta.trace` for HTTP steps. |

---
## 13. Sample Programmatic Usage (Python)
```python
from sports-ai.backend.app.routers.router_collector import RouterCollector
router = RouterCollector()
resp = router.handle({
    "intent": "events.list",
    "args": {"leagueName": "English Premier League", "kind": "past"}
})
if resp.get("ok"):
    print("Events:", len(resp["data"].get("events") or []))
else:
    print("Error:", resp.get("error"))
```

---
## 14. Generating Documentation Artifacts
PDF:
```bash
pandoc README_EXTENDED.md -o docs/extended_guide.pdf
```
(Ensure `docs/` exists.)

OpenAPI (if you later add FastAPI routes beyond `/collect`):
```python
from fastapi.openapi.utils import get_openapi
# within the app context
```

---
## 15. Dependency Notes
`requirements.txt` includes heavy ML/vision/audio libs (tensorflow, moviepy, librosa, scikit-learn) not required for core routing. For a lean deployment, create a trimmed `requirements-api.txt` containing only: `fastapi`, `uvicorn`, `requests`, `python-dotenv`, `pydantic`, and any logging libs.

---
## 16. Roadmap Suggestions
1. Add async provider clients.
2. Implement a shared response normalization layer.
3. Provide a UI panel showing traces (intents + fallback path).
4. Add Redis cache for rate-limited endpoints.
5. Introduce message queue for scheduled data pulls (fixtures refresh). 
6. Auto-generate provider usage metrics.

---
## 17. License / Attribution (Add Later)
Include TheSportsDB & AllSports terms per their usage policies; ensure attribution requirements are met before public deployment.

---
## 18. Glossary
- Intent: High-level operation name that maps to a provider endpoint set.
- Capability (`_cap_*`): Internal TSDB collector method implementing one intent.
- Fallback: Secondary provider attempt when primary fails/empty.
- Trace: Ordered list of diagnostic steps collected during a request.

---
## 19. Checklist for Contributors (PR Template Aid)
- [ ] Added/updated unit tests
- [ ] Updated intent table if new intents added
- [ ] Verified no hard-coded secrets
- [ ] Ran `curl` smoke tests for modified intents
- [ ] Updated `README_EXTENDED.md` if architectural changes introduced

---
## 20. Final Notes
This extended guide is designed to onboard new contributors rapidly and serve as a living design document. Keep it updated as routing rules, providers, or abstractions evolve.

Happy building.
