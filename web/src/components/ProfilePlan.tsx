"use client";

import { PlanBadge } from "@/components/UpgradeBadge";
import { usePlanContext } from "@/components/PlanProvider";

export function ProfilePlanSummary() {
  const { plan, planInfo } = usePlanContext();
  const nextRenewal = planInfo.current_period_end
    ? new Date(planInfo.current_period_end).toLocaleDateString()
    : null;

  return (
    <div className="flex items-center gap-3">
      <PlanBadge plan={plan} />
      <div className="text-sm text-muted-foreground">
        {plan === "pro" ? (
          <>
            Pro access active
            {nextRenewal ? <span className="ml-2">Renews {nextRenewal}</span> : null}
          </>
        ) : (
          <>Free plan — upgrade to unlock premium insights</>
        )}
      </div>
    </div>
  );
}
