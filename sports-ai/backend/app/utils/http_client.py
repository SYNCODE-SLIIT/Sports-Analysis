"""Lightweight HTTP helper for TheSportsDB requests.

Provides get_json(path, params) used by CollectorAgentV2.
Auto-injects the base URL and API key (public test key by default).
"""
from __future__ import annotations
import os, requests
from typing import Any, Dict

# Public demo key (TheSportsDB) can be overridden with environment variable.
THESPORTSDB_API_KEY = os.getenv("THESPORTSDB_API_KEY", "3").strip()
BASE_URL = f"https://www.thesportsdb.com/api/v1/json/{THESPORTSDB_API_KEY}"

def get_json(path: str, params: Dict[str, Any] | None = None, timeout: int = 15) -> Dict[str, Any]:
    """Perform a GET request to TheSportsDB and return JSON (or {}).

    path: may start with '/' or be relative. Example: '/eventsday.php'
    params: query string dict (optional)
    timeout: request timeout seconds
    """
    if not path:
        return {}
    url = BASE_URL + (path if path.startswith('/') else '/' + path)
    try:
        resp = requests.get(url, params=params or {}, timeout=timeout)
        if resp.status_code == 200:
            try:
                return resp.json() or {}
            except Exception:
                return {}
        # Non-200 -> return minimal structure so caller can handle gracefully
        return {"error": f"status_{resp.status_code}"}
    except requests.RequestException as e:
        return {"error": str(e)}
