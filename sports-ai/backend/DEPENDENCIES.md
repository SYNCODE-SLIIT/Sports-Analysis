# Backend Dependencies

This service is built with Python 3.10+ and the packages pinned in `requirements.txt`.

| Package | Why it is required |
|---------|--------------------|
| fastapi | Core web framework exposing the HTTP API. |
| uvicorn[standard] | ASGI server used to run the FastAPI app in production. |
| python-dotenv | Loads environment variables from `.env` during local development. |
| pydantic | Data validation and settings helpers used by routers/services. |
| requests | Synchronous HTTP helper (legacy adapters). |
| httpx | Primary HTTP client with better timeout/retry support. |
| groq | Access to the Groq LLM endpoints used by chatbot/summarizer features. |
| beautifulsoup4 / bs4 | HTML parsing for highlight scraping. |
| pytubefix | YouTube metadata extraction when scraping highlights. |
| librosa | Audio analysis utilities used in highlight processing. |
| opencv-python | Video frame handling for highlight utilities. |
| numpy | Numerical base library used by ML/audio/video helpers. |
| pandas | Tabular data wrangling for timelines and analytics. |
| scikit-learn | Model helpers for tagging and predictions. |
| joblib | Persisting/loading trained sklearn models. |
| pyspellchecker | Lightweight spell-checking for text normalization. |
| six | Compatibility shim required by some upstream libraries. |

Any additional libraries should be added to `requirements.txt` and, if noteworthy, documented in this table.
