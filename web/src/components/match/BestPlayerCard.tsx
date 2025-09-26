"use client";

import Image from "next/image";

interface BestPlayerCardProps {
  best: { name: string; score?: number } | null;
  teamBadge?: string;
}

export default function BestPlayerCard({ best, teamBadge }: BestPlayerCardProps) {
  if (!best) return null;

  return (
    <div className="rounded-2xl border p-4 mt-4">
      <div className="text-sm font-semibold mb-1">Best Player</div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base">{best.name}</div>
          {typeof best.score === "number" && <div className="text-xs opacity-70">Score: {best.score}</div>}
        </div>
        {teamBadge && (
          <Image src={teamBadge} alt="" width={32} height={32} className="h-8 w-8 rounded object-cover" unoptimized />
        )}
      </div>
    </div>
  );
}
