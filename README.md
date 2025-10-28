# Athlete

> Multi-agent sports analysis assistant built for fans.

Athlete is a multi-agent football intelligence platform that fuses live data, model-driven analysis, and generative AI to deliver match insights in real time. The system combines a Next.js 15 web app, a FastAPI orchestration layer, Supabase for persistence, and Stripe-backed subscriptions so fans can move from live scores to deep analytics and AI-powered commentary.

## Live Demo

- https://athlete-analysis.vercel.app/

## Highlights

- Live matches and win probability dashboards with best-player heuristics (`web/src/app/page.tsx`, `sports-ai/backend/app/agents/analysis_agent.py#L1`).
- Highlights and timeline storytelling pulled from AllSports with custom tagging (`sports-ai/backend/app/services/highlight_search.py`).
- Personalized news and recommendation feeds powered by Supabase RPCs (`web/src/hooks/useRecommendations.ts`).
- ATHLETE AI chatbot for Pro members, orchestrating Groq models with Tavily search (`sports-ai/backend/app/services/chatbot.py`).
- My Teams personalization with cached logos and favorite limits (`web/src/app/my-teams/page.tsx`).
- Stripe-backed Pro plan with 7-day trial, billing portal, and admin controls (`web/src/app/api/stripe`, `web/src/app/admin/AdminDashboard.tsx`).

## Tech Stack

- Frontend: Next.js 15, React 19, Tailwind v4, Radix UI, SWR, TanStack Query.
- Backend: FastAPI, RouterCollector, AllSports & TheSportsDB adapters, custom analysis agents.
- Data & Auth: Supabase (Postgres, Auth, RPC, Realtime).
- Payments: Stripe subscriptions and billing portal.
- AI & Search: Groq chat models, Tavily web search.

## Repository layout

```
.
├─ run_server.py
├─ sports-ai/
│  └─ backend/app/
│     ├─ main.py                       # FastAPI entrypoint
│     ├─ routers/
│     │  ├─ router_collector.py        # Intent router
│     │  └─ chatbot.py                 # Chatbot-specific routes
│     ├─ agents/
│     │  ├─ analysis_agent.py
│     │  ├─ collector.py               # TheSportsDB agent
│     │  ├─ collector_agent.py         # AllSports agent
│     │  ├─ highlight_agent.py
│     │  └─ summarizer.py              # Markdown summarizer FastAPI app
│     ├─ services/
│     │  ├─ chatbot.py                 # Groq + Tavily orchestration
│     │  ├─ highlight_search.py
│     │  ├─ news_feed.py
│     │  └─ nl_search.py
│     ├─ adapters/                     # Provider wrappers
│     ├─ cache/                        # Fixture snapshots
│     └─ utils/http_client.py
└─ web/
   ├─ src/app/
   │  ├─ page.tsx                      # Landing page
   │  ├─ live/page.tsx                 # Live fixture hub
   │  ├─ upcoming-fixtures/page.tsx
   │  ├─ leagues/page.tsx
   │  ├─ news/page.tsx
   │  ├─ match/[eventId]/page.tsx
   │  ├─ my-teams/page.tsx
   │  ├─ chatbot/page.tsx
   │  └─ admin/                        # Admin dashboard routes
   │     ├─ AdminDashboard.tsx
   │     ├─ SubscriptionManager.tsx
   │     ├─ overview/page.tsx
   │     ├─ subscriptions/page.tsx
   │     └─ system/page.tsx
   ├─ src/components/                  # UI kit, chatbot, plan-aware layouts
   ├─ src/lib/                         # API helpers, Supabase & Stripe clients
   ├─ src/hooks/                       # Plan, recommendations, win probability
   ├─ tools/backfill_logos.ts          # Logo ingestion helper
   ├─ supabase.sql                     # Core schema and RPCs
   ├─ subscriptions.sql                # Stripe subscription schema
   └─ admin_controls.sql               # Admin tables and functions
```


## Contributors

