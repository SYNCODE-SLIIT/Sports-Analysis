"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const records = useMemo(() => data?.data ?? [], [data]);

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
    <Card className="neon-card">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-foreground">Subscription control</CardTitle>
          <p className="text-sm text-muted-foreground">
            Review active subscriptions, adjust plan levels, or revoke access instantly.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {records.length ? `${records.length} accounts` : "No subscriptions yet"}
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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border/60 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Stripe status</th>
                  <th className="px-3 py-2">Current period end</th>
                  <th className="px-3 py-2">Stripe IDs</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {records.map((record) => {
                  const planLabel = record.plan === "pro" || record.subscriptionStatus === "pro" ? "Pro" : "Free";
                  const badgeVariant = planLabel === "Pro" ? "default" : "outline";
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
                      <td className="px-3 py-3">
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <div>Customer: {record.stripeCustomerId ?? "—"}</div>
                          <div>Subscription: {record.stripeSubscriptionId ?? "—"}</div>
                          <div>Price: {record.stripePriceId ?? "—"}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{formatIso(record.currentPeriodEnd)}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        <div className="space-y-1">
                          <div>ID: {record.userId}</div>
                          <div>Updated: {formatIso(record.updatedAt)}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actingOn === record.userId}
                            onClick={() => handlePlanChange(record.userId, "free")}
                          >
                            {actingOn === record.userId ? "Updating…" : "Revoke (Free)"}
                          </Button>
                          <Button
                            size="sm"
                            disabled={actingOn === record.userId}
                            onClick={() => handlePlanChange(record.userId, "pro")}
                          >
                            {actingOn === record.userId ? "Updating…" : "Set to Pro"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No subscriptions recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
