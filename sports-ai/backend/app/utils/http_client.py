from __future__ import annotations
import time
import httpx
from .config import BASE_URL, TIMEOUT_S, RETRY_BACKOFFS

def get_json(path: str, params: dict | None = None) -> dict | list:
    """GET JSON with retries/backoff + empty-payload guard."""
    url = f"{BASE_URL}/{path.lstrip('/')}"
    last_err = None
    for backoff in [0.0] + RETRY_BACKOFFS:
        if backoff:
            time.sleep(backoff)
        try:
            r = httpx.get(url, params=params, timeout=TIMEOUT_S)
            if r.status_code in (429, 500, 502, 503, 504):
                last_err = RuntimeError(f"{r.status_code} {url}")
                continue
            r.raise_for_status()
            data = r.json()
            # TheSportsDB returns {"key": null} for empty responses
            if isinstance(data, dict) and data and all(v is None for v in data.values()):
                return {}
            return data
        except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as e:
            last_err = e
            continue
    raise RuntimeError(f"HTTP failed after retries: {last_err}")