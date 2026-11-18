-- Public-client-compatible panel data inferred from the Argon browser bundle.
-- This is a replacement schema; it does not reproduce private Argon tables.

create table if not exists public.panel_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_bundles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bundle_id text not null,
  bundle jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, bundle_id)
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'awaiting_provider' check (status in ('draft','awaiting_provider','scheduled','active','paused','completed','cancelled','failed')),
  campaign jsonb not null default '{}'::jsonb,
  cost_inr numeric(14,2) not null default 0 check (cost_inr >= 0),
  provider_id uuid references public.provider_registry(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists missions_user_created_idx on public.missions(user_id, created_at desc);
create index if not exists missions_status_created_idx on public.missions(status, created_at desc);

insert into public.panel_settings(key,value)
values
  ('ratios', '{"views":10000,"likes":35,"comments":8,"shares":5}'::jsonb),
  ('bundles', '{"activeBundleId":"starter","bundles":[{"id":"starter","name":"Starter","isDefault":true,"persistence":"database","enabledMetrics":{"views":true,"likes":true,"comments":true,"shares":true}}]}'::jsonb)
on conflict (key) do nothing;

alter table public.panel_settings enable row level security;
alter table public.user_bundles enable row level security;
alter table public.missions enable row level security;

drop policy if exists panel_settings_public_read on public.panel_settings;
create policy panel_settings_public_read on public.panel_settings for select to anon, authenticated using (key in ('ratios','bundles'));
drop policy if exists user_bundles_read_self on public.user_bundles;
create policy user_bundles_read_self on public.user_bundles for select to authenticated using (user_id=auth.uid());
drop policy if exists missions_read_self on public.missions;
create policy missions_read_self on public.missions for select to authenticated using (user_id=auth.uid());

grant select on public.panel_settings to anon, authenticated;
grant select on public.user_bundles, public.missions to authenticated;
grant all on public.panel_settings, public.user_bundles, public.missions to service_role;
