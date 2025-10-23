import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient } from "@/lib/stripe/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe secret is not configured" }, { status: 500 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let priceId: string | null = null;

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const candidate = body?.priceId ?? body?.price_id;
    if (typeof candidate === "string") {
      priceId = candidate;
    }
  } else {
    const formData = await req.formData();
    const candidate = formData.get("priceId") ?? formData.get("price_id");
    if (typeof candidate === "string") {
      priceId = candidate;
    }
  }

  if (!priceId) {
    return NextResponse.json({ error: "Missing price_id" }, { status: 400 });
  }

  priceId = priceId.trim();

  if (!priceId) {
    return NextResponse.json({ error: "Missing price_id" }, { status: 400 });
  }

  // Basic validation: Stripe price IDs start with `price_`.
  // A numeric value (e.g. `2`) is likely a mistaken price amount rather than a Stripe Price ID.
  if (!/^price_/.test(priceId)) {
    return NextResponse.json(
      {
        error:
          "Invalid price_id. The server expects a Stripe Price ID (starts with 'price_'), not a numeric amount.\n" +
          "Set NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE to a Stripe price ID (e.g. price_12345) in your environment.",
      },
      { status: 400 }
    );
  }

  const supabaseServer = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Authentication required",
        loginUrl: `${SITE_URL}/auth/login?next=/pro`,
      },
      { status: 401 }
    );
  }

  const userId = user.id;
  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseServiceRoleClient();
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Supabase service credentials are not configured" },
      { status: 500 }
    );
  }
  const stripe = getStripeClient();

  const { data: subscriptionRow } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id, plan, stripe_subscription_id, trial_consumed")
    .eq("user_id", userId)
    .maybeSingle();

  let customerId = subscriptionRow?.stripe_customer_id ?? undefined;
  const includeTrial =
    (subscriptionRow?.plan ?? "free") !== "pro" &&
    !subscriptionRow?.stripe_subscription_id &&
    !subscriptionRow?.trial_consumed;

  if (!customerId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();

    const customer = await stripe.customers.create({
      email: profile?.email ?? undefined,
      name: profile?.full_name ?? undefined,
      metadata: { user_id: userId },
    });

    customerId = customer.id;

    await supabase
      .from("subscriptions")
      .update({ stripe_customer_id: customer.id })
      .eq("user_id", userId);
  }

  const stripePriceId = priceId;
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: { user_id: userId },
  };

  if (includeTrial) {
    subscriptionData.trial_period_days = 7;
  }

  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      // Include the Checkout Session id so we can retrieve subscription details
      // server-side without relying on webhooks.
      success_url: `${SITE_URL}/api/stripe/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/pro`,
      subscription_data: subscriptionData,
      metadata: { user_id: userId },
    });
  } catch (err) {
    // If Stripe returns a useful message (e.g. invalid price), forward it as JSON.
    const stripeError = err as { message?: string; statusCode?: number } | null;
    const message = stripeError?.message ?? "Failed to create checkout session";
    const status = typeof stripeError?.statusCode === "number" ? stripeError.statusCode : 500;
    return NextResponse.json({ error: message }, { status });
  }

  if (!checkoutSession.url) {
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }

  // Helpful debug log: include the session id and whether a publishable key is configured.
  try {
    // Avoid logging secrets. Log only the session id, presence of NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    // and the hostname of the checkout URL (helps identify whether redirect points to stripe.com).
    // This will help debug client-side Stripe errors like "apiKey is not set" without exposing keys.
    console.log("Created checkout session", {
      id: checkoutSession.id,
      hasPublishableKey: Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
      host: (() => {
        try {
          return new URL(checkoutSession.url || "").hostname;
        } catch {
          return null;
        }
      })(),
      status: checkoutSession.status,
      mode: checkoutSession.mode,
      locale: checkoutSession.locale ?? null,
      payment_status: checkoutSession.payment_status,
      subscription: checkoutSession.subscription ?? null,
    });
  } catch {
    /* noop */
  }

  return NextResponse.json({
    sessionId: checkoutSession.id,
    url: checkoutSession.url,
    sessionStatus: checkoutSession.status,
  });
}
