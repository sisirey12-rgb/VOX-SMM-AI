begin;
alter table public.voxx_orders add column submission_rejected boolean not null default false;
create table public.voxx_order_events(
 seq bigint generated always as identity primary key,
 order_id uuid not null references public.voxx_orders(id) on delete cascade,
 owner_id uuid not null, observed_at timestamptz not null, stage text not null,
 submitted bigint not null, accepted bigint not null, fulfilled bigint not null,
 status text not null, legacy boolean not null default false
);
create index voxx_events_order_time on public.voxx_order_events(order_id,observed_at,seq);
create index voxx_orders_campaign_graph on public.voxx_orders(campaign_id);
alter table public.voxx_order_events enable row level security;
revoke all on public.voxx_order_events from public,anon,authenticated;
grant select on public.voxx_order_events to authenticated;
create policy read_own_order_events on public.voxx_order_events for select to authenticated using(owner_id=auth.uid() or public.voxx_admin());

create function voxx_private.observe_order(o public.voxx_orders,ts timestamptz,backfilled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare stage_name text; ack bigint:=case when o.provider_id is null then 0 else o.quantity end;
 delivered bigint:=0; label text:=coalesce(o.provider_status,o.state); last_point public.voxx_order_events;
begin
 stage_name:=case
 when lower(coalesce(o.provider_status,''))='completed' and ack>0 then 'completed'
 when lower(coalesce(o.provider_status,''))='partial' and ack>0 then 'partial'
 when lower(coalesce(o.provider_status,o.state)) in ('cancelled','canceled') then 'cancelled'
 when (o.submission_rejected and ack=0) or o.state='Voided' or lower(coalesce(o.provider_status,''))='failed' then 'failed'
 when o.state='Needs reconciliation' then 'uncertain'
 when ack>0 then 'accepted'
 when o.state='Submitting' then 'submitting' else 'pending' end;
 if o.submission_rejected and ack=0 then label:='Provider rejected submission';end if;
 select * into last_point from public.voxx_order_events where order_id=o.id order by seq desc limit 1;
 delivered:=coalesce(last_point.fulfilled,0);
 if stage_name='accepted' and lower(o.provider_status) in ('in progress','processing') and o.remaining between 1 and o.quantity-1 then delivered:=o.quantity-o.remaining;end if;
 if stage_name='completed' then delivered:=o.quantity;
 elsif stage_name='partial' and o.remaining between 0 and o.quantity then delivered:=o.quantity-o.remaining;end if;
 if last_point.seq is not null and (last_point.stage,last_point.submitted,last_point.accepted,last_point.fulfilled,last_point.status)
 is not distinct from (stage_name,ack,ack,delivered,label) then return;end if;
 insert into public.voxx_order_events(order_id,owner_id,observed_at,stage,submitted,accepted,fulfilled,status,legacy)
 values(o.id,o.owner_id,ts,stage_name,ack,ack,delivered,label,backfilled);
end $$;
insert into public.voxx_order_events(order_id,owner_id,observed_at,stage,submitted,accepted,fulfilled,status,legacy)
select id,owner_id,created_at,'pending',0,0,0,'Awaiting review',true from public.voxx_orders;
insert into public.voxx_order_events(order_id,owner_id,observed_at,stage,submitted,accepted,fulfilled,status,legacy)
select id,owner_id,greatest(dispatched_at,created_at),'accepted',quantity,quantity,0,'Submitted',true from public.voxx_orders where provider_id is not null and dispatched_at is not null;
select voxx_private.observe_order(o,greatest(o.created_at,o.updated_at,o.dispatched_at),true) from public.voxx_orders o;
create function voxx_private.track_order() returns trigger language plpgsql security definer set search_path='' as $$
begin perform voxx_private.observe_order(new,case when tg_op='INSERT' then new.created_at else clock_timestamp() end,false);return new;end $$;
create trigger track_order_insert after insert on public.voxx_orders for each row execute function voxx_private.track_order();
create trigger track_order_change after update on public.voxx_orders for each row when (
(old.state,old.provider_id,old.provider_status,old.remaining,old.submission_rejected) is distinct from
(new.state,new.provider_id,new.provider_status,new.remaining,new.submission_rejected)) execute function voxx_private.track_order();

-- Security invoker preserves order, campaign and event row policies. One query for all visible cards.
create function public.voxx_progress(groups uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$
with selected as (
 select o.id,o.quantity,o.created_at,o.campaign_id,g.id as group_id
 from (select distinct unnest(groups) as id) g join public.voxx_orders o on o.id=g.id or o.campaign_id=g.id where cardinality(groups)<=100
), totals as (
 select group_id,sum(quantity) as requested,min(created_at) as created,count(*) as batches from selected group by group_id
), timelines as (
 select o.group_id,jsonb_agg(jsonb_build_object('batch',o.id,'time',e.observed_at,'stage',e.stage,'submitted',e.submitted,'accepted',e.accepted,'completed',e.fulfilled,'status',e.status,'legacy',e.legacy) order by e.observed_at,e.seq) as events
 from selected o join public.voxx_order_events e on e.order_id=o.id group by o.group_id
)
select coalesce(jsonb_object_agg(t.group_id,jsonb_build_object('requested',t.requested,'created',t.created,'batches',t.batches,'campaignState',c.state,'events',l.events)), '{}'::jsonb)
from totals t join timelines l using(group_id) left join public.voxx_campaigns c on c.id=t.group_id
$$;
revoke all on function public.voxx_progress(uuid[]) from public,anon;
grant execute on function public.voxx_progress(uuid[]) to authenticated;
commit;
