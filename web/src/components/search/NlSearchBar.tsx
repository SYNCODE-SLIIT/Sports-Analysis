"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NlSearchBarProps {
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

export function NlSearchBar({
  className,
  inputClassName,
  autoFocus = false,
  onSubmit,
}: NlSearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = params?.get("q") ?? "";
    setValue(q);
  }, [params]);

  const handleSubmit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const query = value.trim();
      if (!query) return;
      setSubmitting(true);
      const searchParams = new URLSearchParams();
      searchParams.set("q", query);
      const limit = params?.get("limit");
      if (limit) searchParams.set("limit", limit);
      router.push(`/search?${searchParams.toString()}`);
      if (pathname === "/search") {
        router.refresh();
      }
      onSubmit?.();
      // Delay clearing the submitting state until the next tick to avoid flashing
      setTimeout(() => setSubmitting(false), 150);
    },
    [value, router, pathname, params, onSubmit],
  );

  return (
    <form
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:backdrop-blur-md",
        className,
      )}
      onSubmit={handleSubmit}
      role="search"
    >
      <Search className="h-4 w-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search matches"
        className={cn(
          "h-7 border-none bg-transparent px-0 text-sm focus-visible:ring-0",
          inputClassName,
        )}
        autoFocus={autoFocus}
        aria-label="Search matches, teams, leagues"
      />
      <Button
        type="submit"
        size="sm"
        className="h-7 rounded-full px-3 text-xs"
        disabled={isSubmitting || value.trim().length === 0}
      >
        {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
      </Button>
    </form>
  );
}
