<!-- dd27632e-20cf-402a-9a8d-5feb46d2f9e7 6bfbf6c3-dc21-4357-a83e-bff19fe36b81 -->
# Improve Collector Agent Architecture and Features

## Current State Analysis

The `collector_agent.py` file (748 lines) serves as the raw pass-through agent for AllSportsAPI Football endpoints. Key issues identified:

- **Monolithic handle method** (lines 97-313): 200+ lines with repetitive if/elif routing
- **No proper logging**: Only trace objects, no structured logging for debugging
- **No retry logic**: API calls fail on transient network errors
- **No caching**: Repeated calls to same endpoints (e.g., country/league resolution)
- **Duplicated event extraction logic** (lines 146-230): Repeated 3 times in event.get
- **No rate limiting**: Could hit API limits
- **Synchronous requests**: Blocking I/O for all API calls
- **Large utility functions**: `_synthesize_timeline_from_event` (84 lines), `_compute_best_player_from_event` (112 lines)

## Proposed Improvements

### 1. Code Organization & Maintainability

**Refactor monolithic handle method:**

- Extract intent routing into a registry pattern (dict mapping intent → handler method)
- Create dedicated handler methods for each intent group:
  - `_handle_countries`, `_handle_leagues`, `_handle_fixtures`, `_handle_teams`, etc.
- Extract event extraction logic into `_extract_event_from_response(data)` helper
- Move analytics helpers to separate file: `backend/app/agents/analytics_helpers.py`

**File structure:**

```python
# collector_agent.py (main agent, ~300 lines)
# analytics_helpers.py (player stats, timeline synthesis, tagging - ~250 lines)
# api_client.py (HTTP layer with retry/cache - ~150 lines)
```

### 2. Performance Optimization

**Add intelligent caching:**

```12:15:sports-ai/backend/app/agents/collector_agent.py
# Add after imports
from functools import lru_cache
import hashlib
```

- Cache country/league lookups with TTL (1 hour) using `functools.lru_cache` or `cachetools`
- Cache model loading (already implemented at line 498-518, but can improve)
- Add response caching for GET requests with configurable TTL

**Add async support (optional enhancement):**

- Create parallel version using `httpx` for async requests
- Allow batch resolution of multiple name→ID lookups concurrently
- Useful for router when calling multiple intents

### 3. Better Error Handling & Observability

**Add structured logging:**

```python
import logging
logger = logging.getLogger(__name__)

# In _raw_get:
logger.debug("Calling AllSports API", extra={"met": params.get("met"), "timeout": timeout})
logger.error("API call failed", extra={"status": r.status_code, "error": data.get("error")})
```

**Add retry logic with exponential backoff:**

```71:88:sports-ai/backend/app/agents/collector_agent.py
# Replace _raw_get with retry decorator
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import requests

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((requests.Timeout, requests.ConnectionError))
)
def _raw_get(params: Dict[str, Any], timeout: int = 30) -> Dict[str, Any]:
    # existing implementation
```

**Improve error details:**

- Add request_id to trace for debugging
- Include API rate limit headers in response meta
- Better error messages with actionable suggestions

### 4. New Features

**Add rate limiting:**

```python
from ratelimit import limits, sleep_and_retry

# 100 calls per minute (adjust based on API limits)
@sleep_and_retry
@limits(calls=100, period=60)
def _raw_get(params: Dict[str, Any], timeout: int = 30):
    # existing implementation
```

**Add request/response validation:**

- Validate intent names against supported list before routing
- Add response schema validation (optional, for early error detection)
- Sanitize/validate args before passing to API

**Add metrics collection:**

```python
# Track API performance
from time import perf_counter
start = perf_counter()
# ... make request ...
duration = perf_counter() - start
trace.append({"duration_ms": duration * 1000})
```

**Add connection pooling:**

