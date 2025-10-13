-- Profiles table linked to auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone default now()
);

-- User preferences for personalization
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorite_teams text[] default '{}',
  favorite_leagues text[] default '{}',
  created_at timestamp with time zone default now()
);

-- Items to recommend (could be matches, articles, clips)
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- e.g. 'match' | 'article' | 'clip'
  title text not null,
  data jsonb not null default '{}',
  teams text[] default '{}',
  leagues text[] default '{}',
  popularity numeric default 0,
  created_at timestamp with time zone default now()
);

-- Recommendations per user
create table if not exists public.recommendations (
  user_id uuid references auth.users(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  score numeric not null default 0,
  reason text,
  created_at timestamp with time zone default now(),
  primary key (user_id, item_id)
);

-- RLS
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.recommendations enable row level security;
alter table public.items enable row level security;

-- Policies (drop-if-exists to make idempotent)
drop policy if exists "Read own profile" on public.profiles;
drop policy if exists "Update own profile" on public.profiles;
drop policy if exists "Insert own profile" on public.profiles;
create policy "Read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Insert own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Read own preferences" on public.user_preferences;
drop policy if exists "Upsert own preferences" on public.user_preferences;
drop policy if exists "Update own preferences" on public.user_preferences;
create policy "Read own preferences" on public.user_preferences for select using (auth.uid() = user_id);
create policy "Upsert own preferences" on public.user_preferences for insert with check (auth.uid() = user_id);
create policy "Update own preferences" on public.user_preferences for update using (auth.uid() = user_id);

-- Items are readable by all; writes are restricted to service role
drop policy if exists "Read items" on public.items;
create policy "Read items" on public.items for select using (true);

drop policy if exists "Read own recommendations" on public.recommendations;
drop policy if exists "Upsert own recommendations" on public.recommendations;
drop policy if exists "Update own recommendations" on public.recommendations;
create policy "Read own recommendations" on public.recommendations for select using (auth.uid() = user_id);
create policy "Upsert own recommendations" on public.recommendations for insert with check (auth.uid() = user_id);
create policy "Update own recommendations" on public.recommendations for update using (auth.uid() = user_id);

-- Helper function to ensure preferences row
create or replace function public.ensure_user_preferences(uid uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.user_preferences(user_id)
  values (uid)
  on conflict (user_id) do nothing;
end;$$;

-- Track implicit feedback for better personalization
create table if not exists public.user_interactions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  event text not null check (event in ('view','click','like','save','share','dismiss')),
  created_at timestamp with time zone default now()
);

alter table public.user_interactions enable row level security;

drop policy if exists "Read own interactions" on public.user_interactions;
drop policy if exists "Insert own interactions" on public.user_interactions;
create policy "Read own interactions" on public.user_interactions for select using (auth.uid() = user_id);
create policy "Insert own interactions" on public.user_interactions for insert with check (auth.uid() = user_id);

-- Helpful indexes
create index if not exists idx_items_created_at on public.items(created_at desc);
create index if not exists idx_items_popularity on public.items(popularity desc);
create index if not exists idx_items_teams_gin on public.items using gin(teams);
create index if not exists idx_items_leagues_gin on public.items using gin(leagues);
create index if not exists idx_interactions_user on public.user_interactions(user_id);
create index if not exists idx_interactions_item on public.user_interactions(item_id);
create index if not exists idx_interactions_created on public.user_interactions(created_at desc);

-- RPC: Compute personalized recommendations server-side
create or replace function public.get_personalized_recommendations(uid uuid, limit_count int default 20)
returns table (item_id uuid, score numeric, reason text, item jsonb)
language sql
security definer
stable
as $$
with prefs as (
  select coalesce(favorite_teams, '{}') as favorite_teams,
         coalesce(favorite_leagues, '{}') as favorite_leagues
  from public.user_preferences where user_id = uid
),
signals as (
  select i.id as item_id,
    -- Base: popularity and recency decay (30-day half-life-ish)
    coalesce(i.popularity, 0) * 0.4
      + (1.0 / (1 + greatest(extract(epoch from (now() - i.created_at)) / 86400.0 / 30.0, 0))) * 0.2 as base_score,
    -- Preference matches
    (select case when p.favorite_teams && i.teams then 1 else 0 end +
            case when p.favorite_leagues && i.leagues then 1 else 0 end
     from prefs p) * 0.2 as pref_score,
    -- User-specific interactions with recency decay (14 days)
    coalesce((
      select sum(
        case ui.event
          when 'like' then 2.0
          when 'save' then 1.5
          when 'share' then 2.0
          when 'click' then 1.0
          when 'view' then 0.2
          when 'dismiss' then -2.0
          else 0
        end * (1.0 / (1 + greatest(extract(epoch from (now() - ui.created_at)) / 86400.0 / 14.0, 0)))
      ) from public.user_interactions ui
      where ui.user_id = uid and ui.item_id = i.id
    ), 0) * 0.6 as interaction_score
  from public.items i
)
select s.item_id,
       (s.base_score + s.pref_score + s.interaction_score) as score,
       case
         when exists (select 1 from prefs p, public.items ii where ii.id = s.item_id and p.favorite_teams && ii.teams)
           then 'Matches your favorite teams'
         when exists (select 1 from prefs p, public.items ii where ii.id = s.item_id and p.favorite_leagues && ii.leagues)
           then 'Matches your favorite leagues'
         else 'Trending for you'
       end as reason,
       (select to_jsonb(i.*) from public.items i where i.id = s.item_id) as item
from signals s
where not exists (
  select 1 from public.user_interactions ui
  where ui.user_id = uid and ui.item_id = s.item_id and ui.event = 'dismiss' and ui.created_at > now() - interval '7 days'
)
order by score desc
limit coalesce(limit_count, 20);
$$;

-- RPC: list popular teams for suggestions
create or replace function public.list_popular_teams(limit_count int default 25)
returns table(team text, popularity numeric)
language sql
stable
security definer
as $$
  select t as team, sum(coalesce(i.popularity,0)) as popularity
  from public.items i, unnest(i.teams) as t
  group by t
  order by popularity desc nulls last
  limit coalesce(limit_count, 25);
$$;

-- Cache tables for teams and leagues to reduce backend calls
create table if not exists public.cached_teams (
  id uuid primary key default gen_random_uuid(),
  provider_id text,
  name text not null unique,
  logo text,
  metadata jsonb default '{}'::jsonb,
  last_updated timestamp with time zone default now()
);

create table if not exists public.cached_leagues (
  id uuid primary key default gen_random_uuid(),
  provider_id text,
  name text not null unique,
  logo text,
  metadata jsonb default '{}'::jsonb,
  last_updated timestamp with time zone default now()
);

alter table public.cached_teams enable row level security;
alter table public.cached_leagues enable row level security;

drop policy if exists "Read cached teams" on public.cached_teams;
create policy "Read cached teams" on public.cached_teams for select using (true);
drop policy if exists "Read cached leagues" on public.cached_leagues;
create policy "Read cached leagues" on public.cached_leagues for select using (true);

create index if not exists idx_cached_teams_name on public.cached_teams(lower(name));
create index if not exists idx_cached_leagues_name on public.cached_leagues(lower(name));

-- RPC: upsert a cached team (security definer so client can call safely)
create or replace function public.upsert_cached_team(p_provider_id text, p_name text, p_logo text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer as $$
begin
  insert into public.cached_teams(provider_id, name, logo, metadata)
  values (p_provider_id, p_name, p_logo, p_metadata)
  on conflict (name) do update set
    provider_id = coalesce(excluded.provider_id, public.cached_teams.provider_id),
    logo = coalesce(excluded.logo, public.cached_teams.logo),
    metadata = public.cached_teams.metadata || excluded.metadata,
    last_updated = now();
end;$$;

-- RPC: upsert a cached league
create or replace function public.upsert_cached_league(p_provider_id text, p_name text, p_logo text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer as $$
begin
  insert into public.cached_leagues(provider_id, name, logo, metadata)
  values (p_provider_id, p_name, p_logo, p_metadata)
  on conflict (name) do update set
    provider_id = coalesce(excluded.provider_id, public.cached_leagues.provider_id),
    logo = coalesce(excluded.logo, public.cached_leagues.logo),
    metadata = public.cached_leagues.metadata || excluded.metadata,
    last_updated = now();
end;$$;

-- RPC: ensure an item exists for a specific match/event (by provider event_id in data)
create or replace function public.ensure_match_item(
  p_event_id text,
  p_title text,
  p_teams text[] default '{}',
  p_league text default null,
  p_popularity numeric default 0
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.items where kind = 'match' and (data->>'event_id') = p_event_id limit 1;
  if v_id is null then
    insert into public.items(kind, title, data, teams, leagues, popularity)
    values('match', coalesce(p_title, 'Match'), jsonb_build_object('event_id', p_event_id), coalesce(p_teams, '{}'), case when p_league is not null then array[p_league] else '{}'::text[] end, coalesce(p_popularity,0))
    returning id into v_id;
  else
    update public.items
      set title = coalesce(p_title, title),
          teams = coalesce(p_teams, teams),
          leagues = case when p_league is not null then array[p_league] else leagues end,
          popularity = greatest(coalesce(popularity,0), coalesce(p_popularity,0))
      where id = v_id;
  end if;
  return v_id;
end;$$;

-- RPC: ensure an item exists for a league (by name)
create or replace function public.ensure_league_item(
  p_league_name text,
  p_logo text default null,
  p_popularity numeric default 0
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.items where kind = 'league' and title = p_league_name limit 1;
  if v_id is null then
    insert into public.items(kind, title, data, leagues, popularity)
    values('league', p_league_name, jsonb_build_object('logo', p_logo), array[p_league_name], coalesce(p_popularity,0))
    returning id into v_id;
  else
    update public.items
      set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('logo', p_logo),
          popularity = greatest(coalesce(popularity,0), coalesce(p_popularity,0))
      where id = v_id;
  end if;
  return v_id;
end;$$;
