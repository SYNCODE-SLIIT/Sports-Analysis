import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ProSuccessPage() {
  return (
    <div className="container mx-auto max-w-2xl py-12 text-center space-y-6">
      <h1 className="text-3xl font-semibold">You're all set!</h1>
      <p className="text-muted-foreground">
        Thanks for upgrading to Sports Analysis Pro. Your premium features are now unlocked. Explore live analytics and
        new insights right away.
      </p>
      <div className="flex justify-center gap-4">
        <Button asChild>
          <Link href="/live">View Live Matches</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/profile">Go to Profile</Link>
        </Button>
      </div>
    </div>
  );
}
