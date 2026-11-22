begin;
alter table public.voxx_orders add column aftercare text,add column refill_id text,add column provider_charge numeric,add column provider_currency text,add column start_count bigint;
create function public.voxx_claim_aftercare(order_id uuid,kind text) returns text language plpgsql security definer set search_path='' as $$
declare upstream text;
begin
 update public.voxx_orders o set aftercare=kind||' requested'
 from voxx_private.services s where o.id=order_id and o.provider_id is not null and o.aftercare is null
 and s.source='live' and s.id=o.service_id and s.present and ((kind='cancel' and s.cancel and o.state='Submitted') or (kind='refill' and s.refill and o.provider_status in ('Completed','Partial')))
 returning o.provider_id into upstream;
 return upstream;
end $$;
revoke all on function public.voxx_claim_aftercare(uuid,text) from public,anon,authenticated;
grant execute on function public.voxx_claim_aftercare(uuid,text) to service_role;
create table voxx_private.limits(subject text primary key,window_start timestamptz not null,used int not null);
create function public.voxx_quota(subject_key text,max_calls integer) returns boolean language plpgsql security definer set search_path='' as $$
declare used_now int;
begin
 insert into voxx_private.limits values(subject_key,date_trunc('minute',now()),1) on conflict(subject) do update
 set used=case when voxx_private.limits.window_start=excluded.window_start then voxx_private.limits.used+1 else 1 end,window_start=excluded.window_start
 returning used into used_now;return used_now<=max_calls;
end $$;
revoke all on function public.voxx_quota(text,int) from public,anon,authenticated;
grant execute on function public.voxx_quota(text,int) to service_role;
commit;
