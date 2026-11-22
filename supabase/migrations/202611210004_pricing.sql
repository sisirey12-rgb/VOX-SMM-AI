begin;
create table public.voxx_rules (
 scope text not null check(scope in ('category','service','discount','margin')), selector text not null check(length(selector) between 1 and 250),
 value numeric not null check(value between 0 and 1000 and (scope not in ('discount','margin') or value<100)),primary key(scope,selector),
 created_at timestamptz default now()
);
alter table public.voxx_rules enable row level security;
revoke all on public.voxx_rules from public,anon,authenticated;
grant select,insert,update,delete on public.voxx_rules to authenticated;
create policy rules_admin on public.voxx_rules for all to authenticated using(public.voxx_admin()) with check(public.voxx_admin());
create trigger audit_rule after insert or update on public.voxx_rules for each row execute function voxx_private.audit_change();
create function voxx_private.retail(s voxx_private.services,default_markup numeric, buyer uuid default auth.uid()) returns numeric language sql stable set search_path='' as $$
select round(greatest(
 s.cost/(1-coalesce((select value from public.voxx_rules where scope='margin' and selector='global'),0)/100),
 coalesce(s.fixed,s.cost*(1+coalesce(
 (select value from public.voxx_rules where scope='service' and selector=s.source||'/'||s.id),
 (select value from public.voxx_rules where scope='category' and selector=s.category),default_markup)/100))*
 (1-coalesce((select value from public.voxx_rules where scope='discount' and selector=coalesce((select role from public.voxx_profiles where id=buyer),'customer')),0)/100)
),4)
$$;
create table public.voxx_sync_log(id bigint generated always as identity primary key,imported integer not null,created_at timestamptz default now());
alter table public.voxx_sync_log enable row level security;
revoke all on public.voxx_sync_log from public,anon,authenticated;
grant select on public.voxx_sync_log to authenticated;
create policy sync_admin on public.voxx_sync_log for select to authenticated using(public.voxx_admin());
create or replace function public.voxx_catalogue(manage boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if manage and not public.voxx_admin() then raise insufficient_privilege; end if;
 select jsonb_build_object('source',cfg.source,'markup',case when manage then cfg.markup end,'items',coalesce((
 select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'type',s.kind,'min',s.minimum,'max',s.maximum,'refill',s.refill,'cancel',s.cancel,'price',voxx_private.retail(s,cfg.markup)) ||
 case when manage then jsonb_build_object('cost',s.cost,'fixed',s.fixed,'visible',s.visible) else '{}'::jsonb end order by s.category,s.name,s.id)
 from voxx_private.services s where s.source=cfg.source and s.present and (manage or s.visible)
 ),'[]'::jsonb)) into result from voxx_private.settings cfg;
 return result;
end $$;
create or replace function public.voxx_publish(rows jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)=0 then raise exception 'Invalid snapshot'; end if;
 perform 1 from voxx_private.settings for update;
 update voxx_private.services s set present=false,visible=false where source='live' and present and not exists(select 1 from jsonb_array_elements(rows) r where (r->>'service')::bigint=s.id);
 insert into voxx_private.services(source,id,name,category,kind,cost,minimum,maximum,refill,cancel)
 select 'live',service,name,category,type,rate,min,max,refill,cancel from jsonb_to_recordset(rows)
 as t(service bigint,name text,category text,type text,rate numeric,min bigint,max bigint,refill boolean,cancel boolean)
 on conflict(source,id) do update set name=excluded.name,category=excluded.category,kind=excluded.kind,cost=excluded.cost,minimum=excluded.minimum,maximum=excluded.maximum,refill=excluded.refill,cancel=excluded.cancel,present=true;
 insert into public.voxx_sync_log(imported) values(jsonb_array_length(rows));
 update voxx_private.settings set source='live';
end $$;
create or replace function voxx_private.create_order(uid uuid,service_number bigint, target_url text, units bigint, token uuid, expected_total numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.voxx_orders; item voxx_private.services; markup_pct numeric; rate numeric; total numeric; order_id uuid;
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
 rate:=voxx_private.retail(item,markup_pct,uid); total:=round(rate*units/1000,2);
 if total is distinct from expected_total then raise exception 'Price changed. Refresh catalogue.'; end if;
 insert into public.voxx_orders(owner_id,request_key,service_id,service_name,target,quantity,unit_rate,total_inr)
 values(uid,token,service_number,item.name,target_url,units,rate,total) returning id into order_id;
 return order_id;
end $$;
create or replace function public.voxx_request_order(service_number bigint,target_url text,units bigint,token uuid,expected_total numeric) returns uuid language sql security definer set search_path='' as $$ select voxx_private.create_order(auth.uid(),service_number,target_url,units,token,expected_total) $$;
create function public.voxx_reseller_order(owner uuid,service_number bigint,target_url text,units bigint,token uuid,expected_total numeric) returns uuid language sql security definer set search_path='' as $$select voxx_private.create_order(owner,service_number,target_url,units,token,expected_total)$$;
revoke all on function public.voxx_reseller_order(uuid,bigint,text,bigint,uuid,numeric) from public,anon,authenticated;
grant execute on function public.voxx_reseller_order(uuid,bigint,text,bigint,uuid,numeric) to service_role;
commit;
