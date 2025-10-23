# Subscriptions Setup

This guide explains how the `subscriptions.sql` schema connects to the direct Stripe integration that now powers the Free vs Pro plans.

## Schema overview

- `subscriptions` table is keyed by `auth.users.id`, defaults every new user to `plan = 'free'`, and stores Stripe identifiers plus the current billing period.
- Trigger `on_auth_user_subscription_default` inserts a Free record immediately after sign-up so the UI can always read a plan.
- View `user_subscription_plan` exposes the plan snapshot (plan, status, current period end) without leaking Stripe secrets to the client.
- Row Level Security keeps user reads/writes scoped to their own row; Supabase service-role clients bypass RLS for webhook and server tasks.

## Required environment variables

Set these wherever your Next.js app runs (local `.env`, Vercel, Netlify, etc.):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE`
- `NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE`

The public price IDs come directly from Stripe and are used by the checkout forms. The secret values are only accessed inside the Next.js API routes and should never be committed.

## Deployment checklist

1. **Run `subscriptions.sql`**: Execute once per environment via the Supabase SQL editor or Supabase CLI. This creates the table, trigger, view, and policies described above.
2. **Create Stripe products**: In the Stripe Dashboard, make Pro subscription prices (monthly + yearly) with a seven-day trial. Copy their `price_xxx` IDs into the environment variables listed above.
3. **Configure webhook endpoint**: Point Stripe to the deployed URL of `api/stripe/webhook` (for example `https://your-domain.com/api/stripe/webhook`) and copy the generated signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Verify auth metadata**: Ensure every Checkout Session includes `metadata.user_id` set to the Supabase `auth.users.id`. The server-side helpers in this repo do this automatically when users open the upgrade form.
5. **Enable billing portal**: In Stripe → Billing → Customer portal, ensure a return URL points to `/profile` (or wherever you want users to land after managing billing).

## Application routes

- `src/app/api/stripe/create-checkout/route.ts` uses the authenticated Supabase session plus the service-role client to create or reuse a Stripe customer, then opens a Checkout Session with the 7-day trial price. It requires the price IDs above and attaches `metadata.user_id`.
- `src/app/api/stripe/create-portal/route.ts` creates a customer portal session so Pro users can cancel or change plans without leaving the app. It shares the same service-role helper to read the stored customer ID.
- `src/app/api/stripe/webhook/route.ts` verifies Stripe signatures and upserts into `public.subscriptions`. Events handled today: `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- The plan provider/hook located at `src/hooks/usePlan.ts` reads the `user_subscription_plan` view via a Supabase browser client. UI components such as `Navbar`, `Profile`, and `FloatingChatbot` use this hook to show the current badge or gate Pro features.

## Local testing with Stripe CLI

1. Login once with `stripe login` so the CLI can forward events.
2. Forward events to your Next dev server: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. Trigger life-cycle events such as `stripe trigger checkout.session.completed` or `stripe trigger customer.subscription.updated`.
4. Watch the dev server logs and confirm Supabase shows the expected row updates in `public.subscriptions`.

## Operational tips

- The subscription row is considered Pro whenever Stripe marks the subscription `trialing` or `active`. All other statuses fall back to the Free plan so the UI instantly reflects cancellations.
- If you rotate any secrets, redeploy the Next.js app so the lambda environment receives the new values.
- For manual adjustments (e.g., issuing a courtesy extension), update `plan`, `subscription_status`, and `current_period_end` directly in Supabase; the view will reflect the change immediately.
- When running integration tests, set Stripe keys to test credentials and use the Stripe CLI fixtures to simulate trials and renewals.
