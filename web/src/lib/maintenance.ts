export type MaintenanceState = {
  enabled: boolean;
  scheduledFor: string | null;
  message: string;
};

export const defaultMaintenanceState: MaintenanceState = {
  enabled: false,
  scheduledFor: null,
  message: "",
};

export const parseMaintenanceValue = (value: unknown): MaintenanceState => {
  if (!value || typeof value !== "object") {
    return defaultMaintenanceState;
  }
  const record = value as Record<string, unknown>;
  const enabledRaw = record.enabled;
  const metadata = record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : {};
  return {
    enabled: typeof enabledRaw === "boolean" ? enabledRaw : false,
    scheduledFor: typeof metadata.scheduledFor === "string" ? metadata.scheduledFor : null,
    message: typeof metadata.message === "string" ? metadata.message : "",
  };
};

export const isFutureDate = (iso: string | null): boolean => {
  if (!iso) return false;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() > Date.now();
};

export const formatCountdown = (iso: string | null): string | null => {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return null;
  const minutes = Math.round(diffMs / 60000);
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return `${days}d${hours ? ` ${hours}h` : ""}`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return `${hours}h${remaining ? ` ${remaining}m` : ""}`;
  }
  return `${minutes}m`;
};

export const formatScheduledLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
};
