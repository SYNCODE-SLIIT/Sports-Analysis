"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function UpgradeToProModal({ plan }: { plan: "free" | "pro" | string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if ((plan ?? "free").toLowerCase() === "free") {
      const timer = setTimeout(() => setOpen(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [plan]);

  if ((plan ?? "free").toLowerCase() !== "free") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Try Sports Analysis Pro</DialogTitle>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>Unlock premium analytics, personalized insights, and live win probability with a 7-day free trial.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Maybe later
            </Button>
            <Button asChild>
              <Link href="/pro">Start free trial</Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
