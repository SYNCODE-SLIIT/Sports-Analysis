-- Subscriptions data model for Stripe-managed plans (Free vs Pro)
-- NOTE: run this script without wrapping it in an explicit BEGIN/COMMIT

CREATE TABLE IF NOT EXISTS public.subscriptions (
    user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_price_id text,
    subscription_status text,
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.subscriptions IS 'Tracks subscription plan state per user, synced with Stripe.';
COMMENT ON COLUMN public.subscriptions.plan IS 'Application subscription tier. Defaults to free until Stripe upgrades the user to pro.';
COMMENT ON COLUMN public.subscriptions.current_period_end IS 'UTC timestamp describing when the current billed period ends, hydrated from Stripe.';

CREATE OR REPLACE FUNCTION public.set_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := timezone('utc', now());
    RETURN NEW;
END;
$$;

-- Avoid duplicate trigger creation if this file runs more than once.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'set_subscriptions_updated_at_trg'
    ) THEN
        CREATE TRIGGER set_subscriptions_updated_at_trg
        BEFORE UPDATE ON public.subscriptions
        FOR EACH ROW EXECUTE FUNCTION public.set_subscriptions_updated_at();
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    INSERT INTO public.subscriptions (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Automatically provision a free plan row whenever a new auth user is created.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'auth.users'::regclass
          AND tgname = 'on_auth_user_subscription_default'
    ) THEN
        CREATE TRIGGER on_auth_user_subscription_default
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();
    END IF;
END;
$$;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS trial_consumed boolean NOT NULL DEFAULT false;

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS trial_end_at timestamptz;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription" ON public.subscriptions
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;
CREATE POLICY "Users can update own subscription" ON public.subscriptions
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE VIEW public.user_subscription_plan AS
SELECT
    s.user_id,
    COALESCE(s.plan, 'free') AS plan,
    s.subscription_status,
    s.current_period_end,
    s.stripe_price_id,
    s.updated_at,
    s.trial_consumed,
    s.trial_end_at
FROM public.subscriptions s;

COMMENT ON VIEW public.user_subscription_plan IS 'Lightweight plan snapshot keyed by user_id for client consumption.';

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.user_subscription_plan TO authenticated;

-- Create index if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'stripe_price_index'
    ) THEN
        CREATE INDEX stripe_price_index ON public.subscriptions (stripe_price_id);
    END IF;
END;
$$;