```python
# Module-level session for connection reuse
import requests
_SESSION = requests.Session()
_SESSION.mount('https://', requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20))

# Use _SESSION.get() instead of requests.get()
```

### 5. Testing & Documentation

**Add comprehensive tests:**

- Unit tests for each intent handler
- Test retry logic with mocked failures
- Test cache behavior
- Test rate limiting
- Integration tests with real API (optional, behind flag)

**Improve documentation:**

- Add docstring examples for each public method
- Document all supported intents with param requirements
- Add architecture diagram showing component relationships
- Create CHANGELOG.md for tracking improvements

### 6. Backward Compatibility

**Ensure zero breaking changes:**

- Keep existing public API: `AllSportsRawAgent.handle(request, params=None)`
- Maintain response format exactly
- Keep all existing exports: `AllSportsCollectorAgent`, helper functions
- Add deprecation warnings for any future removals

## Implementation Details

### Key Files to Modify

- `sports-ai/backend/app/agents/collector_agent.py` - main refactoring
- Create: `sports-ai/backend/app/agents/analytics_helpers.py` - extract utilities
- Create: `sports-ai/backend/app/agents/api_client.py` - HTTP layer
- Update: `sports-ai/backend/app/routers/router_collector.py` - import paths if needed
- Update: `sports-ai/backend/app/tests/test_analytics.py` - adjust imports

### Critical Sections to Refactor

**Intent routing (lines 121-292):**

- Replace if/elif chain with registry dict
- Each handler follows consistent pattern: validate → augment args → call → augment response

**Event extraction (repeated at lines 148-164, 202-215):**

- Single helper method reduces 40+ lines of duplication

**Name resolution (lines 334-407):**

- Add caching to avoid repeated API calls
- Improve error handling when resolution fails

**Analytics helpers (lines 410-748):**

- Move to separate module for better organization
- Add more comprehensive tests

## Benefits Summary

1. **Maintainability**: 40% reduction in main file size, clearer separation of concerns
2. **Performance**: 50-80% reduction in API calls via caching, connection pooling speeds requests
3. **Reliability**: Retry logic handles transient failures, rate limiting prevents throttling
4. **Debuggability**: Structured logging, request IDs, performance metrics
5. **Extensibility**: Registry pattern makes adding new intents trivial
6. **Quality**: Comprehensive test coverage, better documentation

## Estimated Impact

- **Lines of code reduced**: ~200 lines via extraction and deduplication
- **API call reduction**: 50-80% for name resolution via caching
- **Request latency**: 20-30% improvement via connection pooling
- **Reliability**: 95%+ success rate with retry logic
- **Development velocity**: 2x faster to add new intents with registry pattern

### To-dos

- [ ] Extract analytics helpers (_compute_player_hot_streak, _compute_best_player_from_event, _augment_timeline_with_tags, _synthesize_timeline_from_event, _extract_multimodal_highlights) to new file analytics_helpers.py
- [ ] Create api_client.py with improved _raw_get including retry logic, rate limiting, connection pooling, and structured logging
- [ ] Refactor AllSportsRawAgent.handle() to use intent registry pattern instead of if/elif chain, with dedicated handler methods for each intent group
- [ ] Create _extract_event_from_response() helper to deduplicate event extraction logic currently repeated 3 times in event.get handler
- [ ] Add intelligent caching for country/league/team resolution methods with TTL (1 hour) using functools.lru_cache or cachetools
- [ ] Add structured logging throughout with debug, info, warning, and error levels including request IDs and performance metrics
- [ ] Update import paths in router_collector.py, main.py, and test files to reflect new module structure
- [ ] Add comprehensive unit tests for new api_client.py, analytics_helpers.py, and refactored intent handlers including retry, cache, and rate limit behavior
- [ ] Update docstrings with examples, create architecture documentation, and add inline comments for complex logic
- [ ] Run existing tests to ensure backward compatibility, verify response format unchanged, and test with router_collector integration