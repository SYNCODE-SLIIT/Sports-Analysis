"use client";

import { useEffect, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { usePlanContext } from "@/components/PlanProvider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getStripeJs } from "@/lib/stripe/public";

interface UpgradeCtaProps {
  priceId?: string;
  label: string;
  manageWhenPro?: boolean;
}

export function UpgradeCta({ priceId, label, manageWhenPro = false }: UpgradeCtaProps) {
  const router = useRouter();
  const { plan, refreshPlan } = usePlanContext();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resolvedPriceId, setResolvedPriceId] = useState<string>(priceId ?? "");

  useEffect(() => {
    setResolvedPriceId(priceId ?? "");
  }, [priceId]);

  const fetchPriceId = async () => {
    try {
      const response = await fetch("/api/config/stripe", { cache: "no-store" });
      if (!response.ok) {
        return "";
      }
      const data = await response.json();
      const monthlyPriceId = data?.monthlyPriceId ?? "";
      // Only accept server-provided monthlyPriceId if it looks like a Stripe price id.
      if (monthlyPriceId && /^price_/.test(monthlyPriceId)) {
        setResolvedPriceId(monthlyPriceId);
        return monthlyPriceId;
      }
      return "";
    } catch (err) {
      console.error("Failed to load Stripe config", err);
      return "";
    }
  };

  const handleCheckout = () => {
    setError(null);
    startTransition(async () => {
      try {
        let targetPriceId = resolvedPriceId;
        if (!targetPriceId) {
          targetPriceId = await fetchPriceId();
        }

        if (!targetPriceId) {
          setError("Stripe price not configured. Contact support.");
          return;
        }
        setResolvedPriceId(targetPriceId);

        const stripe = await getStripeJs();
        if (!stripe) {
          setError("Stripe publishable key missing. Contact support.");
          return;
        }

        const response = await fetch("/api/stripe/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priceId: targetPriceId }),
        });

        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && typeof data?.loginUrl === "string") {
          window.location.href = data.loginUrl;
          return;
        }

        if (!response.ok) {
          setError(data.error ?? "Failed to start checkout");
          return;
        }

        if (data?.sessionId) {
          const { error: stripeError } = await stripe.redirectToCheckout({ sessionId: data.sessionId });
          if (stripeError) {
            setError(stripeError.message ?? "Stripe redirect failed");
          }
          return;
        }

        if (typeof data?.url === "string" && data.url) {
          window.location.href = data.url;
          return;
        }

        setError("Checkout session missing redirect details. Contact support.");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        setError(message);
      }
    });
  };

  const handlePortal = () => {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/stripe/create-portal", { method: "POST" });
        const data = await response.json().catch(() => ({}));

        if (response.status === 401 && typeof data?.loginUrl === "string") {
          window.location.href = data.loginUrl;
          return;
        }

        if (!response.ok || typeof data?.url !== "string") {
          setError(data.error ?? "Unable to open billing portal");
          return;
        }

        window.location.href = data.url;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        setError(message);
      }
    });
  };

  const handleClick = () => {
    if (plan !== "pro") {
      setOpen(true);
    } else if (manageWhenPro) {
      handlePortal();
    } else {
      router.push("/profile");
    }
  };

  return (
    <>
      <Button className="w-full" size="lg" onClick={handleClick} disabled={pending}>
        {pending
          ? "Redirecting…"
          : plan === "pro"
          ? manageWhenPro
            ? "Manage billing"
            : "You are Pro"
          : label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start your 7-day Pro trial</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Confirm your choice below. We’ll open a secure Stripe checkout summarizing the plan, price and trial end
              date. You can cancel any time before the trial ends.
            </p>
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              <p className="font-medium">Plan selected</p>
              <p className="text-muted-foreground">{label}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col gap-2">
              <Button onClick={handleCheckout} disabled={pending}>
                {pending ? "Opening checkout…" : "Continue to payment"}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Not now
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              After confirming, we’ll refresh your plan automatically. If checkout succeeds but you still see Free, reload
              this page or visit your
              <button className="text-primary underline" onClick={() => refreshPlan?.()}>
                &nbsp;profile
              </button>
              .
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
