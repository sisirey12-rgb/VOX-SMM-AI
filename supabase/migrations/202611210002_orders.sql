begin;
-- Earlier imports were automatically listed. Require explicit review for existing rows too.
alter table voxx_private.services alter column visible set default false;
update voxx_private.services set visible=false where source='live';
create function voxx_private.review_service() returns trigger language plpgsql as $$
begin
 if new.source='live' and (old.name,old.category,old.kind,old.cost,old.minimum,old.maximum) is distinct from
 (new.name,new.category,new.kind,new.cost,new.minimum,new.maximum) then new.visible=false; end if;
 return new;
end $$;
create trigger service_review before update on voxx_private.services for each row execute function voxx_private.review_service();

create table public.voxx_orders (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users, request_key uuid not null,
 service_id bigint not null, service_name text not null, target text not null, quantity bigint not null check(quantity>0),
 unit_rate numeric not null, total_inr numeric not null, state text not null default 'Awaiting review',
 provider_id text unique, provider_status text, remaining bigint, updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(), unique(owner_id,request_key)
);
alter table public.voxx_orders enable row level security;
revoke all on public.voxx_orders from public,anon,authenticated;
grant select on public.voxx_orders to authenticated;
grant select,update on public.voxx_orders to service_role;
create policy order_read on public.voxx_orders for select to authenticated using(owner_id=auth.uid() or public.voxx_admin());
create index voxx_orders_by_owner on public.voxx_orders(owner_id,created_at desc);
create index voxx_orders_to_poll on public.voxx_orders(updated_at) where state='Submitted';

create function public.voxx_request_order(service_number bigint, target_url text, units bigint, token uuid, expected_total numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); previous public.voxx_orders; item voxx_private.services; markup_pct numeric; rate numeric; total numeric; order_id uuid;
begin
 if uid is null then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into previous from public.voxx_orders where owner_id=uid and request_key=token;
 if found then
   if (previous.service_id,previous.target,previous.quantity) is distinct from (service_number,target_url,units) then raise exception 'Request key conflict'; end if;
   return previous.id;
 end if;
 if (select count(*) from public.voxx_orders where owner_id=uid and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly order limit'; end if;
 select markup into markup_pct from voxx_private.settings where source='live' for share;
 if not found then raise exception 'Live catalogue required'; end if;
 select * into item from voxx_private.services where source='live' and id=service_number and kind='Default' and visible and present for share;
 if not found or units is null or units<=0 or units not between item.minimum and item.maximum or target_url !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' or length(target_url)>2048 then raise exception 'Service, target or quantity unavailable'; end if;
 rate:=coalesce(item.fixed,round(item.cost*(1+markup_pct/100),4)); total:=round(rate*units/1000,2);
 if total is distinct from expected_total then raise exception 'Price changed. Refresh catalogue.'; end if;
 insert into public.voxx_orders(owner_id,request_key,service_id,service_name,target,quantity,unit_rate,total_inr)
 values(uid,token,service_number,item.name,target_url,units,rate,total) returning id into order_id;
 return order_id;
end $$;
revoke all on function public.voxx_request_order(bigint,text,bigint,uuid,numeric) from public,anon;
grant execute on function public.voxx_request_order(bigint,text,bigint,uuid,numeric) to authenticated;

create function public.voxx_claim_order(order_id uuid) returns setof public.voxx_orders language sql security definer set search_path='' as $$
 update public.voxx_orders o set state='Submitting',updated_at=now()
 from voxx_private.services s,voxx_private.settings cfg
 where o.id=order_id and o.state='Awaiting review' and cfg.source='live' and s.source=cfg.source and s.id=o.service_id and s.visible and s.present
 and s.kind='Default' and s.name=o.service_name and o.quantity between s.minimum and s.maximum
 returning o.*;
$$;
revoke all on function public.voxx_claim_order(uuid) from public,anon,authenticated;
grant execute on function public.voxx_claim_order(uuid) to service_role;
commit;
