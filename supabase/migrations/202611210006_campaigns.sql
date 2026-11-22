begin;
create table public.voxx_schedule_rules(service_id bigint primary key,min_minutes int not null check(min_minutes>=1),max_minutes int not null check(max_minutes>=min_minutes),max_runs int not null check(max_runs between 1 and 24),fee_inr numeric(12,2) not null default 0 check(fee_inr>=0),evidence text not null check(length(trim(evidence))>=20),created_at timestamptz default now());
alter table public.voxx_schedule_rules enable row level security;
revoke all on public.voxx_schedule_rules from public,anon,authenticated;
grant select,insert,update,delete on public.voxx_schedule_rules to authenticated;
create policy eligibility on public.voxx_schedule_rules for select to authenticated using(true);
create policy schedule_admin on public.voxx_schedule_rules for all to authenticated using(public.voxx_admin()) with check(public.voxx_admin());
create table public.voxx_campaigns(id uuid primary key,owner_id uuid not null references auth.users,service_id bigint not null,units bigint not null,runs int not null,start_at timestamptz not null,minutes int not null,fee_inr numeric not null,state text not null default 'Review',created_at timestamptz default now());
alter table public.voxx_campaigns enable row level security;
revoke all on public.voxx_campaigns from public,anon,authenticated;
grant select on public.voxx_campaigns to authenticated,service_role;
create policy campaign_read on public.voxx_campaigns for select to authenticated using(owner_id=auth.uid() or public.voxx_admin());
alter table public.voxx_orders add column campaign_id uuid references public.voxx_campaigns,add column due_at timestamptz;
create index campaign_due on public.voxx_orders(due_at) where campaign_id is not null and state='Awaiting review';
create function public.voxx_schedule(service_number bigint,target_url text,units bigint,token uuid,expected_total numeric,start_at timestamptz,minutes integer,runs integer,expected_fee numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare rule public.voxx_schedule_rules; uid uuid:=auth.uid(); child uuid; existing public.voxx_campaigns;
begin
 if uid is null then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into existing from public.voxx_campaigns where id=token;
 if found then
  if existing.owner_id<>uid or (existing.service_id,existing.units,existing.start_at,existing.minutes,existing.runs,existing.fee_inr) is distinct from (service_number,units,start_at,minutes,runs,expected_fee) or not exists(select 1 from public.voxx_orders o where o.campaign_id=token and o.target=target_url and o.total_inr=expected_total) then raise exception 'Campaign key conflict'; end if;return token;
 end if;
 select * into strict rule from public.voxx_schedule_rules r where r.service_id=service_number for share;
 if expected_fee is distinct from rule.fee_inr or minutes not between rule.min_minutes and rule.max_minutes or runs not between 1 and rule.max_runs or start_at<now() then raise exception 'Schedule outside verified limits'; end if;
 insert into public.voxx_campaigns(id,owner_id,service_id,units,runs,start_at,minutes,fee_inr) values(token,uid,service_number,units,runs,start_at,minutes,rule.fee_inr);
 for i in 0..runs-1 loop
  child:=voxx_private.create_order(uid,service_number,target_url,units,gen_random_uuid(),expected_total);
  update public.voxx_orders set campaign_id=token,due_at=start_at+i*make_interval(mins=>minutes) where id=child;
 end loop;
 return token;
end $$;
create function public.voxx_campaign_state(campaign uuid,action text) returns void language plpgsql security definer set search_path='' as $$
declare c public.voxx_campaigns;
begin
 select * into strict c from public.voxx_campaigns where id=campaign for update;
 if c.owner_id<>auth.uid() and not public.voxx_admin() then raise insufficient_privilege; end if;
 if action='approve' and public.voxx_admin() and c.state='Review' then update public.voxx_campaigns set state='Active' where id=campaign;
 elsif action='pause' and c.state='Active' then update public.voxx_campaigns set state='Paused' where id=campaign;
 elsif action='resume' and c.state='Paused' then
  with pending as(select id,row_number() over(order by due_at,id)-1 as offset_no from public.voxx_orders where campaign_id=campaign and state='Awaiting review')
  update public.voxx_orders o set due_at=greatest(o.due_at,now()+p.offset_no*make_interval(mins=>c.minutes)) from pending p where o.id=p.id;
  update public.voxx_campaigns set state='Active' where id=campaign;
 elsif action='cancel' and c.state in ('Review','Active','Paused') then
  update public.voxx_campaigns set state='Canceled' where id=campaign;
  update public.voxx_orders set state='Canceled' where campaign_id=campaign and state='Awaiting review';
 else raise exception 'Invalid campaign transition';end if;
end $$;
alter function public.voxx_claim_order(uuid) rename to voxx_claim_legacy;
revoke all on function public.voxx_claim_legacy(uuid) from service_role,public,authenticated,anon;
create function public.voxx_claim_order(order_id uuid) returns setof public.voxx_orders language plpgsql security definer set search_path='' as $$
declare c public.voxx_campaigns; o public.voxx_orders;
begin
 select * into o from public.voxx_orders where id=order_id;
 if o.campaign_id is not null then
  select * into c from public.voxx_campaigns where id=o.campaign_id for update;
  if c.state<>'Active' or o.due_at>now() or not exists(select 1 from public.voxx_schedule_rules r where r.service_id=o.service_id and c.minutes between r.min_minutes and r.max_minutes and c.runs<=r.max_runs) then return; end if;
  -- Respect spacing after a worker outage and block later runs during reconciliation.
  if exists(select 1 from public.voxx_orders x where x.campaign_id=c.id and x.id<>o.id and
    ((x.due_at<o.due_at and x.state='Awaiting review') or x.state in ('Submitting','Needs reconciliation') or (x.provider_id is not null and x.dispatched_at>now()-make_interval(mins=>c.minutes)))) then return;end if;
 end if;
 return query select * from public.voxx_claim_legacy(order_id);
end $$;
alter table public.voxx_orders add column dispatched_at timestamptz;
revoke all on function public.voxx_claim_order(uuid) from public,anon,authenticated;
grant execute on function public.voxx_claim_order(uuid) to service_role;
revoke all on function public.voxx_schedule(bigint,text,bigint,uuid,numeric,timestamptz,int,int,numeric),public.voxx_campaign_state(uuid,text) from public,anon;
grant execute on function public.voxx_schedule(bigint,text,bigint,uuid,numeric,timestamptz,int,int,numeric),public.voxx_campaign_state(uuid,text) to authenticated;
create trigger audit_campaign after insert or update of state on public.voxx_campaigns for each row execute function voxx_private.audit_change();
commit;
