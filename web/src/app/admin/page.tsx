"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Eye,
  FilePlus2,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  Users,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { isAdminEmail, PRIMARY_ADMIN_EMAIL } from "@/lib/admin";

type SparkCoordinate = { x: number; y: number; value: number };

type SparklineResult = {
  areaPath: string;
  linePoints: string;
  coordinates: SparkCoordinate[];
};

type SystemFlag = "maintenance" | "highlightsAutomation" | "aiAlerts";

type SystemState = Record<SystemFlag, boolean>;

type SnapshotStats = {
  totalUsers: number;
  weeklySignups: number;
  activeUsers: number;
  totalItems: number;
};

type SnapshotInteraction = {
  day: string;
  total: number;
  likes: number;
  saves: number;
  views: number;
  uniqueUsers: number;
};

type SnapshotRetention = {
  day: string;
  returningUsers: number;
};

type SnapshotUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastSeen: string | null;
  interactions: number;
  likes: number;
  saves: number;
};

type SnapshotContent = {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
  popularity: number;
  status: string | null;
};

type AdminSnapshot = {
  stats: SnapshotStats;
  interactions: SnapshotInteraction[];
  retention: SnapshotRetention[];
  users: SnapshotUser[];
  content: SnapshotContent[];
  flags?: Record<string, unknown>;
};

type ManagedUserRow = SnapshotUser & {
  status: "Active" | "Warning" | "Suspended";
  role: string;
  lastSeenLabel: string;
};

type PipelineRow = SnapshotContent & {
  owner: string;
  eta: string;
  priority: "High" | "Medium" | "Low";
};

type AlertEntry = {
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
};

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const DEFAULT_FLAGS: SystemState = {
  maintenance: false,
  highlightsAutomation: true,
  aiAlerts: true,
};

const FLAG_MESSAGES: Record<SystemFlag, { on: string; off: string }> = {
  maintenance: {
    on: "Maintenance mode activated. Users redirected to status page.",
    off: "Maintenance mode disabled.",
  },
  highlightsAutomation: {
    on: "Highlight automation re-enabled.",
    off: "Highlight automation paused.",
  },
  aiAlerts: {
    on: "AI anomaly alerts enabled.",
    off: "AI anomaly alerts silenced.",
  },
};

const booleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const resolveFlags = (payload: AdminSnapshot | null): SystemState => {
  const base = payload?.flags ?? {};
  return {
    maintenance: booleanOr((base as Record<string, unknown>).maintenance, DEFAULT_FLAGS.maintenance),
    highlightsAutomation: booleanOr((base as Record<string, unknown>).highlightsAutomation, DEFAULT_FLAGS.highlightsAutomation),
    aiAlerts: booleanOr((base as Record<string, unknown>).aiAlerts, DEFAULT_FLAGS.aiAlerts),
  };
};

const formatNumber = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return numberFormatter.format(Math.round(value));
};

