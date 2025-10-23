"use client";

import { Badge } from "@/components/ui/badge";

export function PlanBadge({ plan }: { plan: "free" | "pro" | string | null | undefined }) {
  const normalized = (plan ?? "free").toLowerCase();
  const variant = normalized === "pro" ? "default" : "secondary";
  const label = normalized === "pro" ? "Pro" : "Free";
  return <Badge variant={variant}>{label}</Badge>;
}
