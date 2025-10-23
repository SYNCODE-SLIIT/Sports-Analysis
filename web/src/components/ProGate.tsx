"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function ProGate({ plan, children, title }: { plan: "free" | "pro" | string; children: ReactNode; title?: string }) {
  if ((plan ?? "free").toLowerCase() === "pro") {
    return <>{children}</>;
  }

  return (
    <Card className="border-dashed">
      {title && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upgrade to Pro to unlock this feature and keep enjoying premium sports insights.
        </p>
        <Button asChild>
          <Link href="/pro">Upgrade to Pro</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