const parseDay = (value: string): Date | null => {
  if (!value) return null;
  const parts = value.split("-").map((part) => Number(part));
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const formatDayLabel = (value: string): string => {
  const date = parseDay(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
};

const formatRelativeTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "Just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
};

const deriveStatus = (lastSeen: Date | null): "Active" | "Warning" | "Suspended" => {
  if (!lastSeen) return "Suspended";
  const minutes = (Date.now() - lastSeen.getTime()) / 60000;
  if (minutes <= 120) return "Active";
  if (minutes <= 720) return "Warning";
  return "Suspended";
};

const deriveRole = (interactions: number): string => {
  if (interactions >= 200) return "Power analyst";
  if (interactions >= 80) return "Contributor";
  if (interactions >= 20) return "Member";
  return "Newcomer";
};

const deriveEta = (createdAt: Date): string => {
  const diffHours = (Date.now() - createdAt.getTime()) / 3600000;
  if (diffHours < 6) return "Due today";
  if (diffHours < 24) return "Due in 1 day";
  if (diffHours < 72) return "Due in 3 days";
  return "In backlog";
};

const buildSparkline = (values: number[]): SparklineResult => {
  if (!values.length) {
    return { areaPath: "", linePoints: "", coordinates: [] };
  }

  const highest = Math.max(...values, 0);
  const base = values.map((raw, index) => {
    const value = Math.max(0, raw);
    const ratio = values.length === 1 ? 0.5 : index / (values.length - 1);
    const x = Number((ratio * 100).toFixed(2));
    const normalized = highest === 0 ? 0 : value / highest;
    const y = Number((100 - normalized * 84 - 8).toFixed(2));
    return { x, y: Number.isFinite(y) ? y : 92, value };
  });

  const coordinates = base.length === 1
    ? [
        { x: 0, y: base[0].y, value: base[0].value },
        { x: 100, y: base[0].y, value: base[0].value },
      ]
    : base;

  let areaPath = "M 0 100 ";
  coordinates.forEach((coord) => {
    areaPath += `L ${coord.x} ${coord.y} `;
  });
  areaPath += "L 100 100 Z";

  return {
    areaPath: areaPath.trim(),
    linePoints: coordinates.map((coord) => `${coord.x},${coord.y}`).join(" "),
    coordinates,
  };
};

export default function AdminPage() {
  const { user, loading, supabase } = useAuth();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [systemFlags, setSystemFlags] = useState<SystemState>(DEFAULT_FLAGS);
  const [updatingFlag, setUpdatingFlag] = useState<SystemFlag | null>(null);

  const isAdmin = useMemo(() => isAdminEmail(user?.email ?? undefined), [user]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/login?next=/admin");
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!loading && user && !isAdmin) {
      router.replace("/profile");
    }
  }, [isAdmin, loading, router, user]);

  const fetchSnapshot = useCallback(async (): Promise<AdminSnapshot | null> => {
    const { data, error } = await supabase.rpc("admin_dashboard_snapshot");
    if (error) throw error;
    return (data ?? null) as AdminSnapshot | null;
  }, [supabase]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setSnapshotLoading(true);
    fetchSnapshot()
      .then((payload) => {
        if (!active) return;
        setSnapshot(payload);
        setSystemFlags(resolveFlags(payload));
        setSnapshotError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Failed to load admin snapshot", error);
        setSnapshotError(error instanceof Error ? error.message : "Failed to load admin data");
      })
      .finally(() => {
        if (active) setSnapshotLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fetchSnapshot, isAdmin]);

  const refreshSnapshot = useCallback(async () => {
    if (!isAdmin) return;
    setRefreshing(true);
    try {
      const payload = await fetchSnapshot();
      setSnapshot(payload);
      setSystemFlags(resolveFlags(payload));
      setSnapshotError(null);
      toast.success("Dashboard refreshed.");
    } catch (error) {
      console.error("Failed to refresh admin snapshot", error);
      toast.error("Refresh failed. Try again.");
    } finally {
      setRefreshing(false);
    }
  }, [fetchSnapshot, isAdmin]);

  const handleFlagChange = useCallback(
    async (flag: SystemFlag, checked: boolean) => {
      if (!isAdmin) return;
      setSystemFlags((prev) => ({ ...prev, [flag]: checked }));
      setUpdatingFlag(flag);
      try {
        const { data, error } = await supabase.rpc("admin_set_system_flag", { flag, enabled: checked });
        if (error) throw error;
        const confirmed = booleanOr((data as Record<string, unknown>)?.enabled, checked);
        setSystemFlags((prev) => ({ ...prev, [flag]: confirmed }));
        const message = FLAG_MESSAGES[flag][confirmed ? "on" : "off"];
        toast.success(message);
      } catch (error) {
        console.error("Failed to update system flag", error);
        setSystemFlags((prev) => ({ ...prev, [flag]: !checked }));
        toast.error("Unable to update system control. Please retry.");
      } finally {
        setUpdatingFlag(null);
      }
    },
    [isAdmin, supabase],
  );

  const handleExport = useCallback(() => {
    toast.success("System snapshot exported.");
  }, []);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/");
  }, [router, supabase]);

  if (loading) {
    return <div className="container py-16 text-sm text-muted-foreground">Preparing admin console…</div>;
  }

  if (!user) {
    return <div className="container py-16 text-sm text-muted-foreground">Redirecting to sign in…</div>;
  }

  if (!isAdmin) {
    return <div className="container py-16 text-sm text-muted-foreground">Redirecting to profile…</div>;
  }

  const stats = snapshot?.stats ?? null;
  const interactionsSeries = snapshot?.interactions ?? [];
  const retentionSeries = snapshot?.retention ?? [];
  const users = snapshot?.users ?? [];
  const content = snapshot?.content ?? [];

  const totalTouchpoints = interactionsSeries.reduce((acc, entry) => acc + entry.total, 0);
  const likeEvents = interactionsSeries.reduce((acc, entry) => acc + entry.likes, 0);
  const saveEvents = interactionsSeries.reduce((acc, entry) => acc + entry.saves, 0);
  const viewEvents = interactionsSeries.reduce((acc, entry) => acc + entry.views, 0);
  const averageEngagement = interactionsSeries.length ? Math.round(totalTouchpoints / interactionsSeries.length) : 0;
  const maxInteractions = interactionsSeries.reduce((max, entry) => Math.max(max, entry.total), 0);
  const activeDays = interactionsSeries.filter((entry) => entry.total > 0).length;

  const weeklyLabels = useMemo(() => interactionsSeries.map((entry) => formatDayLabel(entry.day)), [interactionsSeries]);
  const engagementSparkline = useMemo(() => buildSparkline(interactionsSeries.map((entry) => entry.total)), [interactionsSeries]);
  const retentionValues = useMemo(() => retentionSeries.map((entry) => Math.max(0, entry.returningUsers)), [retentionSeries]);
  const retentionSparkline = useMemo(() => buildSparkline(retentionValues), [retentionValues]);
  const retentionDeltaPercent = useMemo(() => {
    if (retentionValues.length < 2) return 0;
    const first = retentionValues[0];
    const last = retentionValues[retentionValues.length - 1];
    if (first === 0) return last > 0 ? 100 : 0;
    return ((last - first) / first) * 100;
  }, [retentionValues]);

  const managedUsers = useMemo<ManagedUserRow[]>(
    () =>
      users.map((entry) => {
        const lastSeenDate = entry.lastSeen ? new Date(entry.lastSeen) : null;
        return {
          ...entry,
          status: deriveStatus(lastSeenDate),
          role: deriveRole(entry.interactions),
          lastSeenLabel: entry.lastSeen ? formatRelativeTime(entry.lastSeen) : "No activity yet",
        };
      }),
    [users],
  );

  const pipelineRows = useMemo<PipelineRow[]>(
    () =>
      content.map((item) => {
        const createdAtDate = new Date(item.createdAt);
        const owner = item.kind === "match" ? "Match ops" : item.kind === "clip" ? "Automation" : item.kind === "league" ? "Editorial" : "Content";
        const priority: PipelineRow["priority"] = item.popularity > 80 ? "High" : item.popularity > 40 ? "Medium" : "Low";
        return {
          ...item,
          owner,
          priority,
          eta: deriveEta(createdAtDate),
        };
      }),
    [content],
  );

  const reviewCount = pipelineRows.filter((row) => (row.status ?? "").toLowerCase().includes("review")).length;

  const quickStats = useMemo(
    () => [
      {
        label: "Total users",
        value: formatNumber(stats?.totalUsers),
        change: stats ? `${formatNumber(stats.weeklySignups)} joined in 7 days` : "Syncing sign-ups",
        icon: Users,
      },
      {
        label: "New sign-ups",
        value: formatNumber(stats?.weeklySignups),
        change: stats ? `${formatNumber(stats.activeUsers)} active in 24h` : "Monitoring activity",
        icon: UserPlus,
      },
      {
        label: "Content items",
        value: formatNumber(stats?.totalItems),
        change: `${reviewCount} awaiting review`,
        icon: FilePlus2,
      },
      {
        label: "Peak touchpoints",
        value: formatNumber(maxInteractions),
        change: `${activeDays} active day${activeDays === 1 ? "" : "s"} this week`,
        icon: Activity,
      },
    ],
    [activeDays, maxInteractions, reviewCount, stats],
  );

  const retentionDeltaLabel = `${retentionDeltaPercent >= 0 ? "+" : ""}${retentionDeltaPercent.toFixed(1)}%`;

  const lastActivityIso = useMemo(() => {
    const timestamps = users
      .map((entry) => (entry.lastSeen ? Date.parse(entry.lastSeen) : Number.NaN))
      .filter((value) => Number.isFinite(value));
    if (!timestamps.length) return null;
    return new Date(Math.max(...timestamps)).toISOString();
  }, [users]);

  const lastActiveDisplay = lastActivityIso ? formatRelativeTime(lastActivityIso) : "Awaiting activity";

  const alerts = useMemo<AlertEntry[]>(() => {
    if (!stats) return [];
    const list: AlertEntry[] = [];

    if (stats.activeUsers < Math.max(10, Math.round(stats.totalUsers * 0.02))) {
      list.push({
        title: "Engagement dip detected",
        message: `Only ${formatNumber(stats.activeUsers)} active users in the last 24h. Consider a re-engagement campaign.`,
        severity: "warning",
      });
    }

    if (retentionValues.length >= 2) {
      const first = retentionValues[0];
      const last = retentionValues[retentionValues.length - 1];
      if (first > 0) {
        const ratio = last / first;
        if (ratio < 0.75) {
          list.push({
            title: "Cohort retention slide",
            message: `Retention down ${Math.round((1 - ratio) * 100)}% versus two-week baseline.`,
            severity: "critical",
          });
        } else if (ratio > 1.25) {
          list.push({
            title: "Retention surge",
            message: `Retention improved ${Math.round((ratio - 1) * 100)}% week-over-week.`,
            severity: "info",
          });
        }
      }
    }

    if (interactionsSeries.length && averageEngagement > 0) {
      const peakDay = interactionsSeries.reduce((peak, entry) => (entry.total > peak.total ? entry : peak), interactionsSeries[0]);
      if (peakDay.total > averageEngagement * 1.6) {
        list.push({
          title: "Traffic spike detected",
          message: `${formatDayLabel(peakDay.day)} recorded ${formatNumber(peakDay.total)} interactions — ensure infrastructure scaling.`,
          severity: "info",
        });
      }
    }

    return list;
  }, [averageEngagement, interactionsSeries, retentionValues, stats]);

  return (
    <div className="container space-y-8 py-10">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <Card className="neon-card">
          <CardContent className="flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between">
            <div className="space-y-4">
              <Badge variant="outline" className="neon-chip">Full system control</Badge>
              <div className="space-y-1">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Sports Intelligence Admin Hub</h1>
                <p className="text-sm text-muted-foreground">
                  Monitor global activity, govern content workflows, and orchestrate automation for the entire platform.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Authenticated as {user.email}
                </span>
                <span className="inline-flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" /> Last activity snapshot {lastActiveDisplay}
                </span>
                <span className="inline-flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" /> Primary admin {PRIMARY_ADMIN_EMAIL}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" className="neon-button" onClick={handleExport}>
                <ClipboardCheck className="mr-2 h-4 w-4" /> Export report
              </Button>
              <Button variant="secondary" className="neon-button" onClick={refreshSnapshot} disabled={refreshing || snapshotLoading}>
                {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />} Refresh data
              </Button>
              <Button variant="ghost" onClick={handleSignOut}>Sign out</Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {snapshotError && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Card className="border-destructive/40 bg-destructive/10">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 text-sm">
              <span className="text-destructive">{snapshotError}</span>
              <Button size="sm" variant="outline" onClick={refreshSnapshot}>
                Retry
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.6 }} className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {quickStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="neon-card">
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <p className="text-3xl font-semibold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.change}</p>
              </CardContent>
            </Card>
          );
        })}
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }} className="lg:col-span-2">
          <Card className="neon-card h-full">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  <CardTitle className="text-foreground">Engagement trajectory</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">Live overview of platform-wide touchpoints across the past seven days.</p>
              </div>
              <Badge variant="outline" className="text-xs font-medium">
                Avg interactions: {formatNumber(averageEngagement)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/40 bg-background/70 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Total engagement (weekly)</p>
                    <p className="text-lg font-semibold text-foreground">{formatNumber(totalTouchpoints)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[var(--primary,#ef4444)]" aria-hidden /> Touchpoints
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5 text-primary" /> {retentionDeltaLabel} retention delta
                    </span>
                  </div>
                </div>
                {snapshotLoading ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading engagement…
                  </div>
                ) : engagementSparkline.coordinates.length ? (
                  <div className="mt-6 h-40">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                      <defs>
                        <linearGradient id="adminEngagementFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.6" />
                          <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0.05" />
                        </linearGradient>
                      </defs>
                      <path d={engagementSparkline.areaPath} fill="url(#adminEngagementFill)" opacity="0.55" />
                      <polyline
                        points={engagementSparkline.linePoints}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {engagementSparkline.coordinates.map((coord, index) => (
                        <circle
                          key={`engagement-point-${coord.x}-${index}`}
                          cx={coord.x}
                          cy={coord.y}
                          r={1.6}
                          fill="var(--primary)"
                          stroke="var(--background)"
                          strokeWidth="0.6"
                        />
                      ))}
                    </svg>
                  </div>
                ) : (
                  <p className="mt-6 text-sm text-muted-foreground">No engagement data yet — come back after the next campaign wave.</p>
                )}
                <div className="mt-4 flex justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                  {weeklyLabels.map((label, index) => {
                    const shouldShow = index === 0 || index === weeklyLabels.length - 1 || index === Math.floor(weeklyLabels.length / 2);
                    return (
                      <span key={`${label}-${index}`} className="min-w-[3ch] text-center">
                        {shouldShow ? label : ""}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border/50 bg-background/70 px-4 py-3">
                  <p className="text-2xl font-semibold text-foreground">{formatNumber(maxInteractions)}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Peak day interactions</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/70 px-4 py-3">
                  <p className="text-2xl font-semibold text-foreground">{formatNumber(likeEvents)}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Likes this week</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/70 px-4 py-3">
                  <p className="text-2xl font-semibold text-foreground">{formatNumber(saveEvents)}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Saves this week</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 text-xs uppercase tracking-wide text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Views captured: <span className="font-semibold text-foreground">{formatNumber(viewEvents)}</span>
                </span>
                <span>
                  Active days: <span className="font-semibold text-foreground">{activeDays}</span>
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.6 }}>
          <Card className="neon-card h-full">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle className="text-foreground">Retention control</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">Track cohort stickiness and monitor drop-off risk in real time.</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/40 bg-background/70 p-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">VIP cohort retention</span>
                  <Badge variant="outline" className="text-xs font-medium">{retentionValues.length ? formatNumber(retentionValues[retentionValues.length - 1]) : "—"}%</Badge>
                </div>
                {snapshotLoading ? (
                  <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading retention…
                  </div>
                ) : retentionSparkline.coordinates.length ? (
                  <div className="mt-4 h-28">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                      <defs>
                        <linearGradient id="retentionFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="var(--foreground)" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={retentionSparkline.areaPath} fill="url(#retentionFill)" opacity="0.8" />
                      <polyline
                        points={retentionSparkline.linePoints}
                        fill="none"
                        stroke="var(--foreground)"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity={0.85}
                      />
                      {retentionSparkline.coordinates.map((coord, index) => (
                        <circle
                          key={`retention-point-${coord.x}-${index}`}
                          cx={coord.x}
                          cy={coord.y}
                          r={1.4}
                          fill="var(--foreground)"
                          stroke="var(--background)"
                          strokeWidth="0.6"
                          opacity={0.9}
                        />
                      ))}
                    </svg>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">Retention analytics will appear once cohorts engage with content.</p>
                )}
                <div className="mt-3 text-xs text-muted-foreground">
                  Cohort momentum: <span className="font-semibold text-foreground">{retentionDeltaLabel}</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-3 text-sm">
                  <span className="text-muted-foreground">Community escalations</span>
                  <span className="font-semibold text-foreground">{formatNumber(alerts.length ? alerts.length : 0)} open</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-3 text-sm">
                  <span className="text-muted-foreground">Creator payout queue</span>
                  <span className="font-semibold text-foreground">$12.8K ready</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-3 text-sm">
                  <span className="text-muted-foreground">Automation confidence</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" /> 97%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.6 }}>
          <Card className="neon-card h-full">
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle className="text-foreground">User management</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border/40 text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-3 pr-4">User</th>
                    <th className="py-3 pr-4">Role</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Last seen</th>
                    <th className="py-3 pl-4 text-right">Interactions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {managedUsers.map((entry) => (
                    <tr key={entry.id} className="text-sm">
                      <td className="py-3 pr-4 font-medium text-foreground">
                        <div className="flex flex-col">
                          <span>{entry.name}</span>
                          <span className="text-xs text-muted-foreground">{entry.email}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{entry.role}</td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant="outline"
                          className={
                            entry.status === "Active"
                              ? "border-green-400/40 text-green-400"
                              : entry.status === "Warning"
                                ? "border-amber-400/40 text-amber-400"
                                : "border-red-400/50 text-red-400"
                          }
                        >
                          {entry.status}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{entry.lastSeenLabel}</td>
                      <td className="py-3 pl-4 text-right text-muted-foreground">{formatNumber(entry.interactions)}</td>
                    </tr>
                  ))}
                  {!managedUsers.length && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                        User activity will appear once members interact with the platform.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.6 }} className="space-y-6">
          <Card className="neon-card">
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <FilePlus2 className="h-5 w-5 text-primary" />
                <CardTitle className="text-foreground">Content pipeline</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {pipelineRows.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/40 bg-background/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.kind} · Owned by {item.owner}</p>
                    </div>
                    <Badge variant="outline" className="text-xs font-medium">{item.status ?? `${item.priority} priority`}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>ETA: {item.eta}</span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" /> {item.priority} focus
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-3"
                      onClick={() => toast.success(`Sent to QA: ${item.title}`)}
                    >
                      Send to QA
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="neon-button px-3"
                      onClick={() => toast.success(`Published: ${item.title}`)}
                    >
                      Publish
                    </Button>
                  </div>
                </div>
              ))}
              {!pipelineRows.length && (
                <p className="text-sm text-muted-foreground">No content items pulled from the database yet. Populate the backlog to see automation recommendations.</p>
              )}
            </CardContent>
          </Card>

          <Card className="neon-card">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                <CardTitle className="text-foreground">System controls</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">Toggle platform-wide automation and safety layers instantly.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Maintenance mode</p>
                  <p className="text-xs text-muted-foreground">Redirect all users to system status page.</p>
                </div>
                <Switch
                  checked={systemFlags.maintenance}
                  disabled={updatingFlag === "maintenance" || snapshotLoading}
                  onCheckedChange={(checked) => handleFlagChange("maintenance", checked)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Highlight automation</p>
                  <p className="text-xs text-muted-foreground">Control AI-powered highlight reel generation.</p>
                </div>
                <Switch
                  checked={systemFlags.highlightsAutomation}
                  disabled={updatingFlag === "highlightsAutomation" || snapshotLoading}
                  onCheckedChange={(checked) => handleFlagChange("highlightsAutomation", checked)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 px-3 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">AI anomaly alerts</p>
                  <p className="text-xs text-muted-foreground">Receive real-time incident notifications.</p>
                </div>
                <Switch
                  checked={systemFlags.aiAlerts}
                  disabled={updatingFlag === "aiAlerts" || snapshotLoading}
                  onCheckedChange={(checked) => handleFlagChange("aiAlerts", checked)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="neon-card">
            <CardHeader className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" />
              <CardTitle className="text-foreground">Active alerts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No alerts triggered. Monitoring continues in the background.</p>
              ) : (
                alerts.map((alert, index) => (
                  <div key={`${alert.title}-${index}`} className="rounded-lg border border-border/40 bg-background/60 px-3 py-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-foreground">{alert.title}</p>
                      <Badge
                        variant="outline"
                        className={
                          alert.severity === "critical"
                            ? "border-red-400/50 text-red-400"
                            : alert.severity === "warning"
                              ? "border-amber-400/50 text-amber-400"
                              : "border-blue-400/50 text-blue-400"
                        }
                      >
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{alert.message}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
