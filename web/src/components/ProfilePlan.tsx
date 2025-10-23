"use client";

import { useMemo } from "react";
import { PlanBadge } from "@/components/UpgradeBadge";
import { usePlanContext } from "@/components/PlanProvider";
import { computePlanPeriods } from "@/lib/subscription-dates";

export function ProfilePlanSummary() {
  const { plan, planInfo } = usePlanContext();
  const { trialEndsAt, renewsAt } = useMemo(() => computePlanPeriods(planInfo), [planInfo]);
  const trialEndsLabel = trialEndsAt
    ? trialEndsAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;
  const renewalLabel = renewsAt
    ? renewsAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="flex items-center gap-1">
      {plan === "pro" ? (
        <div className="flex flex-col text-right">
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <PlanBadge plan={plan} />
            <div className="text-sm text-foreground">Pro access active</div>
          </div>
          {(trialEndsLabel || renewalLabel) && (
            <div className="mt-1 text-xs text-muted-foreground flex items-center justify-end gap-3">
              {trialEndsLabel && <span>Trial ends {trialEndsLabel}</span>}
              {renewalLabel && <span className="whitespace-nowrap">• Renews {renewalLabel}</span>}
            </div>
          )}
        </div>
      ) : (
        <>
          <PlanBadge plan={plan} />
          <div className="text-sm text-muted-foreground">Free plan — upgrade to unlock premium insights</div>
        </>
      )}
    </div>
  );
}
