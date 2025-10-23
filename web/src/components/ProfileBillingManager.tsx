"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, Mail, RefreshCcw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanInfo } from "@/hooks/usePlan";
import { computePlanPeriods } from "@/lib/subscription-dates";
import { cn } from "@/lib/utils";

interface ProfileBillingManagerProps {
  plan: "free" | "pro";
  planInfo: PlanInfo;
  onClose: () => void;
  onViewPlans: () => void;
  error?: string | null;
  onCancelSubscription: () => Promise<boolean>;
  cancelPending: boolean;
}

interface BillingSection {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  content: ReactNode;
}

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "neeeleee7@gmail.com";

export function ProfileBillingManager({
  plan,
  planInfo,
  onClose,
  onViewPlans,
  error,
  onCancelSubscription,
  cancelPending,
}: ProfileBillingManagerProps) {
  const [openSection, setOpenSection] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const planLabel = plan === "pro" ? "Sports Analysis Pro" : "Sports Analysis Free";
  const { trialEndsAt, renewsAt } = useMemo(
    () => computePlanPeriods(planInfo),
    [planInfo.plan, planInfo.current_period_end, planInfo.trial_end_at, planInfo.subscription_status]
  );
  const trialEndsLabel = useMemo(() => {
    if (!trialEndsAt) return null;
    return trialEndsAt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [trialEndsAt]);

  const renewalLabel = useMemo(() => {
    if (!renewsAt) return null;
    return renewsAt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [renewsAt]);

  const features = useMemo(() => {
    if (plan === "pro") {
      return [
        "Unlimited live analytics overlays",
        "AI highlight recaps and smart alerts",
        "Priority access to in-development tools",
      ];
    }
    return [
      "Core match insights and basic stats",
      "Follow up to three favourite teams",
      "Email summaries for major fixtures",
    ];
  }, [plan]);

  const sections: BillingSection[] = [
    {
      id: "plan",
      title: "Change subscription plan",
      summary: `Current plan: ${planLabel}`,
      icon: RefreshCcw,
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Switch between plans or adjust renewal settings in the secure billing portal. Any changes apply at the end
            of the current billing cycle.
          </p>
          <div className="rounded-md border border-white/10 bg-background/60 p-3 text-foreground">
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold">{planLabel}</span>
              <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                {trialEndsLabel ? <span>Trial ends {trialEndsLabel}</span> : null}
                {renewalLabel ? <span>Renews {renewalLabel}</span> : null}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {plan === "pro"
                ? "Keep premium access unless you cancel before the renewal date."
                : "Upgrade to Pro to unlock premium analytics and alerts."}
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onViewPlans}>
              Compare plans
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: "cancel",
      title: "Cancel subscription",
      summary: "Stop your Pro subscription from renewing.",
      icon: ShieldOff,
      content: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Cancel online anytime. Your Pro access remains active through the end of the paid period, and you can restart
            later with the same account.
          </p>
          {!confirmingCancel ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setStatusMessage(null);
                setConfirmingCancel(true);
              }}
            >
              Cancel subscription
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive">
              <p className="text-sm">
                Once cancelled, premium insights remain unlocked until the end of your current billing cycle. Afterward
                you switch back to the Free plan automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    const success = await onCancelSubscription();
                    if (success) {
                      setStatusMessage("Subscription cancelled. You're back on the Free plan.");
                      setConfirmingCancel(false);
                    }
                  }}
                  disabled={cancelPending}
                >
                  {cancelPending ? "Cancelling…" : "Confirm cancellation"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={cancelPending}
                >
                  Keep Pro benefits
                </Button>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "email",
      title: "Manage email preferences",
      summary: "Choose how we contact you about billing.",
      icon: Mail,
      content: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Billing receipts are always sent to your account email. For marketing or product updates, reach out and we’ll
            tailor your notifications manually while in-app preferences are built.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Billing email preferences`;
            }}
          >
            Email support
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Manage subscription</h2>
          <p className="text-sm text-muted-foreground">
            Adjust your Sports Analysis plan, cancel when needed, or reach out for billing support.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-background/70">
        {sections.map((section) => {
          const Icon = section.icon;
          const isOpen = openSection === section.id;

          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => setOpenSection((prev) => (prev === section.id ? "" : section.id))}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{section.title}</p>
                    <p className="text-sm text-muted-foreground">{section.summary}</p>
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 text-muted-foreground transition-transform",
                    isOpen ? "rotate-180 text-foreground" : "",
                  )}
                />
              </button>
              {isOpen ? <div className="space-y-3 border-t border-white/10 px-5 py-4">{section.content}</div> : null}
            </div>
          );
        })}
      </div>
      {statusMessage ? <p className="text-sm text-emerald-400">{statusMessage}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
