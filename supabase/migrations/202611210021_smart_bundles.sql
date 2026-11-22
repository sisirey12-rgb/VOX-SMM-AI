begin;

create table public.voxx_bundle_categories (
  category text primary key,
  platform text not null check (platform ~ '^[a-z0-9][a-z0-9 -]{0,49}$')
);
create table public.voxx_bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  platform text not null check (platform ~ '^[a-z0-9][a-z0-9 -]{0,49}$'),
  components jsonb not null check (
    jsonb_typeof(components) = 'array' and jsonb_array_length(components) between 2 and 6
  )
);
create table voxx_private.bundle_bookings (
  id uuid primary key,
  owner_id uuid not null references auth.users,
  bundle_id uuid not null,
  target text not null,
  start_at timestamptz not null,
  quote jsonb not null
);
alter table public.voxx_campaigns add column bundle_booking_id uuid
  references voxx_private.bundle_bookings(id);
create index campaign_bundle_booking on public.voxx_campaigns(bundle_booking_id)
  where bundle_booking_id is not null;

alter table public.voxx_bundle_categories enable row level security;
alter table public.voxx_bundles enable row level security;
revoke all on public.voxx_bundle_categories, public.voxx_bundles from public, anon, authenticated;
grant select, insert, update, delete on public.voxx_bundle_categories, public.voxx_bundles to authenticated;
create policy bundle_categories_admin on public.voxx_bundle_categories
  for all to authenticated using (public.voxx_admin()) with check (public.voxx_admin());
create policy bundles_read on public.voxx_bundles for select to authenticated using (true);
create policy bundles_admin on public.voxx_bundles
  for all to authenticated using (public.voxx_admin()) with check (public.voxx_admin());

create function voxx_private.bundle_services(platform_name text, configured jsonb)
returns table(service_id bigint, quantity bigint, name text)
language plpgsql stable set search_path = ''
as $$
begin
  return query
  select s.id, part.quantity, s.name
  from jsonb_to_recordset(configured) as part(service_id bigint, quantity bigint)
  join voxx_private.services s
    on s.id = part.service_id and s.source = 'live' and s.present and s.visible and s.kind = 'Default'
  join public.voxx_bundle_categories c on c.category = s.category and c.platform = platform_name
  where part.quantity > 0;
end;
$$;

create function voxx_private.validate_bundle()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare valid_count int;
begin
  select count(distinct part.service_id) into valid_count
  from voxx_private.bundle_services(new.platform, new.components) part;
  if valid_count <> jsonb_array_length(new.components) then
    raise exception 'Choose distinct, listed services assigned to the same platform.';
  end if;
  return new;
end;
$$;
create trigger validate_bundle before insert or update on public.voxx_bundles
for each row execute function voxx_private.validate_bundle();

