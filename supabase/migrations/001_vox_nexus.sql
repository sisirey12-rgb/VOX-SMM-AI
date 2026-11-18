-- Vox Nexus clean-room schema for Supabase Postgres.
-- Run once in the Supabase SQL editor or through Supabase CLI migrations.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null default 'Marketing',
  rate_per_1k_cents bigint not null default 0 check (rate_per_1k_cents >= 0),
  min_quantity integer not null default 1 check (min_quantity > 0),
  max_quantity integer not null default 1000 check (max_quantity >= min_quantity),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid not null references public.services(id),
  service_name text not null,
  quantity integer not null check (quantity > 0),
  brief text not null default '',
  total_cents bigint not null check (total_cents >= 0),
  status text not null default 'pending' check (status in ('pending','in_review','in_progress','completed','cancelled')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists orders_user_created_idx on public.orders(user_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders(status, created_at desc);

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_type text not null check (entry_type in ('order_debit','admin_adjustment','refund')),
  amount_cents bigint not null check (amount_cents <> 0),
  description text not null,
  order_id uuid references public.orders(id) on delete set null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);

create index if not exists wallet_ledger_user_created_idx on public.wallet_ledger(user_id, created_at desc);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  old_status text,
  new_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120),
  status text not null default 'open' check (status in ('open','waiting','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_created_idx on public.support_tickets(user_id, created_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  message text not null check (char_length(message) between 1 and 4000),
  staff_message boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_ticket_created_idx on public.support_messages(ticket_id, created_at);

create table if not exists public.provider_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('manual','mock')),
  enabled boolean not null default false,
  mode text not null default 'manual' check (mode in ('manual','mock')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.services (name, description, category, rate_per_1k_cents, min_quantity, max_quantity)
select * from (values
  ('Content strategy review', 'A human-reviewed content plan for your brand and audience.', 'Strategy', 2500::bigint, 1, 10),
  ('Short-form video edit', 'Editing and captioning for client-provided footage.', 'Creative', 12000::bigint, 1, 20),
  ('Caption writing pack', 'Original captions drafted from your campaign brief.', 'Creative', 4000::bigint, 1, 50),
  ('Brand profile audit', 'A written audit with actionable profile and content improvements.', 'Consulting', 8500::bigint, 1, 5)
) as seed(name,description,category,rate_per_1k_cents,min_quantity,max_quantity)
where not exists (select 1 from public.services limit 1);

insert into public.provider_registry (name,kind,enabled,mode)
select 'Manual fulfillment queue','manual',true,'manual'
where not exists (select 1 from public.provider_registry);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id,email,full_name)
  values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do update set email = excluded.email;
  insert into public.wallet_accounts (user_id,balance_cents)
  values (new.id,0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.create_order_with_debit(
  p_user_id uuid,
  p_service_id uuid,
  p_quantity integer,
  p_brief text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_service public.services%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_order public.orders%rowtype;
  v_total bigint;
  v_role text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_quantity < 1 or p_quantity > 1000000 or char_length(coalesce(p_brief,'')) > 3000 or char_length(coalesce(p_idempotency_key,'')) < 8 then
    raise exception 'Invalid order input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_idempotency_key,0));
  select * into v_order from public.orders where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('id',v_order.id,'status',v_order.status,'totalCents',v_order.total_cents,'reused',true); end if;
  select * into v_service from public.services where id=p_service_id and active=true for share;
  if not found then raise exception 'Service unavailable'; end if;
  if p_quantity < v_service.min_quantity or p_quantity > v_service.max_quantity then raise exception 'Quantity outside service limits'; end if;
  v_total := ceil((p_quantity::numeric * v_service.rate_per_1k_cents::numeric) / 1000)::bigint;
  select * into v_wallet from public.wallet_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Wallet unavailable'; end if;
  if v_wallet.balance_cents < v_total then raise exception 'Insufficient wallet balance'; end if;
  update public.wallet_accounts set balance_cents=balance_cents-v_total,updated_at=now() where user_id=p_user_id;
  insert into public.orders(user_id,service_id,service_name,quantity,brief,total_cents,status,idempotency_key)
  values(p_user_id,p_service_id,v_service.name,p_quantity,coalesce(p_brief,''),v_total,'pending',p_idempotency_key)
  returning * into v_order;
  if v_total > 0 then
    insert into public.wallet_ledger(user_id,entry_type,amount_cents,description,order_id,idempotency_key)
    values(p_user_id,'order_debit',-v_total,'Order: ' || v_service.name,v_order.id,'order:' || p_idempotency_key);
  end if;
  insert into public.order_events(order_id,actor_id,old_status,new_status,note)
  values(v_order.id,p_user_id,null,'pending','Created and queued for manual fulfillment.');
  return jsonb_build_object('id',v_order.id,'status',v_order.status,'totalCents',v_order.total_cents,'reused',false);
end;
$$;

create or replace function public.adjust_wallet_balance(
  p_admin_id uuid,
  p_user_id uuid,
  p_amount_cents bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin_role text;
  v_wallet public.wallet_accounts%rowtype;
  v_existing public.wallet_ledger%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select role into v_admin_role from public.profiles where id=p_admin_id;
  if v_admin_role <> 'admin' then raise exception 'Administrator required'; end if;
  if p_amount_cents=0 or abs(p_amount_cents)>100000000 or char_length(coalesce(p_reason,''))=0 or char_length(coalesce(p_idempotency_key,''))<8 then raise exception 'Invalid adjustment'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':adjust:' || p_idempotency_key,0));
  select * into v_existing from public.wallet_ledger where user_id=p_user_id and idempotency_key='adjust:' || p_idempotency_key;
  if found then
    select * into v_wallet from public.wallet_accounts where user_id=p_user_id;
    return jsonb_build_object('ledgerId',v_existing.id,'balanceCents',v_wallet.balance_cents,'reused',true);
  end if;
  select * into v_wallet from public.wallet_accounts where user_id=p_user_id for update;
  if not found then raise exception 'Wallet unavailable'; end if;
  if v_wallet.balance_cents+p_amount_cents<0 then raise exception 'Wallet cannot be negative'; end if;
  update public.wallet_accounts set balance_cents=balance_cents+p_amount_cents,updated_at=now() where user_id=p_user_id returning * into v_wallet;
  insert into public.wallet_ledger(user_id,entry_type,amount_cents,description,idempotency_key)
  values(p_user_id,'admin_adjustment',p_amount_cents,left(p_reason,250),'adjust:' || p_idempotency_key)
  returning * into v_existing;
  return jsonb_build_object('ledgerId',v_existing.id,'balanceCents',v_wallet.balance_cents,'reused',false);
end;
$$;

create or replace function public.admin_set_order_status(
  p_admin_id uuid,
  p_order_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin_role text;
  v_order public.orders%rowtype;
  v_old text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  select role into v_admin_role from public.profiles where id=p_admin_id;
  if v_admin_role <> 'admin' then raise exception 'Administrator required'; end if;
  if p_status not in ('pending','in_review','in_progress','completed','cancelled') then raise exception 'Invalid status'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  v_old := v_order.status;
  update public.orders set status=p_status,updated_at=now() where id=p_order_id returning * into v_order;
  insert into public.order_events(order_id,actor_id,old_status,new_status,note)
  values(p_order_id,p_admin_id,v_old,p_status,left(coalesce(p_note,''),250));
  return jsonb_build_object('id',v_order.id,'status',v_order.status,'updatedAt',v_order.updated_at);
end;
$$;

revoke all on function public.create_order_with_debit(uuid,uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.adjust_wallet_balance(uuid,uuid,bigint,text,text) from public, anon, authenticated;
revoke all on function public.admin_set_order_status(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.create_order_with_debit(uuid,uuid,integer,text,text) to service_role;
grant execute on function public.adjust_wallet_balance(uuid,uuid,bigint,text,text) to service_role;
grant execute on function public.admin_set_order_status(uuid,uuid,text,text) to service_role;

alter table public.profiles enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.order_events enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.provider_registry enable row level security;

drop policy if exists profile_read_self on public.profiles;
create policy profile_read_self on public.profiles for select to authenticated using (id=auth.uid());
drop policy if exists wallet_read_self on public.wallet_accounts;
create policy wallet_read_self on public.wallet_accounts for select to authenticated using (user_id=auth.uid());
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select to anon,authenticated using (active=true);
drop policy if exists orders_read_self on public.orders;
create policy orders_read_self on public.orders for select to authenticated using (user_id=auth.uid());
drop policy if exists ledger_read_self on public.wallet_ledger;
create policy ledger_read_self on public.wallet_ledger for select to authenticated using (user_id=auth.uid());
drop policy if exists events_read_own_order on public.order_events;
create policy events_read_own_order on public.order_events for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and o.user_id=auth.uid()));
drop policy if exists tickets_read_self on public.support_tickets;
create policy tickets_read_self on public.support_tickets for select to authenticated using (user_id=auth.uid());
drop policy if exists tickets_insert_self on public.support_tickets;
create policy tickets_insert_self on public.support_tickets for insert to authenticated with check (user_id=auth.uid());
drop policy if exists messages_read_own_ticket on public.support_messages;
create policy messages_read_own_ticket on public.support_messages for select to authenticated using (exists(select 1 from public.support_tickets t where t.id=ticket_id and t.user_id=auth.uid()));
drop policy if exists messages_insert_own_ticket on public.support_messages;
create policy messages_insert_own_ticket on public.support_messages for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.support_tickets t where t.id=ticket_id and t.user_id=auth.uid()));
drop policy if exists provider_read_admin on public.provider_registry;
create policy provider_read_admin on public.provider_registry for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

grant select on public.services to anon, authenticated;
grant select on public.profiles, public.wallet_accounts, public.orders, public.wallet_ledger, public.order_events, public.support_tickets, public.support_messages, public.provider_registry to authenticated;
grant all on public.profiles, public.wallet_accounts, public.services, public.orders, public.wallet_ledger, public.order_events, public.support_tickets, public.support_messages, public.provider_registry to service_role;