[![Contributors](https://contrib.rocks/image?repo=SYNCODE-SLIIT/Sports-Analysis)](https://github.com/SYNCODE-SLIIT/Sports-Analysis/graphs/contributors)

See [all contributors](https://github.com/SYNCODE-SLIIT/Sports-Analysis/graphs/contributors).

## Environment configuration

Create two env files:

- `.env` for the FastAPI backend (loaded by `run_server.py`).
- `web/.env.local` for the Next.js app.

### Backend (FastAPI)

| Variable                | Required           | Description                                                                                                             |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `ALLSPORTS_API_KEY`     | Yes                | Key for the AllSports football API used by `AllSportsRawAgent` (`sports-ai/backend/app/agents/collector_agent.py#L31`). |
| `ALLSPORTS_BASE_URL`    | No                 | Override the AllSports API base URL if you use a proxy.                                                                 |
| `THESPORTSDB_API_KEY`   | No                 | Key for TheSportsDB fallback (`sports-ai/backend/app/utils/http_client.py#L6`). Defaults to the public demo key.        |
| `NEWS_API_KEY`          | Yes (to show news) | News provider key required by `LeagueNewsService` (`sports-ai/backend/app/services/news_feed.py#L18`).                  |
| `NEWS_API_URL`          | No                 | Custom endpoint for the news service.                                                                                   |
| `CHATBOT_HISTORY_LIMIT` | No                 | Adjusts how many prior messages the chatbot keeps.                                                                      |

### AI & Search

| Variable                                                                             | Required | Description                                                                                                           |
| ------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `GROQ_API_KEY`                                                                       | Yes      | Auth token to call Groq chat completions for planner/writer models (`sports-ai/backend/app/services/chatbot.py#L74`). |
| `GROQ_PLANNER_MODEL`                                                                 | No       | Override the planner model name; defaults to `llama3-8b-8192`.                                                        |
| `GROQ_WRITER_MODEL`                                                                  | No       | Override the writer model name; defaults to `llama3-70b-8192`.                                                        |
| `GROQ_SUGGESTION_MODEL`                                                              | No       | Model used for suggested prompts.                                                                                     |
| `GROQ_PLANNER_TEMPERATURE`, `GROQ_WRITER_TEMPERATURE`, `GROQ_SUGGESTION_TEMPERATURE` | No       | Tune output variability.                                                                                              |
| `TAVILY_API_KEY` (or `TAVIL_API_KEY`)                                                | Yes      | API key required for Tavily web search in the chatbot planner.                                                        |

### Supabase (auth, RPC, preferences)

| Variable                        | Required | Description                                                                         |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes      | Public endpoint for the Supabase project (`web/src/lib/supabase/client.ts#L8`).     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes      | Public anon key for browser clients.                                                |
| `SUPABASE_URL`                  | Yes      | Service URL used by server-side routes (`web/src/lib/supabase/service-role.ts#L6`). |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes      | Service role key required for secure RPCs and Stripe webhook handlers.              |

### Stripe & payments

| Variable                                                                      | Required | Description                                                                                |
| ----------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `STRIPE_SECRET_KEY`                                                           | Yes      | Server-side API key (`web/src/lib/stripe/client.ts#L7`).                                   |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`                                          | Yes      | Publishable key for client-side Stripe.js (`web/src/lib/stripe/public.ts#L9`).             |
| `NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE`, `NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE` | Yes      | Pro plan price IDs shown in UI (`web/SUPABASE_SUBSCRIPTIONS.md`).                          |
| `STRIPE_WEBHOOK_SECRET`                                                       | Yes      | Secret to verify webhook signatures (`web/src/app/api/stripe/webhook/route.ts`).           |
| `NEXT_PUBLIC_SITE_URL`                                                        | Yes      | Used for checkout success/cancel URLs (`web/src/app/api/stripe/create-checkout/route.ts`). |

### Backend ↔ Frontend wiring

| Variable               | Required               | Description                                                                               |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `API_BASE_INTERNAL`    | Yes (server-to-server) | Internal FastAPI base URL for Next.js API routes (`web/src/app/api/summarizer/route.ts`). |
| `NEXT_PUBLIC_API_BASE` | Optional               | If set, the browser can call FastAPI directly; otherwise, it uses Next.js proxies.        |

## Database setup (Supabase)

Run these SQL files in order using the Supabase SQL editor or CLI:

1. `web/supabase.sql` – creates profiles, user preferences, items, recommendation RPCs, cached logos, and interaction tracking.
2. `web/subscriptions.sql` – provisions subscription table, trigger, policies, and plan snapshot view.
3. `web/admin_controls.sql` – installs admin accounts, system flags, maintenance helpers, and admin dashboard RPCs.

Grant the service role access to execute the created functions, and ensure `public` schema RLS policies remain enabled as defined in the scripts.

## Local development

1. **Install Python dependencies**

   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Install web dependencies**

   ```bash
   cd web
   npm install
   ```

3. **Configure environment**

   - Populate `.env` with backend keys (AllSports, Groq, Tavily, News, Stripe).
   - Populate `web/.env.local` with Supabase, Stripe, and API base values.

4. **Start the FastAPI backend**

   ```bash
   python run_server.py --reload --port 8000
   ```

   The server exposes `/health`, `/collect`, `/matches/*`, `/chatbot/web-search`, and mounts `/summarizer`.

5. **Start the Next.js app**

   ```bash
   cd web
   npm run dev
   ```

   Visit http://localhost:3000. The app proxies backend requests through `/api/*` routes and expects the backend on `http://127.0.0.1:8000`.

6. **Run Supabase migrations**

   Execute the SQL scripts above once per environment before logging in or running Stripe flows.

## Feature tour

- Home & live scoreboard – `web/src/app/page.tsx`: hero section, live/upcoming tabs, league fixtures, news preview, and analysis spotlight.
- Live & upcoming matches – `web/src/components/LiveUpcomingTabs.tsx`: toggles between live data and scheduled fixtures using `events.live` and `events.list`.
- League explorer – `web/src/app/leagues/page.tsx`: filters by country, track leagues, and persists favorites via Supabase with Pro limits.
- News hub – `web/src/app/news/page.tsx`: league-aware articles and summary cards using the news service.
- Match insights – `web/src/app/match/[eventId]/page.tsx`: lineups, rich timeline, best player heuristics, win probability charts, odds snapshots, and highlight reels.
- My Teams – `web/src/app/my-teams/page.tsx`: manage favorite teams/leagues with cached logos, search integration, and Pro limits for saved items.
- Chatbot – `web/src/app/chatbot/page.tsx` + `web/src/components/chatbot`: Pro-only chat surface backed by Groq + Tavily, with floating launcher and prompt suggestions.
- Admin dashboard – `web/src/app/admin/AdminDashboard.tsx`: overview metrics, interactions sparklines, user list, subscriptions manager, and system flags (maintenance, highlights automation, AI alerts).

## Plans

| Capability                                                        | Free Plan        | Pro Plan                            |
| ----------------------------------------------------------------- | ---------------- | ----------------------------------- |
| Live scores, fixtures, league tables                              | ✅               | ✅                                  |
| Personalized news & recommendations                               | ✅               | ✅                                  |
| Save favourite teams/leagues                                      | Up to 3 each     | Unlimited                           |
| AI-powered match analytics (win prob, H2H summaries, best player) | Limited previews | Full access with continuous refresh |
| Highlight search & video reels                                    | ✅               | ✅                                  |
| ATHLETE AI chatbot                                                | 🔒               | ✅                                  |
| Recommendations feed & interaction tracking                       | ✅               | ✅                                  |
| Admin controls & Pro badge                                        | 🔒               | ✅                                  |
| 7-day trial                                                       | —                | ✅ (auto-applied on first upgrade)  |

## Backend API

### POST `/collect`

Unified intent router; accepts `{ "intent": "events.list", "args": { ... } }` and dispatches to AllSports or TheSportsDB via `RouterCollector` (`sports-ai/backend/app/routers/router_collector.py#L44`).

```bash
curl -s http://127.0.0.1:8000/collect \
  -H "Content-Type: application/json" \
  -d '{"intent":"analysis.winprob","args":{"eventId":"12345"}}'
```

Response envelope:

```json
{
  "ok": true,
  "intent": "analysis.winprob",
  "data": {
    "eventId": "12345",
    "method": "form_logistic",
    "probs": { "home": 0.47, "draw": 0.28, "away": 0.25 }
  },
  "meta": { "source": { "primary": "analysis" }, "trace": [...] }
}
```

### GET `/matches/details`

Returns live and finished matches merged from providers for a date (`sports-ai/backend/app/main.py#L41`). Accepts `date=YYYY-MM-DD`.

### GET `/matches/history`, `/matches/history_dual`, `/matches/history_raw`

Aggregated historical fixtures per league, dual-provider merging, or raw lists.

### GET `/leagues`

Direct alias to `leagues.list`.

### POST `/chatbot/web-search`

Routes chat questions through Groq planner & writer with Tavily context (`sports-ai/backend/app/routers/chatbot.py#L19`). Pro users call this via Next.js API (`web/src/app/api/chatbot/route.ts`).

### Summarizer (`/summarizer/summarize`)

Mounted app from `sports-ai/backend/app/agents/summarizer.py` for event summaries. Accessed via `/api/summarizer` proxy.

### Stripe webhooks

`POST /api/stripe/webhook` (Next.js) listens for subscription events and updates Supabase (`web/src/app/api/stripe/webhook/route.ts`).

## Agents and services

- `AnalysisAgent` – computes win probability, form, and H2H (`sports-ai/backend/app/agents/analysis_agent.py#L34`).
- `HighlightAgent` – merges AllSports and TSDB highlight feeds (`sports-ai/backend/app/agents/highlight_agent.py`).
- `AllSportsRawAgent` – pass-through to AllSports with name-to-ID resolution and timeline synthesis (`sports-ai/backend/app/agents/collector_agent.py#L69`).
- `CollectorAgentV2` – curated TheSportsDB fallback with rich ID resolution (`sports-ai/backend/app/agents/collector.py#L30`).
- `LeagueNewsService` – wraps NewsAPI for curated articles (`sports-ai/backend/app/services/news_feed.py#L1`).
- `ChatbotService` – orchestrates planner, search, and writer pipelines (`sports-ai/backend/app/services/chatbot.py#L20`).

## Data & integrations

- AllSports API: live fixtures, odds, comments, videos (requires paid key).
- TheSportsDB: fallback for leagues, teams, timelines.
- Tavily Search: current-event context for the chatbot.
- Groq Models: planner/writer/tone control for AI answers.
- Supabase: preferences, cached assets, recommendations (`web/supabase.sql`).
- Stripe: subscriptions, webhooks, billing portal (`web/subscriptions.sql`).

## Deployment notes

- Deploy the Next.js app on Vercel or similar; set environment variables to point at your FastAPI base URL.
- Run FastAPI on a managed service (Railway, Fly.io, Render) with the same `.env` you use locally. Expose ports 80/443 and ensure CORS widens to the web host (`sports-ai/backend/app/main.py#L23`).
- Configure Stripe webhook endpoint to `https://<your-web-domain>/api/stripe/webhook`.
- Supabase SQL scripts are idempotent and can be re-run safely when promoting environments.

## Testing & quality

- Backend unit tests live in `sports-ai/backend/app/tests/`; run with:

  ```bash
  pytest sports-ai/backend/app/tests
  ```

- Frontend linting:

  ```bash
  cd web
  npm run lint
  ```

- Consider adding integration tests around `/collect` intents and Next.js API routes before production releases.

## Troubleshooting

- **Empty AllSports responses** – verify `ALLSPORTS_API_KEY` and provider quota; `RouterCollector` will fallback to TSDB, but some intents are AllSports-only.
- **Chatbot refusing queries** – ensure both `GROQ_API_KEY` and `TAVILY_API_KEY` are set; missing keys throw `missing_credentials` errors (`sports-ai/backend/app/services/chatbot.py#L108`).
- **Stripe checkout `price_xxx` errors** – set `NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE` and `NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE` to real price IDs, not numeric amounts.
- **Supabase RLS blocking inserts** – confirm service role key is available to server routes and the SQL scripts ran successfully.
- **Missing logos** – run the app to warm `cached_teams`/`cached_leagues` tables; the My Teams page backfills logos automatically for Pro users.

## Roadmap ideas

- Async AllSports adapter to improve throughput.
- Redis caching for fixture lists and highlights.
- Expanded sport coverage beyond football.
- Automated quality checks for AI answers with feedback loop.

## Attributions & disclaimer

- Data powered by AllSportsAPI and TheSportsDB – review and comply with their usage policies.
- Chatbot answers are informational only and should not be treated as betting advice.
- News summarisation leverages third-party APIs; respect source licenses when redistributing content.

## License

Athlete is released under the [Apache License 2.0](LICENSE).

## Contributing & support

- Fork and open pull requests; include tests and update documentation when behavior changes.
- Use conventional commits where possible and run `pytest` / `npm run lint` before submitting.
- For internal teams, open issues in the project tracker or contact the platform engineering group.

Happy analyzing! ⚽️
