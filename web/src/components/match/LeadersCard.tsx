"use client";

interface LeadersCardProps {
  leaders: {
    home: { goals: Array<{ name: string; v: number | string }>; assists: Array<{ name: string; v: number | string }>; cards: Array<{ name: string; v: number | string }> };
    away: { goals: Array<{ name: string; v: number | string }>; assists: Array<{ name: string; v: number | string }>; cards: Array<{ name: string; v: number | string }> };
  } | null;
}

export default function LeadersCard({ leaders }: LeadersCardProps) {
  if (!leaders) return null;

  const Row = ({ title, home, away }: { title: string; home: Array<{ name: string; v: number | string }>; away: Array<{ name: string; v: number | string }> }) => (
    <div className="flex justify-between py-3 border-b last:border-b-0">
      <div className="w-28 text-center text-xs bg-gray-100 rounded px-2 py-1">{title}</div>
      <div className="flex-1 px-4 text-sm">
        {home.length ? home.map(x => `${x.name} ${x.v}`).join(", ") : "—"}
      </div>
      <div className="flex-1 px-4 text-sm text-right">
        {away.length ? away.map(x => `${x.name} ${x.v}`).join(", ") : "—"}
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl border p-4 mt-4">
      <div className="text-sm font-semibold mb-1">Game leaders</div>
      <Row title="GOALS" home={leaders.home.goals} away={leaders.away.goals} />
      <Row title="ASSISTS" home={leaders.home.assists} away={leaders.away.assists} />
      <Row title="CARDS" home={leaders.home.cards} away={leaders.away.cards} />
    </div>
  );
}
