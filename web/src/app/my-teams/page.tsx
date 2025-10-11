"use client";

import { motion } from "framer-motion";
import { Heart, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/components/AuthProvider";
import { useEffect, useMemo, useState } from "react";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { searchLeagues } from "@/lib/collect";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { searchTeams } from "@/lib/collect";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRef } from "react";

export default function MyTeamsPage() {
  const { user, supabase, loading } = useAuth();
  const [teams, setTeams] = useState<string[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<Array<{ name: string; logo?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("favorite_teams")
        .eq("user_id", user.id)
        .single();
      if (!mounted) return;
      setTeams(data?.favorite_teams ?? []);

      // Load suggestions from RPC if available (ignore errors)
      try {
        const { data: rpc } = await supabase.rpc("list_popular_teams", { limit_count: 25 });
        const names = Array.isArray(rpc) ? rpc.map((r: any) => r.team).filter(Boolean) : [];
        setSuggestions(names);
      } catch {
        setSuggestions([]);
      }
      // load favorite leagues too
      try {
        const { data } = await supabase.from('user_preferences').select('favorite_leagues').eq('user_id', user.id).single();
        setLeagues(data?.favorite_leagues ?? []);
      } catch {
        setLeagues([]);
      }
    })();
    return () => { mounted = false; };
  }, [user, supabase]);

  const filteredSuggestions = useMemo(() => {
    const q = newTeam.trim().toLowerCase();
    const base = suggestions.filter(s => !teams.includes(s));
    if (!q) return base.slice(0, 10);
    return base.filter(s => s.toLowerCase().includes(q)).slice(0, 10);
  }, [newTeam, suggestions, teams]);

  const addTeam = (t: string) => {
    const name = t.trim();
    if (!name) return;
    if (teams.includes(name)) {
      toast.info("Already added");
      return;
    }
    setTeams(prev => [...prev, name]);
    setNewTeam("");
  };

  const followLeague = (ln: string) => {
    const name = ln.trim();
    if (!name) return;
    if (leagues.includes(name)) {
      toast.info('Already following');
      return;
    }
    setLeagues(prev => [...prev, name]);
  };

  const unfollowLeague = (ln: string) => {
    setLeagues(prev => prev.filter(x => x !== ln));
  };

  const removeTeam = (t: string) => {
    setTeams(prev => prev.filter(x => x !== t));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await supabase.from("user_preferences").upsert({ user_id: user.id, favorite_teams: teams, favorite_leagues: leagues });
      toast.success("Saved your favorite teams");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Live search teams via backend API, debounce via input onChange
  const debouncedQuery = useDebouncedValue(newTeam, 250);

  useEffect(() => {
    let alive = true;
    const q = debouncedQuery.trim();
    if (!q) { setResults([]); return; }
    (async () => {
      try {
        setSearching(true);
        const [teamsResp, leaguesResp] = await Promise.allSettled([searchTeams(q), searchLeagues(q)]);
        const teamsArr = (teamsResp.status === 'fulfilled' ? teamsResp.value.data?.teams ?? [] : []) as Array<Record<string, unknown>>;
        const leaguesArr = (leaguesResp.status === 'fulfilled' ? leaguesResp.value.data?.leagues ?? [] : []) as Array<Record<string, unknown>>;
        const mappedTeams = teamsArr.map((t) => ({
          name: String(t["team_name"] ?? t["strTeam"] ?? t["name"] ?? t["team"] ?? ""),
          logo: String(t["team_logo"] ?? t["strTeamBadge"] ?? t["logo"] ?? ""),
          type: 'team'
        }))
        .filter(t => t.name);
        const mappedLeagues = leaguesArr.map((l) => ({
          name: String(l["league_name"] ?? l["name"] ?? l["strLeague"] ?? ""),
          logo: String(l["league_logo"] ?? l["logo"] ?? l["badge"] ?? ""),
          type: 'league'
        })).filter(l => l.name);
        if (!alive) return;
        const combined = [...mappedLeagues.slice(0,6), ...mappedTeams].slice(0, 12);
        setResults(combined.map(r => ({ name: r.name, logo: r.logo })));
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    })();
    return () => { alive = false; };
  }, [debouncedQuery]);

  if (loading) {
    return <div className="container py-8 min-h-[60vh] flex items-center justify-center">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="container py-8 min-h-[60vh] flex items-center justify-center">
        <EmptyState
          type="no-teams"
          title="Sign in to manage your teams"
          description="Create an account or sign in to save your favorite teams and get personalized match recommendations."
          actionLabel="Sign In"
          onAction={() => window.location.href = '/auth/login'}
        />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-start"
      >
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <Heart className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">My Teams</h1>
          </div>
          <p className="text-muted-foreground">
            Manage your favorite teams and get personalized match updates and analysis.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              placeholder="Add a team (e.g. Barcelona)"
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTeam(newTeam); }}
              className="w-80"
            />
            {newTeam && results.length > 0 && (
              <div role="listbox" aria-label="Search results" className="absolute z-10 mt-1 w-full bg-background border rounded shadow">
                {results.map((r, idx) => (
                  <button
                    key={r.name}
                    role="option"
                    aria-selected={activeIndex === idx}
                    className={`w-full flex items-center gap-3 p-2 text-left ${activeIndex === idx ? 'bg-muted' : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseLeave={() => setActiveIndex(-1)}
                    onClick={async () => {
                      // add team or follow league depending on type by checking if logo empty and whether it came from league search
                      addTeam(r.name);
                      // upsert into cache
                      try { await supabase.rpc('upsert_cached_team', { p_provider_id: null, p_name: r.name, p_logo: r.logo ?? '', p_metadata: {} }); } catch {}
                    }}
                  >
                    <Avatar className="size-6">
                      {r.logo ? (
                        <AvatarImage src={r.logo} alt={r.name} />
                      ) : (
                        <AvatarFallback>{r.name.slice(0,2).toUpperCase()}</AvatarFallback>
                      )}
                    </Avatar>
                    <div className="flex-1">
                      <div className="font-medium">{r.name}</div>
                    </div>
                    <div>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); followLeague(r.name); try { supabase.rpc('upsert_cached_league', { p_provider_id: null, p_name: r.name, p_logo: r.logo ?? '', p_metadata: {} }); } catch {} }}>
                        Follow
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button onClick={() => addTeam(newTeam)} className="flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>Add</span>
          </Button>
          <Button variant="secondary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </motion.div>

      {/* Content would go here when authenticated */}
      <Card>
        <CardHeader>
          <CardTitle>Your Favorite Teams</CardTitle>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <EmptyState
              type="no-teams"
              description="You haven&apos;t added any favorite teams yet. Try adding one above to personalize recommendations."
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {teams.map(t => (
                <Badge key={t} variant="secondary" className="px-3 py-1 flex items-center gap-1">
                  <span>{t}</span>
                  <button className="ml-1" aria-label={`Remove ${t}`} onClick={() => removeTeam(t)}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {filteredSuggestions.length > 0 && (
            <div className="mt-6">
              <div className="text-sm text-muted-foreground mb-2">Suggestions</div>
              <div className="flex flex-wrap gap-2">
                {filteredSuggestions.map(s => (
                  <Button key={s} variant="outline" size="sm" onClick={() => addTeam(s)}>{s}</Button>
                ))}
              </div>
            </div>
          )}
          {leagues.length > 0 && (
            <div className="mt-6">
              <div className="text-sm text-muted-foreground mb-2">Followed Leagues</div>
              <div className="flex flex-wrap gap-2">
                {leagues.map(l => (
                  <Badge key={l} variant="secondary" className="px-3 py-1 flex items-center gap-1">
                    <span>{l}</span>
                    <button className="ml-1" aria-label={`Unfollow ${l}`} onClick={() => unfollowLeague(l)}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}