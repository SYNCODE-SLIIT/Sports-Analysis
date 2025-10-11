Supabase integration
====================

1) Install deps
- Already added: @supabase/supabase-js and @supabase/ssr

2) Env vars (copy .env.example to .env.local)
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_SITE_URL (http://localhost:3000 during dev)

3) Database schema
- Run the SQL in web/supabase.sql in your Supabase SQL editor to create tables and RLS policies.

4) Auth providers
- In Supabase Dashboard → Authentication → Providers, enable Google and set the redirect URL:
  - http://localhost:3000/auth/callback
  - Add your production domain callback as well.

5) Test
- Start dev server and use Login/Signup pages to sign in with Google or email/password.
- After first login, a profile and preferences row should be created.

6) Recommendations API
- GET /api/recommendations returns personalized items if present in 'recommendations'.
- Fallback uses 'user_preferences' and public 'items' table popularity.
