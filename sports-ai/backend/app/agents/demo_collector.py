# demo_collector.py
# Tiny demo that *uses* collector.py and prints results.
# Safe to delete later; your frontend/backend will import collector.py directly.

import os
from dataclasses import asdict
from collector import SportsDBCollector

def main():
    print(f"Using TheSportsDB key: {os.getenv('THESPORTSDB_KEY', '123')}\n")
    c = SportsDBCollector()

    # 1) Example: list England/Soccer leagues (fallback handles empty search endpoint)
    leagues = c.list_leagues(sport="Soccer", country="England")
    print(f"Leagues in England/Soccer: {len(leagues)} (showing up to 10)")
    for i, L in enumerate(leagues[:10], 1):
        print(f"{i:>2}. {L.name} (id={L.id})")

    if not leagues:
        return

    # 2) Pick the first league → show recent matches
    league = leagues[0]
    matches = c.list_matches_for_league(league_id=league.id, kind="past", limit=5)
    print(f"\nRecent matches in {league.name}: {len(matches)}")
    for i, m in enumerate(matches, 1):
        score = "vs"
        if m.home_score is not None and m.away_score is not None:
            score = f"{m.home_score}-{m.away_score}"
        print(f"{i:>2}. {m.date} | {m.home_team} vs {m.away_team} | {score} (id={m.id})")

    if not matches:
        return

    # 3) Inspect first match fully
    event_id = matches[0].id
    pack = c.get_match(event_id)

    print("\n=== Match Summary (normalized) ===")
    for k, v in asdict(pack.event).items():
        print(f"{k:>12}: {v}")

    print("\n=== Data Flags ===")
    for k, v in pack.flags.items():
        print(f"{k:>12}: {v}")

    print("\n=== Timeline (first 10, normalized) ===")
    if not pack.timeline:
        print("(none)")
    else:
        for t in pack.timeline[:10]:
            # Pretty one-liner per timeline item
            detail = f" — {t.detail}" if t.detail else ""
            print(f"- {t.minute}′ {t.type} — {t.player or ''} ({t.team or ''}){detail}")

if __name__ == "__main__":
    main()