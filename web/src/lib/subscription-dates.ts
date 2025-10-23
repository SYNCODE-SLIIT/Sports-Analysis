import type { PlanInfo } from "@/hooks/usePlan";

const BILLING_INTERVAL_MONTHS = 1;

export type PlanPeriodSnapshot = {
  trialEndsAt: Date | null;
  renewsAt: Date | null;
};

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function addMonthsPreservingDay(date: Date, months: number): Date {
  const result = cloneDate(date);
  const originalUtcDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const daysInTargetMonth = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalUtcDay, daysInTargetMonth));
  return result;
}

export function computePlanPeriods(planInfo: PlanInfo, referenceDate: Date = new Date()): PlanPeriodSnapshot {
  const trialEndFromColumn = planInfo.trial_end_at ? new Date(planInfo.trial_end_at) : null;
  const trialEndColumnValid =
    trialEndFromColumn && !Number.isNaN(trialEndFromColumn.getTime()) && trialEndFromColumn.getTime() >= referenceDate.getTime();

  const fallbackTrialEnd = planInfo.subscription_status === "trialing" && planInfo.current_period_end
    ? new Date(planInfo.current_period_end)
    : null;

  const trialEndCandidate = trialEndColumnValid ? trialEndFromColumn : fallbackTrialEnd;
  const trialEndValid =
    trialEndCandidate && !Number.isNaN(trialEndCandidate.getTime()) && trialEndCandidate.getTime() >= referenceDate.getTime();

  if (trialEndValid) {
    const trialEndsAt = cloneDate(trialEndCandidate!);
    const renewsAt = addMonthsPreservingDay(trialEndsAt, BILLING_INTERVAL_MONTHS);
    return { trialEndsAt, renewsAt };
  }

  if (!planInfo.current_period_end) {
    return { trialEndsAt: null, renewsAt: null };
  }

  const renewalDate = new Date(planInfo.current_period_end);
  if (Number.isNaN(renewalDate.getTime())) {
    return { trialEndsAt: null, renewsAt: null };
  }

  return { trialEndsAt: null, renewsAt: cloneDate(renewalDate) };
}
