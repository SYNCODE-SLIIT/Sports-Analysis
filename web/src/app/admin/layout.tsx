"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/components/AuthProvider";
import { isAdminEmail } from "@/lib/admin";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const isAdmin = isAdminEmail(user?.email ?? undefined);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/auth/login?next=/admin/overview");
      } else if (!isAdmin) {
        router.replace("/profile");
      }
    }
  }, [isAdmin, loading, router, user]);

  if (loading || !user || !isAdmin) {
    return (
      <div className="container flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing admin experience…
      </div>
    );
  }

  return <>{children}</>;
}
