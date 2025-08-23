from __future__ import annotations
import os

API_KEY = os.getenv("THESPORTSDB_KEY", "3")  # free v1 key
BASE_URL = f"https://www.thesportsdb.com/api/v1/json/{API_KEY}"
TIMEOUT_S = 15.0
RETRY_BACKOFFS = [0.5, 1.0, 2.0]  # on 429/5xx
PAUSE_S = 0.35  # polite pause to stay < ~30 req/min