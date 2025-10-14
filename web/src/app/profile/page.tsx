"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { User, Settings, Trophy, Clock, Heart, ThumbsUp, Bookmark, Share2, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/components/AuthProvider";
import { useRecommendations } from "@/hooks/useRecommendations";
import { toast } from "sonner";

export default function ProfilePage() {
  const { user, supabase, loading, prefsVersion } = useAuth();
  const recs = useRecommendations();

  const [profile, setProfile] = useState<{ full_name?: string | null; avatar_url?: string | null } | null>(null);
  const [preferences, setPreferences] = useState<{ favorite_teams?: string[]; favorite_leagues?: string[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMatchesCount, setSavedMatchesCount] = useState<number | null>(null);
  const [sendingFeedbackId, setSendingFeedbackId] = useState<string | null>(null);
  const [localLiked, setLocalLiked] = useState<Record<string, boolean>>({});
  const [localSaved, setLocalSaved] = useState<Record<string, boolean>>({});
  const hasPrefs = (preferences?.favorite_teams?.length || preferences?.favorite_leagues?.length) ? true : false;

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      const { data: p } = await supabase.from("profiles").select("full_name, avatar_url").eq("id", user.id).single();
      const { data: prefs } = await supabase.from("user_preferences").select("favorite_teams, favorite_leagues").eq("user_id", user.id).single();
      if (!mounted) return;
      setProfile(p ?? { full_name: user.user_metadata?.full_name ?? null, avatar_url: user.user_metadata?.avatar_url ?? null });
      setPreferences(prefs ?? { favorite_teams: [], favorite_leagues: [] });
      // fetch saved matches count
      try {
        const { count, error } = await supabase.from('user_interactions').select('item_id', { count: 'exact', head: false }).eq('user_id', user.id).eq('event', 'save');
        if (!error && mounted) {
          setSavedMatchesCount(typeof count === 'number' ? count : 0);
        }
      } catch (e) {
        if (mounted) setSavedMatchesCount(0);
      }
      // initialize local liked/saved states for recommendations
      try {
        const { data: interactions } = await supabase.from('user_interactions').select('item_id, event').eq('user_id', user.id);
        if (!mounted) return;
        const likedMap: Record<string, boolean> = {};
        const savedMap: Record<string, boolean> = {};
        (interactions ?? []).forEach((r: any) => {
          if (r.event === 'like') likedMap[String(r.item_id)] = true;
          if (r.event === 'save') savedMap[String(r.item_id)] = true;
        });
        setLocalLiked(likedMap);
        setLocalSaved(savedMap);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [user, supabase, prefsVersion]);

  // When preferences version changes, refresh recommendations so they reflect updated favorites
  useEffect(() => {
    if (!user) return;
    try {
      recs.refetch?.();
    } catch {}
  }, [prefsVersion]);

  const handleSave = async () => {
    if (!user || !preferences) return;
    setSaving(true);
    try {
      await supabase.from("profiles").upsert({ id: user.id, full_name: profile?.full_name, avatar_url: profile?.avatar_url });
      await supabase.from("user_preferences").upsert({ user_id: user.id, favorite_teams: preferences.favorite_teams ?? [], favorite_leagues: preferences.favorite_leagues ?? [] });
      toast.success("Profile saved");
      setEditing(false);
      recs.refetch();
    } catch (err) {
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const sendInteraction = async (itemId: string, event: "like" | "save" | "dismiss" | "click" | "view" | "share") => {
    if (!user) return;
    setSendingFeedbackId(itemId);
    try {
      await supabase.from("user_interactions").insert({ user_id: user.id, item_id: itemId, event });
      // Refresh recommendations after impactful feedback
      if (event === "dismiss" || event === "like" || event === "save") {
        // slight debounce to let server compute scores
        setTimeout(() => { void recs.refetch?.(); }, 200);
      }
    } finally {
      setSendingFeedbackId(null);
    }
  };

  const toggleLocalLike = (itemId: string) => {
    setLocalLiked(prev => ({ ...prev, [itemId]: !prev[itemId] }));
    void sendInteraction(itemId, localLiked[itemId] ? 'view' : 'like');
  };

  const toggleLocalSave = (itemId: string) => {
    const willSave = !localSaved[itemId];
    setLocalSaved(prev => ({ ...prev, [itemId]: willSave }));
    if (willSave) {
      void sendInteraction(itemId, 'save');
    } else {
      // remove existing save interaction(s)
      void (async () => {
        try {
          // find the interaction's item id already present in table (we only have itemId here) and delete save rows
          await supabase.from('user_interactions').delete().match({ user_id: user?.id, item_id: itemId, event: 'save' });
        } catch {}
      })();
    }
  };

  const shareRecommendation = async (itemId: string, item: any) => {
    const title = item?.title || 'Sports Analysis';
    const url = typeof window !== 'undefined' ? window.location.origin : '';
    const link = `${url}/`;
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.share) {
        try {
          await nav.share({ title, text: 'Check this out', url: link });
          await sendInteraction(itemId, 'share');
          toast.success('Shared');
          return;
        } catch (err: any) {
          if (err && err.name === 'AbortError') return;
        }
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        await sendInteraction(itemId, 'share');
        toast.success('Link copied to clipboard');
      }
    } catch {}
  };

  if (loading) return <div className="container py-16">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <EmptyState
          type="no-teams"
          title="Login Required"
          description="Please login to view your profile and track your predictions"
          actionLabel="Go to Login"
          onAction={() => window.location.href = "/auth/login"}
        />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                <User className="w-8 h-8 text-primary-foreground" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold">{profile?.full_name ?? user.email}</h1>
                <p className="text-muted-foreground">{user.email}</p>
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>Member since {new Date(user.created_at ?? Date.now()).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="md:ml-auto">
                {editing ? (
                  <div className="flex space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                    <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Settings className="w-4 h-4 mr-2" />
                    Edit Profile
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }}>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Teams Followed</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{preferences?.favorite_teams ? preferences.favorite_teams.length : '—'}</div>
              <div className="text-sm text-muted-foreground">{(preferences?.favorite_teams ?? []).slice(0, 3).join(', ') || 'No teams yet'}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6 }}>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Leagues Followed</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{preferences?.favorite_leagues ? preferences.favorite_leagues.length : '—'}</div>
              <div className="text-sm text-muted-foreground">{(preferences?.favorite_leagues ?? []).slice(0, 3).join(', ') || 'No leagues yet'}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6 }}>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Saved Matches</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{savedMatchesCount === null ? '—' : savedMatchesCount}</div>
              <div className="text-sm text-muted-foreground">Matches you saved for later</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.6 }}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"><Heart className="w-5 h-5 text-red-500" /><span>Favorite Teams</span></CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <div className="space-y-4">
                <label className="block text-sm font-medium">Favorite teams (comma separated)</label>
                <input value={(preferences?.favorite_teams ?? []).join(", ")} onChange={(e) => setPreferences(prev => ({ ...(prev ?? {}), favorite_teams: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} className="w-full input" />
                <label className="block text-sm font-medium">Favorite leagues (comma separated)</label>
                <input value={(preferences?.favorite_leagues ?? []).join(", ")} onChange={(e) => setPreferences(prev => ({ ...(prev ?? {}), favorite_leagues: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} className="w-full input" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(preferences?.favorite_teams ?? []).map((team) => (
                  <Badge key={team} variant="secondary" className="px-3 py-1">{team}</Badge>
                ))}
                {(preferences?.favorite_leagues ?? []).map((l) => (
                  <Badge key={l} variant="secondary" className="px-3 py-1">{l}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <Trophy className="w-5 h-5" />
              <span>{hasPrefs ? 'Recommended for you' : 'Popular right now'}</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="transition-transform active:scale-95" onClick={() => recs.refetch?.()} disabled={!!recs.isLoading}>
                <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recs.isLoading ? (
              <div>Loading recommendations…</div>
            ) : recs.data?.items.length ? (
              <div className="space-y-3">
                {recs.data.items.map((r) => (
                  <div key={r.item_id} className="p-3 border rounded flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{(r.item as any)?.title ?? r.item_id}</div>
                      <div className="text-sm text-muted-foreground">{r.reason ?? `Score: ${Math.round(r.score)}`}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant={localLiked[r.item_id] ? 'default' : 'ghost'} size="icon" title="Like" className="transition-transform active:scale-95" onClick={() => toggleLocalLike(r.item_id)} disabled={sendingFeedbackId === r.item_id}>
                        <ThumbsUp className="w-4 h-4" />
                      </Button>
                      <Button variant={localSaved[r.item_id] ? 'default' : 'ghost'} size="icon" title="Save" className="transition-transform active:scale-95" onClick={() => toggleLocalSave(r.item_id)} disabled={sendingFeedbackId === r.item_id}>
                        <Bookmark className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Share" className="transition-transform active:scale-95" onClick={() => shareRecommendation(r.item_id, r.item)} disabled={sendingFeedbackId === r.item_id}>
                        <Share2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No recommendations yet — pick favorite teams to improve suggestions.</div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}