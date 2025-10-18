const ADMIN_EMAILS_SOURCE = process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "admin@sportsanalysis.app";

export const ADMIN_EMAILS = ADMIN_EMAILS_SOURCE.split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export const PRIMARY_ADMIN_EMAIL = ADMIN_EMAILS[0] ?? "admin@sportsanalysis.app";

export const ADMIN_PASSWORD_HINT = process.env.NEXT_PUBLIC_ADMIN_PASSWORD_HINT ?? "SportsAdmin#2025";

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return ADMIN_EMAILS.includes(normalized);
}
