import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient } from "@/lib/stripe/client";
import type { SupabaseClient } from "@supabase/supabase-js";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function POST() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe secret is not configured" }, { status: 500 });
  }

  const supabaseServer = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Authentication required",
        loginUrl: `${SITE_URL}/auth/login?next=/profile`,
      },
      { status: 401 }
    );
  }

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
  const { data: subscriptionRow } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!subscriptionRow?.stripe_customer_id) {
    return NextResponse.json({ error: "No Stripe customer on file" }, { status: 400 });
  }

  const stripe = getStripeClient();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: subscriptionRow.stripe_customer_id,
    return_url: `${SITE_URL}/profile`,
  });

  if (!portalSession.url) {
    return NextResponse.json({ error: "Failed to create billing portal session" }, { status: 500 });
  }

  return NextResponse.json({ url: portalSession.url });
}
