import type Stripe from "stripe";

function toIso(unixTimestamp: number | null | undefined): string | null {
  if (!unixTimestamp) return null;
  const date = new Date(unixTimestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getCurrentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const fallback = subscription.billing_cycle_anchor ?? null;
  return toIso(subscription.current_period_end ?? fallback);
}

export function getTrialEnd(subscription: Stripe.Subscription): string | null {
  return toIso(subscription.trial_end ?? null);
}
