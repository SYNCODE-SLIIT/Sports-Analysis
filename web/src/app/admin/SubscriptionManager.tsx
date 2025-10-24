"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type SubscriptionRecord = {
  userId: string;
  plan: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  stripePriceId: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  fullName: string | null;
  email: string | null;
  updatedAt: string | null;
};

type ApiResponse = {
  data?: SubscriptionRecord[];
  error?: string;
};

const PLAN_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pro", label: "Pro" },
  { value: "free", label: "Free" },
] as const;

const fetcher = async (url: string): Promise<ApiResponse> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error ?? "Failed to load subscriptions");
  }
  return response.json();
};

const formatIso = (iso: string | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export function SubscriptionManager() {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse>("/api/admin/subscriptions", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [planFilter, setPlanFilter] = useState<"all" | "pro" | "free">("all");

  const records = useMemo(() => data?.data ?? [], [data]);
  const filteredRecords = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch =
        !normalizedSearch ||
        (record.fullName ?? "").toLowerCase().includes(normalizedSearch) ||
        (record.email ?? "").toLowerCase().includes(normalizedSearch);

      if (!matchesSearch) {
        return false;
      }

      if (planFilter === "all") {
        return true;
      }

      const isPro = record.plan === "pro" || record.subscriptionStatus === "pro";
      const normalizedPlan = isPro ? "pro" : "free";

      return normalizedPlan === planFilter;
    });
  }, [planFilter, records, searchTerm]);

  const hasActiveFilters = planFilter !== "all" || searchTerm.trim().length > 0;
  const subscriptionCountLabel = !records.length
    ? "No subscriptions yet"
    : filteredRecords.length === records.length
      ? `${records.length} accounts`
      : `${filteredRecords.length} of ${records.length} accounts`;

  const handlePlanChange = async (userId: string, plan: "pro" | "free") => {
    setActingOn(userId);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan, cancelStripe: plan === "free" }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update subscription");
      }
      await mutate();
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : String(updateError);
      setActionError(message);
    } finally {
      setActingOn(null);
    }
  };

  return (
    <Card className="surface-card">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1 lg:max-w-xl">
          <CardTitle className="text-foreground">Subscription control</CardTitle>
          <p className="text-sm text-muted-foreground">
            Review active subscriptions, adjust plan levels, or revoke access instantly.
          </p>
          <div className="text-xs text-muted-foreground">{subscriptionCountLabel}</div>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
          <div className="flex w-full flex-col gap-1 sm:max-w-xs">
            <Label htmlFor="admin-subscription-search" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Search
            </Label>
            <Input
              id="admin-subscription-search"
              placeholder="Name or email"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="bg-background/80"
            />
          </div>
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan</span>
            <div className="flex flex-wrap items-center gap-2">
              {PLAN_FILTER_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={planFilter === option.value ? "default" : "outline"}
                  onClick={() => setPlanFilter(option.value)}
                  aria-pressed={planFilter === option.value}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error.message}
          </div>
        )}
        {actionError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {actionError}
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, index) => (
              <Skeleton key={`subscription-skeleton-${index}`} className="h-16 w-full" />
            ))}
          </div>
        ) : records.length ? (
          filteredRecords.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border/60 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Current period end</th>
                    <th className="px-3 py-2">Stripe IDs</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredRecords.map((record) => {
                    const isPro = record.plan === "pro" || record.subscriptionStatus === "pro";
                    const planLabel = isPro ? "Pro" : "Free";
                    const badgeVariant = isPro ? "default" : "outline";
                    return (
                      <tr key={record.userId} className="align-top">
                        <td className="px-3 py-3">
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{record.fullName ?? "Unknown user"}</p>
                            <p className="text-xs text-muted-foreground">{record.email ?? "No email"}</p>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={badgeVariant}>{planLabel}</Badge>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{formatIso(record.currentPeriodEnd)}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          <div className="space-y-1">
                            <div>
                              <span className="font-medium">Customer:</span>{" "}
                              <span className="font-mono">{record.stripeCustomerId ?? "—"}</span>
                            </div>
                            <div>
                              <span className="font-medium">Subscription:</span>{" "}
                              <span className="font-mono">{record.stripeSubscriptionId ?? "—"}</span>
                            </div>
                            <div>
                              <span className="font-medium">Price:</span>{" "}
                              <span className="font-mono">{record.stripePriceId ?? "—"}</span>
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground">Updated: {formatIso(record.updatedAt)}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex justify-end">
                            {isPro ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={actingOn === record.userId}
                                onClick={() => handlePlanChange(record.userId, "free")}
                                aria-label={`Revoke pro access for ${record.email ?? record.userId}`}
                              >
                                {actingOn === record.userId ? "Updating…" : "Revoke"}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                disabled={actingOn === record.userId}
                                onClick={() => handlePlanChange(record.userId, "pro")}
                                aria-label={`Set ${record.email ?? record.userId} to Pro`}
                              >
                                {actingOn === record.userId ? "Updating…" : "Set to Pro"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters
                ? "No subscriptions match the current search or plan filters."
                : "No subscriptions recorded yet."}
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">No subscriptions recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
