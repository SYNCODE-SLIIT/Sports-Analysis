-- Admin access column on profiles
alter table if exists public.profiles
  add column if not exists is_admin boolean default false;

-- Seedable list of admin accounts (checked against auth.users email)
create table if not exists public.admin_accounts (
  email text primary key,
  label text
);

insert into public.admin_accounts(email, label)
values ('admin@sportsanalysis.app', 'Primary admin')
on conflict (email) do nothing;

-- Stores global automation/settings toggles
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);

grant select on public.system_settings to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'system_settings'
  ) then
    execute 'alter publication supabase_realtime add table public.system_settings';
  end if;
end;$$;

insert into public.system_settings(key, value)
values
  (
    'maintenance',
    jsonb_build_object(
      'enabled', false,
      'metadata', jsonb_build_object('scheduledFor', null, 'message', null)
    )
  ),
  (
    'highlightsAutomation',
    jsonb_build_object(
      'enabled', true,
      'metadata', '{}'::jsonb
    )
  ),
  (
    'aiAlerts',
    jsonb_build_object(
      'enabled', true,
      'metadata', '{}'::jsonb
    )
  )
on conflict (key) do nothing;

-- Helper to gate admin-only RPCs
create or replace function public.is_admin_context()
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_email text;
  match_exists boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  select lower(email) into current_email from auth.users where id = auth.uid();
  if current_email is null then
    return false;
  end if;

  select exists (
    select 1 from public.admin_accounts where lower(email) = current_email
  ) into match_exists;

  if match_exists then
    return true;
  end if;

  return exists (
    select 1 from public.profiles where id = auth.uid() and is_admin is true
  );
end;
$$;

-- Aggregated analytics and system overview for the admin dashboard
create or replace function public.admin_dashboard_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if not public.is_admin_context() then
    raise exception 'not_authorized';
  end if;

  with stats as (
    select
      (select count(*) from public.profiles)::int as total_users,
      (select count(*) from public.profiles where created_at >= now() - interval '7 days')::int as weekly_signups,
      (select count(distinct user_id) from public.user_interactions where created_at >= now() - interval '24 hours')::int as active_users,
      (select count(*) from public.items)::int as total_items
  ),
  interaction_window as (
    select
      date_trunc('day', created_at) as day,
      count(*)::int as total,
      count(*) filter (where event = 'like')::int as likes,
      count(*) filter (where event = 'save')::int as saves,
      count(*) filter (where event = 'view')::int as views,
      count(distinct user_id)::int as unique_users
    from public.user_interactions
    where created_at >= date_trunc('day', now() - interval '6 days')
    group by day
    order by day
  ),
  retention_window as (
    select
      day,
      count(distinct user_id)::int as returning_users
    from (
      select user_id, date_trunc('day', created_at) as day
      from public.user_interactions
      where created_at >= date_trunc('day', now() - interval '13 days')
    ) s
    group by day
    order by day
  ),
  user_overview as (
    select
      p.id,
      coalesce(nullif(p.full_name, ''), u.email) as name,
      u.email,
      p.created_at,
      max(ui.created_at) as last_seen,
      coalesce(count(ui.id), 0)::int as interactions_count,
      coalesce(count(ui.id) filter (where ui.event = 'like'), 0)::int as likes_count,
      coalesce(count(ui.id) filter (where ui.event = 'save'), 0)::int as saves_count
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_interactions ui on ui.user_id = p.id
    group by p.id, name, u.email, p.created_at
    order by coalesce(max(ui.created_at), p.created_at) desc nulls last
    limit 10
  ),
  content_overview as (
    select
      id,
      title,
      kind,
      created_at,
      coalesce(popularity, 0) as popularity,
      coalesce(nullif(data->>'status', ''), case when coalesce(popularity, 0) > 80 then 'Trending' when coalesce(popularity, 0) > 30 then 'Needs review' else 'Draft' end) as status
    from public.items
    order by created_at desc
    limit 8
  ),
  settings as (
    select coalesce(
      jsonb_object_agg(
        key,
        jsonb_build_object(
          'enabled', coalesce((value->>'enabled')::boolean, false),
          'metadata', coalesce(value->'metadata', '{}'::jsonb),
          'updatedAt', to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
        )
      ),
      '{}'::jsonb
    ) as flags
    from public.system_settings
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'totalUsers', (select total_users from stats),
      'weeklySignups', (select weekly_signups from stats),
      'activeUsers', (select active_users from stats),
      'totalItems', (select total_items from stats)
    ),
    'interactions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', to_char(day, 'YYYY-MM-DD'),
          'total', total,
          'likes', likes,
          'saves', saves,
          'views', views,
          'uniqueUsers', unique_users
        )
      ) from interaction_window
    ), '[]'::jsonb),
    'retention', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', to_char(day, 'YYYY-MM-DD'),
          'returningUsers', returning_users
        )
      ) from retention_window
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id::text,
          'name', name,
          'email', email,
          'createdAt', to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ'),
          'lastSeen', case when last_seen is null then null else to_char(last_seen, 'YYYY-MM-DD"T"HH24:MI:SSZ') end,
          'interactions', interactions_count,
          'likes', likes_count,
          'saves', saves_count
        )
      ) from user_overview
    ), '[]'::jsonb),
    'content', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id::text,
          'title', title,
          'kind', kind,
          'createdAt', to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ'),
          'popularity', popularity,
          'status', status
        )
      ) from content_overview
    ), '[]'::jsonb),
    'flags', coalesce((select flags from settings), '{}'::jsonb)
  ) into snapshot;

  return snapshot;
end;
$$;

grant execute on function public.admin_dashboard_snapshot() to authenticated;

-- Persist admin changes to system_settings (optionally updating metadata)
create or replace function public.admin_set_system_flag(flag text, enabled boolean, metadata jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_admin_context() then
    raise exception 'not_authorized';
  end if;

  insert into public.system_settings(key, value, updated_at)
  values (
    flag,
    jsonb_build_object(
      'enabled', enabled,
      'metadata', coalesce(metadata, '{}'::jsonb)
    ),
    now()
  )
  on conflict (key) do update
    set value = case
      when metadata is null then jsonb_build_object(
        'enabled', (excluded.value->>'enabled')::boolean,
        'metadata', coalesce(public.system_settings.value->'metadata', '{}'::jsonb)
      )
      else jsonb_build_object(
        'enabled', (excluded.value->>'enabled')::boolean,
        'metadata', coalesce(excluded.value->'metadata', '{}'::jsonb)
      )
    end,
        updated_at = now();

  select jsonb_build_object(
    'key', key,
    'enabled', coalesce((value->>'enabled')::boolean, false),
    'metadata', coalesce(value->'metadata', '{}'::jsonb),
    'updatedAt', to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
  )
  into result
  from public.system_settings
  where key = flag;

  return result;
end;
$$;

grant execute on function public.admin_set_system_flag(text, boolean, jsonb) to authenticated;

-- Lightweight reader for maintenance state so clients don't require direct table access
create or replace function public.get_maintenance_state()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'enabled', coalesce((value->>'enabled')::boolean, false),
        'metadata', coalesce(value->'metadata', '{}'::jsonb)
      )
      from public.system_settings
      where key = 'maintenance'
    ),
    jsonb_build_object(
      'enabled', false,
      'metadata', jsonb_build_object('scheduledFor', null, 'message', null)
    )
  );
$$;

grant execute on function public.get_maintenance_state() to anon, authenticated;
