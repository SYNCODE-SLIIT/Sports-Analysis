import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseServiceRole: SupabaseClient | undefined;

export function getSupabaseServiceRoleClient(): SupabaseClient {
  if (!supabaseServiceRole) {
    const missing: string[] = [];
    if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (missing.length) {
      throw new Error(`Missing required env vars: ${missing.join(', ')}.`);
    }
    supabaseServiceRole = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    );
  }
  return supabaseServiceRole;
}
