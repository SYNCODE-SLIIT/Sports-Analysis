import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe/client";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import type Stripe from "stripe";

export async function POST(req: NextRequest) {
  const buf = await req.arrayBuffer();
  const sig = req.headers.get('stripe-signature') || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!process.env.STRIPE_SECRET_KEY || !webhookSecret) {
    console.error('Stripe secret or webhook secret missing');
    return new NextResponse('Webhook not configured', { status: 500 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(Buffer.from(buf), sig, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Webhook signature verification failed:', message);
    return new NextResponse('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        // Expect metadata.user_id to be the Supabase auth user id
        const userId = subscription.metadata?.user_id || null;
        const customerId = subscription.customer as string | undefined;
        const priceId = subscription.items?.data?.[0]?.price?.id || null;
        const status = subscription.status || null;
        const isPro = status === 'active' || status === 'trialing' || status === 'past_due';
        const normalizedStatus = isPro ? 'pro' : 'free';
        const subscriptionResource = subscription as Stripe.Subscription & {
          current_period_end?: number | null;
        };

        const periodEndUnix =
          subscriptionResource.current_period_end ??
          subscription.trial_end ??
          subscription.billing_cycle_anchor ??
          null;

        const currentPeriodEnd =
          typeof periodEndUnix === 'number'
            ? new Date(periodEndUnix * 1000).toISOString()
            : null;

        if (!userId) {
          console.warn('Subscription event missing metadata.user_id; skipping upsert');
          break;
        }

        // Upsert into public.subscriptions using the service role key
        const supabase = getSupabaseServiceRoleClient();
        const { error } = await supabase
          .from('subscriptions')
          .upsert({
            user_id: userId,
            plan: normalizedStatus === 'pro' ? 'pro' : 'free',
            stripe_customer_id: customerId || null,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId,
            subscription_status: normalizedStatus,
            current_period_end: currentPeriodEnd,
          }, { onConflict: 'user_id' });

        if (error) {
          console.error('Supabase upsert error:', error);
          return new NextResponse('DB error', { status: 500 });
        }

        break;
      }

      default:
    // Ignore other events or handle additional ones as needed
    console.log('Unhandled event type', event.type);
    }

    return new NextResponse('OK', { status: 200 });
  } catch (err) {
    console.error('Processing error', err);
    return new NextResponse('Server error', { status: 500 });
  }
}
