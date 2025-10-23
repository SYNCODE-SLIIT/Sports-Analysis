<!-- 568084d6-3dff-466d-80f4-b42e9a13ea46 a17eef7e-2309-41dc-bfd5-35e77a5887c8 -->
# Pro Subscription (Stripe) with Feature Gating

## Decision

- Payment gateway: Stripe (global coverage, trials, subscriptions, tax/VAT options, great SDKs)
- Plans: Monthly + Yearly, both with 7‑day trial

## Data model (Supabase)


-  create new table `subscriptions` fields:
  - `plan` text check in ('free','pro') default 'free'
  - `stripe_customer_id` text nullable
  - `stripe_subscription_id` text nullable
  - `stripe_price_id` text nullable
  - `subscription_status` text nullable
  - `current_period_end` timestamptz nullable
-  create a `subscriptions` table keyed by `user_id` with the above fields and a view that exposes `plan`.

## Stripe setup

- Create Product: “Pro” with two Prices:
- Monthly recurring, 7‑day trial
- Yearly recurring (discounted), 7‑day trial
- Webhook events to enable: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_succeeded`, `customer.subscription.trial_will_end`.

## Backend integration (Next.js web)

- Add API routes:
- `web/src/app/api/stripe/create-checkout/route.ts`: creates Checkout Session (mode=subscription), links `price`, sets `trial_period_days=7`, sets `customer` by `stripe_customer_id` or creates new and upserts to profile. Success/cancel URLs -> `/pro/success`, `/pro`.
- `web/src/app/api/stripe/create-portal/route.ts`: creates Billing Portal session.
- `web/src/app/api/stripe/webhook/route.ts`: verify signature; on events, upsert profile/subscription fields and set `plan='pro'` when status in ['active','trialing','past_due']; set `plan='free'` when canceled/ended.
- Supabase service role usage inside webhook via `SUPABASE_SERVICE_ROLE_KEY` (server only). Store envs in `web/.env.local`.

## UI/UX

- Post‑signup upgrade prompt:
- On first login (or when `plan==='free'`), show `UpgradeToProModal`.
- Place in `web/src/components/providers.tsx` or `web/src/app/layout.tsx` with client check of session + plan.
- Pricing page `/pro` with monthly/yearly toggle and CTA buttons calling checkout API.
- Add “Manage billing” button (calls portal API) for Pro users.

## Feature gating (web)

- Central plan hook: `web/src/hooks/usePlan.ts` to fetch user `plan` from Supabase; SSR equivalent helper for server components.
- Create `ProGate` component: if `plan!=='pro'` render an inline CTA (Upgrade card) instead of children.
- Apply `ProGate` around Pro-only UI:
- `web/src/components/chatbot/*`
- `web/src/components/HighlightsCarousel.tsx` (if “insights”)
- `web/src/components/LeagueTabs.tsx` or specific insights widgets
- `web/src/components/match/*` for match summary, win probability, odds/insights blocks
- Extended favorites UI (e.g., beyond N items) – enforce limit in both UI and API

## Server protection (API)

- Next.js API guards: check `plan` server-side before returning Pro data in:
- `web/src/app/api/*` routes that proxy/compute chatbot, news, summaries, win probability, odds, insights.
- Python FastAPI (sports-ai) protection:
- In `sports-ai/backend/app/routers/chatbot.py`, `summarizer.py`, win-prob/odds routes, require a plan header or token claim.
- Approach A (simple): Next.js API is the only caller to Python; it passes `X-User-Plan` or a signed JWT claim; Python checks value against allowed set and denies if not `pro`.
- Approach B (robust): Python verifies Supabase JWT and queries plan; can be added later.

## Limits for Free tier

- Chatbot: disabled (show CTA)
- News: disabled (CTA)
- Match summary: disabled (CTA)
- Win probability: disabled (CTA)
- Odds and insights: disabled (CTA)
- Favorites: allow up to N (e.g., 3) teams/leagues on free; unlimited on Pro. Enforce in `web/src/app/api/...` where favorites are saved and in UI with soft guard.

## Environment/config

- Add envs to `web/.env.local`:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `PRO_MONTHLY_PRICE_ID`, `PRO_YEARLY_PRICE_ID`

## Minimal code references to change/add

- Web (Next.js):
- `web/src/app/api/stripe/create-checkout/route.ts`
- `web/src/app/api/stripe/create-portal/route.ts`
- `web/src/app/api/stripe/webhook/route.ts`
- `web/src/app/pro/page.tsx` (pricing)
- `web/src/components/UpgradeToProModal.tsx`
- `web/src/hooks/usePlan.ts`
- Gating usages in: `web/src/components/chatbot/*`, `web/src/components/match/*`, `web/src/components/LeagueTabs.tsx`, etc.
- Enforce favorites limit in `web/src/app/api/...` route that persists favorites.
- Python (FastAPI):
- Add plan check in `sports-ai/backend/app/routers/chatbot.py`, `sports-ai/backend/app/routers/router_collector.py` (if serving insights), and any summary/win-prob endpoints.

## Rollout and testing

- Create test users for free and pro.
- Verify webhook upgrade/downgrade flips plan.
- Confirm UI gates and API guards block appropriately.
- Add a maintenance banner copy in `MaintenanceBanner.tsx` to advertise Pro on free tier pages.

### To-dos

- [ ] Add plan/subscription fields to Supabase schema
- [ ] Create Stripe product and prices with 7-day trial
- [ ] Implement create-checkout and portal API routes
- [ ] Implement webhook to upsert profile and set plan
- [ ] Create usePlan hook and SSR helper
- [ ] Build ProGate and UpgradeToProModal components
- [ ] Wrap Pro-only components with ProGate across web UI
- [ ] Enforce favorites limit in UI and API
- [ ] Protect Next.js API routes based on plan
- [ ] Add plan checks in FastAPI routers
- [ ] Create /pro pricing page with monthly/yearly toggle
- [ ] Trigger upgrade modal after signup for free users
- [ ] Add Stripe and Supabase env vars to web app