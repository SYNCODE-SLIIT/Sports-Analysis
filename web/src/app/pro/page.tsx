import { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProPlanCompare } from "../../components/pro/ProPlanCompare";

export const metadata: Metadata = {
  title: "Upgrade to Pro",
  description: "Unlock premium sports analysis features with a Pro subscription.",
};

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "per month",
    description: "For casual fans getting started.",
    features: [
      "Core stats and live scores",
  "Limited highlights and win-probability",
      "Follow up to 3 teams",
      "Community Q&A access",
    ],
    action: {
      type: "info" as const,
      label: "Included by default",
    },
  },
  {
    id: "pro-monthly",
    name: "Pro",
    badge: "Best value",
    price: "$19",
    cadence: "per month",
    description: "Unlock everything with a 7-day free trial, activated from your profile.",
    features: [
      "Unlimited highlights & AI insights",
      "Advanced live analytics and betting lines",
      "Unlimited favorites & personalized alerts",
      "Export data and custom dashboards",
    ],
    action: {
      type: "link" as const,
      label: "Start trial from profile",
      href: "/profile",
    },
  },
];

export default function ProPage() {
  return (
    <div className="container mx-auto max-w-5xl py-12 space-y-12">
      <header className="text-center space-y-3">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Unlock advanced features
        </span>
        <h1 className="text-4xl font-bold tracking-tight">Choose the plan that fits your club</h1>
        <p className="text-muted-foreground text-lg">
          Compare Free and Pro tiers side-by-side. Upgrade in seconds with a secure checkout powered by Stripe.
        </p>
      </header>

      <ProPlanCompare plans={plans} />

      <section className="grid gap-6 md:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.id} className={plan.id.includes("pro") ? "border-primary/60 shadow-lg" : ""}>
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl font-semibold">{plan.name}</CardTitle>
                {plan.badge && (
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    {plan.badge}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-sm">{plan.description}</p>
              <div className="pt-2">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="ml-2 text-sm text-muted-foreground">{plan.cadence}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <ul className="space-y-2 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              {plan.action?.type === "link" ? (
                <Button asChild size="lg">
                  <Link href={plan.action.href}>{plan.action.label}</Link>
                </Button>
              ) : (
                <Button variant="outline" size="lg" disabled>
                  {plan.action?.label ?? "Included"}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="rounded-2xl bg-muted/40 p-8">
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold">What's included in the Pro trial?</h2>
          <p className="text-muted-foreground">
            Take the full Sports Analysis suite for a spin. Start the 7-day trial from your profile to unlock premium
            analytics with no upfront charge. Cancel online anytime before your trial ends to avoid billing.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Unlimited highlights, AI insights, and detailed match breakdowns.</li>
            <li>• Personalized alerts and team tracking with no limits.</li>
            <li>• Manage billing or cancel anytime from the profile portal.</li>
          </ul>
          <Button asChild className="mt-4">
            <Link href="/profile">Open profile to start trial</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