create function public.voxx_bundle_quote(bundle uuid, pace text, minutes int, seed uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare entry public.voxx_bundles; part record; plan jsonb; parts jsonb := '[]'; total numeric := 0; duration int := 0;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if seed is null or pace is null or pace not in ('slow','medium','custom') then
    raise exception 'Choose a valid bundle pace.';
  end if;
  select * into strict entry from public.voxx_bundles where id = bundle;
  for part in select * from voxx_private.bundle_services(entry.platform, entry.components) order by service_id loop
    plan := public.voxx_paced_quote(part.service_id, part.quantity, pace, minutes,
      md5(seed::text || '/' || part.service_id)::uuid);
    parts := parts || jsonb_build_array(jsonb_build_object(
      'service_id', part.service_id, 'quantity', part.quantity, 'name', part.name, 'plan', plan));
    total := total + (plan->>'total')::numeric;
    duration := greatest(duration, (plan->>'duration')::int);
  end loop;
  if jsonb_array_length(parts) <> jsonb_array_length(entry.components) then
    raise exception 'A bundle service is no longer available on this platform.';
  end if;
  return jsonb_build_object('name', entry.name, 'platform', entry.platform, 'pace', pace, 'minutes', minutes, 'parts', parts, 'total', total, 'duration', duration);
end;
$$;

create function public.voxx_book_bundle(bundle uuid, seed uuid, target_url text, start_time timestamptz, accepted jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare customer uuid := auth.uid(); previous voxx_private.bundle_bookings; current_quote jsonb; part jsonb; child uuid;
begin
  if customer is null then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(customer::text, 0));
  select * into previous from voxx_private.bundle_bookings where id = seed;
  if found then
    if (previous.owner_id, previous.bundle_id, previous.target, previous.start_at, previous.quote)
       is not distinct from (customer, bundle, target_url, start_time, accepted) then return seed; end if;
    raise exception 'Bundle booking ID already used.';
  end if;

  -- Keep the active catalogue and platform assignments stable during booking.
  perform 1 from voxx_private.settings where singleton for share;
  perform 1 from public.voxx_bundles where id = bundle for share;
  perform 1 from public.voxx_bundle_categories c
    join public.voxx_bundles b on b.platform = c.platform where b.id = bundle for share of c;
  current_quote := public.voxx_bundle_quote(bundle, accepted->>'pace', (accepted->>'minutes')::int, seed);
  if current_quote is distinct from accepted then raise exception 'Bundle quote changed. Refresh it and try again.'; end if;
  insert into voxx_private.bundle_bookings values (seed, customer, bundle, target_url, start_time, current_quote);

  for part in select value from jsonb_array_elements(current_quote->'parts') loop
    child := md5(seed::text || '/' || (part->>'service_id'))::uuid;
    if exists (select 1 from public.voxx_campaigns where id = child) then
      raise exception 'Bundle component booking ID already used.';
    end if;
    perform public.voxx_book_paced(
      (part->>'service_id')::bigint, (part->>'quantity')::bigint, current_quote->>'pace',
      (current_quote->>'minutes')::int, child,
      target_url, start_time, part->'plan');
    update public.voxx_campaigns set bundle_booking_id = seed where id = child;
  end loop;
  return seed;
end;
$$;

create function public.voxx_due_batches()
returns table(id uuid, bundle_id uuid)
language sql stable security definer set search_path = ''
as $$
  with selected as (
    select due.id, c.bundle_booking_id, coalesce(o.due_at, o.created_at) as due_at
    from public.voxx_due() due
    join public.voxx_orders o on o.id = due.id
    left join public.voxx_campaigns c on c.id = o.campaign_id
  ), selected_bundles as (
    select distinct bundle_booking_id from selected where bundle_booking_id is not null
  ), complete_groups as (
    select o.id, c.bundle_booking_id, o.due_at
    from selected_bundles b
    join public.voxx_campaigns c on c.bundle_booking_id = b.bundle_booking_id
    join public.voxx_orders o on o.campaign_id = c.id
    join public.voxx_schedule_rules r on r.service_id = c.service_id
    join voxx_private.services s on s.id = o.service_id and s.source = 'live' and s.present and s.visible
    where o.state = 'Awaiting review' and voxx_private.paced_due(o, c, r)
      and (
        select coalesce(sum(l.paise), 0) from public.voxx_ledger l
        where l.owner_id = o.owner_id and l.mode = 'live'
      ) >= round(o.total_inr * 100) + case
        when not exists (select 1 from public.voxx_ledger l where l.reference = 'fee/' || c.id)
          then round(c.fee_inr * 100)
        else 0
      end
  )
  select batch.id, batch.bundle_booking_id
  from (select * from selected union select * from complete_groups) batch
  order by batch.due_at, batch.id;
$$;

create function public.voxx_my_bundles()
returns table(id uuid, name text, start_at timestamptz, components jsonb)
language sql stable security definer set search_path = ''
as $$
  select b.id, b.quote->>'name', b.start_at,
    jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', part->>'name',
      'state', c.state
    ) order by c.service_id)
  from voxx_private.bundle_bookings b
  join public.voxx_campaigns c on c.bundle_booking_id = b.id and c.owner_id = b.owner_id
  cross join lateral jsonb_array_elements(b.quote->'parts') part
  where b.owner_id = auth.uid() and (part->>'service_id')::bigint = c.service_id
  group by b.id
  order by b.start_at desc, b.id
  limit 50;
$$;

revoke all on function public.voxx_my_bundles() from public, anon, authenticated;
grant execute on function public.voxx_my_bundles() to authenticated;

revoke all on function public.voxx_bundle_quote(uuid,text,int,uuid),
  public.voxx_book_bundle(uuid,uuid,text,timestamptz,jsonb), public.voxx_due_batches()
  from public, anon, authenticated;
grant execute on function public.voxx_bundle_quote(uuid,text,int,uuid),
  public.voxx_book_bundle(uuid,uuid,text,timestamptz,jsonb) to authenticated;
grant execute on function public.voxx_due_batches() to service_role;

commit;
