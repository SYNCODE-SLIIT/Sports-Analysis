import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { event?: string; session?: unknown }
    | null;

  if (!body?.event) {
    return NextResponse.json({ success: false, error: "Missing event." }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  const event = body.event;

  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
    await supabase.auth.setSession(body.session as any);
  }

  if (event === "SIGNED_OUT") {
    await supabase.auth.signOut();
  }

  return response;
}
