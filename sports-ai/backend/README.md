# Sports Analysis Backend

FastAPI service powering the Sports Analysis application. This folder is self-contained for hosting on Render, Railway, Fly.io, etc.

## Quick start (local)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in secrets
uvicorn app.main:app --reload
```

Visit `http://127.0.0.1:8000/health` to confirm it’s running.

## Deployment

### Render

1. Push this folder to Git (or configure Render to use the repo root and set **Root Directory** to `sports-ai/backend`).
2. Create a **Web Service** on Render.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables (at minimum `ALLSPORTS_API_KEY`; optional ones described below).
6. Deploy. Render will expose an HTTPS URL for the API.

### Railway / other providers

Use the same build + start commands. Ensure the platform passes the port via `$PORT`.

## Environment variables

Copy `.env.example` and provide the values relevant to the features you enable.

| Variable | Required | Description |
|----------|----------|-------------|
| `ALLSPORTS_API_KEY` | ✅ | AllSports football data API key. |
| `THESPORTSDB_API_KEY` | Optional | API key for TheSportsDB fallback (defaults to `3`). |
| `NEWS_API_KEY` | Optional | Enables NewsAPI headlines. |
| `TAVIL_API_KEY` / `TAVILY_API_KEY` | Optional | Tavily search key for chatbot/summaries. |
| `GROQ_API_KEY` | Optional | Groq LLM key for chatbot/summaries. |
| `YOUTUBE_API_KEY` | Optional | Enhances highlight scraping. |
| `AGENT_MODE`, `TSDB_AGENT_URL`, `ALLSPORTS_AGENT_URL` | Optional | Control agent chaining (defaults are fine for single-instance deployments). |

Any value that starts with `NEXT_PUBLIC_` is **frontend-only** and should not be stored here.

## Project structure

```
backend/
├── app/
│   ├── agents/       # collector, summarizer, highlight helpers
│   ├── routers/      # FastAPI routers
│   ├── services/     # domain services (chatbot, news feed, etc.)
│   ├── utils/        # shared helpers
│   └── main.py       # FastAPI application entrypoint
├── requirements.txt
├── DEPENDENCIES.md
└── README.md (this file)
```

## Troubleshooting

- 404s on `/collect` usually mean `ALLSPORTS_API_KEY` is missing.
- If `/summarize` returns “LLM is not configured,” set `GROQ_API_KEY`.
- `librosa`/`opencv` may require extra system libraries on some hosts. Render’s default Python image ships with them; otherwise, add build hooks.

Enjoy! 🚀
