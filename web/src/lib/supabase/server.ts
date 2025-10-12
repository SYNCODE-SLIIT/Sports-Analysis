import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export async function getSupabaseServerClient() {
  cookies();
  // For server-side routes we can rely on the service role being set via env when needed.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      auth: {
        // This instructs the client to use cookie storage in Next
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );
  return supabase;
}
