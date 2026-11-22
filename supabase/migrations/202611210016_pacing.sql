begin;
alter table public.voxx_schedule_rules drop constraint voxx_schedule_rules_max_runs_check;
alter table public.voxx_schedule_rules add check(max_runs between 1 and 240);
create or replace function voxx_private.create_order_part(uid uuid,service_number bigint, target_url text, units bigint, token uuid, expected_total numeric,parent_campaign uuid)
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
 if (select count(distinct coalesce(campaign_id,id)) from public.voxx_orders where owner_id=uid and (parent_campaign is null or campaign_id is distinct from parent_campaign) and created_at>now()-interval '1 hour')>=30 then raise exception 'Hourly order limit'; end if;
 select markup into markup_pct from voxx_private.settings where source='live' for share;
 if not found then raise exception 'Live catalogue required'; end if;
 select * into item from voxx_private.services where source='live' and id=service_number and kind='Default' and visible and present for share;
 if not found or units is null or units<=0 or units not between item.minimum and item.maximum or target_url !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' or length(target_url)>2048 then raise exception 'Service, target or quantity unavailable'; end if;
 rate:=voxx_private.retail(item,markup_pct,uid); total:=round(rate*units/1000,2);
 if total is distinct from expected_total then raise exception 'Price changed. Refresh catalogue.'; end if;
 insert into public.voxx_orders(owner_id,request_key,service_id,service_name,target,quantity,unit_rate,total_inr,campaign_id)
 values(uid,token,service_number,item.name,target_url,units,rate,total,parent_campaign) returning id into order_id;
 return order_id;
end $$;
create or replace function voxx_private.create_order(uid uuid,service_number bigint, target_url text, units bigint, token uuid, expected_total numeric)
returns uuid language sql security definer set search_path='' as $$select voxx_private.create_order_part(uid,service_number,target_url,units,token,expected_total,null)$$;
create table public.voxx_pacing (
 service_id bigint primary key references public.voxx_schedule_rules on delete cascade,
 enabled boolean not null default true,
 slow_hourly integer not null check(slow_hourly between 1 and 1000000000),
 medium_hourly integer not null check(medium_hourly between slow_hourly+1 and 1000000000),
 target_gap integer not null check(target_gap between 1 and 10080),
 batch_min integer not null check(batch_min>=1),
 batch_max integer not null check(batch_max>=batch_min),
 qty_variation int not null check(qty_variation between 0 and 90),
 time_variation int not null check(time_variation between 0 and 90),
 max_duration int not null check(max_duration between 1 and 525600),
 hourly_fee numeric(10,2) not null check(hourly_fee>=0),provider_capacity int check(provider_capacity between 1 and 1000000000)
);
alter table public.voxx_pacing enable row level security;
revoke all on public.voxx_pacing from public,anon,authenticated;
grant select,insert,update on public.voxx_pacing to authenticated;
create policy pacing_read on public.voxx_pacing for select to authenticated using(true);
create policy pacing_admin on public.voxx_pacing for all to authenticated using(public.voxx_admin()) with check(public.voxx_admin());
create trigger audit_pacing after insert or update on public.voxx_pacing for each row execute function voxx_private.audit_change();

-- Seed conservative recommendations for services already verified for multi-run use.
create function voxx_private.seed_pacing(r public.voxx_schedule_rules) returns void language sql security definer set search_path='' as $$
 insert into public.voxx_pacing(service_id,enabled,slow_hourly,medium_hourly,target_gap,batch_min,batch_max,qty_variation,time_variation,max_duration,hourly_fee)
 select s.id,true,greatest(1,least(500000000,ceil(greatest(1,s.minimum)*60.0/r.min_minutes)))::int,
 greatest(2,least(1000000000,ceil(greatest(1,s.maximum)*60.0/r.min_minutes)+1))::int,
 greatest(1,least(10080,r.max_minutes,greatest(30,r.min_minutes))),greatest(1,s.minimum)::int,least(s.maximum,2147483647)::int,
 20,20,least(525600,r.max_minutes::bigint*(r.max_runs-1)),0
 from voxx_private.services s where s.source='live' and s.id=r.service_id and s.kind='Default' and r.max_runs>=2 and s.minimum<=2147483647 and s.maximum>=1
 on conflict do nothing
$$;
select voxx_private.seed_pacing(r) from public.voxx_schedule_rules r;
create function voxx_private.init_pacing() returns trigger language plpgsql security definer set search_path='' as $$
begin perform voxx_private.seed_pacing(new);return new;end $$;
create trigger init_pacing after insert or update on public.voxx_schedule_rules for each row execute function voxx_private.init_pacing();

alter table public.voxx_campaigns add column pacing_quote jsonb;
alter table public.voxx_orders add column gap_minutes int check(gap_minutes>=0);
-- Each draw reserves a feasible remainder. Integer boundaries include unavoidable rounding.
create function voxx_private.split_budget(budget bigint,parts int,minimum bigint,maximum bigint,variation int,seed text)
returns bigint[] language plpgsql immutable strict set search_path='' as $$
declare result bigint[]:='{}'; avg_size numeric:=budget::numeric/parts; left_over bigint:=budget;
 lo bigint:=greatest(minimum,floor(avg_size*(1-variation/100.0)));
 hi bigint:=least(maximum,ceil(avg_size*(1+variation/100.0)));
 low_now bigint;high_now bigint;draw bigint; value_now bigint;
begin
 if parts<1 or lo*parts>budget or hi*parts<budget then raise exception 'Cannot split within the configured limits';end if;
 for i in 1..parts loop
  low_now:=greatest(lo,left_over-(parts-i)*hi);
  high_now:=least(hi,left_over-(parts-i)*lo);
  draw:=('x'||substr(md5(seed||'/'||i),1,12))::bit(48)::bigint;
  value_now:=low_now+mod(draw,high_now-low_now+1);
  result:=array_append(result,value_now);left_over:=left_over-value_now;
 end loop;
 if parts>1 and variation>0 and mod(budget,parts)=0 and lo<avg_size and hi>avg_size and (select min(x)=max(x) from unnest(result) x) then
  result[1]:=result[1]-1;result[parts]:=result[parts]+1;
 end if;
 return result;
end $$;

create function public.voxx_paced_quote(service_number bigint,total_units bigint,pace text,requested_minutes int,seed uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg public.voxx_pacing; limits public.voxx_schedule_rules; item voxx_private.services;
 batch_low bigint;batch_high bigint; hourly int; desired numeric; span int; n int; batches bigint[]; gaps bigint[];
 observed_speed numeric; sample_count int; speed_limit numeric; elapsed int:=0; amount numeric; subtotal numeric:=0; rate numeric; fee numeric; plan jsonb:='[]';markup_value numeric;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 select * into cfg from public.voxx_pacing where service_id=service_number and enabled;
 if not found then raise exception 'Paced scheduling is disabled';end if;
 select * into strict limits from public.voxx_schedule_rules where service_id=service_number;
 select markup into strict markup_value from voxx_private.settings where source='live';
 select * into strict item from voxx_private.services where source='live' and id=service_number and visible and present and kind='Default';
 if pace is null or pace not in ('slow','medium','custom') or total_units is null or total_units not between 2 and 9007199254740991 or seed is null then raise exception 'Invalid quote request';end if;
 batch_low:=greatest(cfg.batch_min,item.minimum,1);batch_high:=least(cfg.batch_max,item.maximum);
 hourly:=case when pace='slow' then cfg.slow_hourly else cfg.medium_hourly end;
 select count(*),percentile_cont(0.5) within group(order by seen.rate) into sample_count,observed_speed from (
 select o.quantity*3600.0/extract(epoch from e.observed_at-o.dispatched_at) as rate from public.voxx_orders o
 join lateral (select min(ev.observed_at) as observed_at from public.voxx_order_events ev where ev.order_id=o.id and ev.stage='completed' and not ev.legacy) e on true
 where o.service_id=service_number and o.dispatched_at>now()-interval '30 days' and e.observed_at>o.dispatched_at
 order by e.observed_at desc limit 32) seen;
 speed_limit:=least(cfg.medium_hourly,coalesce(cfg.provider_capacity,cfg.medium_hourly),case when sample_count>=3 then greatest(1,floor(observed_speed)) else cfg.medium_hourly end);
 hourly:=least(hourly,speed_limit);
 desired:=case when pace='custom' then requested_minutes else ceil(total_units::numeric*60/hourly) end;
 if desired is null or desired<=0 then raise exception 'Choose a duration in minutes';end if;
 -- Find a feasible run count and the closest allowed duration. The fastest allowed
 -- average is the medium rate. A custom duration must be honored exactly.
 with bounds as (
  select k,greatest((k-1)::bigint*limits.min_minutes,ceil(total_units::numeric*60/speed_limit)) as shortest,
   least((k-1)::bigint*limits.max_minutes,cfg.max_duration) as longest
  from generate_series(2,limits.max_runs) k where total_units between k*batch_low and k*batch_high
 ), options as (
  select k,greatest(shortest,least(desired,longest)) as duration from bounds where shortest<=longest and desired<=longest and (pace<>'custom' or desired between shortest and longest)
 )
 select k,duration::int into n,span from options order by abs(duration-desired),abs(duration/(k-1)-cfg.target_gap),k limit 1;
 if not found then raise exception 'No schedule fits this quantity and duration within service limits';end if;
 batches:=voxx_private.split_budget(total_units,n,batch_low,batch_high,cfg.qty_variation,seed||'/units');
 gaps:=voxx_private.split_budget(span,n-1,limits.min_minutes,limits.max_minutes,cfg.time_variation,seed||'/minutes');
 rate:=voxx_private.retail(item,markup_value,auth.uid());
 for i in 1..n loop
  if i>1 then elapsed:=elapsed+gaps[i-1];end if;
  amount:=round(rate*batches[i]/1000,2);subtotal:=subtotal+amount;
  plan:=plan||jsonb_build_array(jsonb_build_object('offset',elapsed,'quantity',batches[i],'amount',amount));
 end loop;
 fee:=limits.fee_inr+round(cfg.hourly_fee*span/60,2);
 return jsonb_build_object('samples',sample_count,'capacity',cfg.provider_capacity,'pace',pace,'duration',span,'quantity',total_units,'hourly',round(total_units::numeric*60/span,2),'rate',rate,'subtotal',subtotal,'baseFee',limits.fee_inr,'hourFee',cfg.hourly_fee,'fee',fee,'total',subtotal+fee,'batches',plan);
end $$;

create function public.voxx_book_paced(service_number bigint,total_units bigint,pace text,requested_minutes int,seed uuid,target_url text,start_time timestamptz,accepted jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); existing public.voxx_campaigns; quote jsonb; batch jsonb; child uuid;delta int;previous_offset int:=0;minimum_gap int;
begin
 if uid is null then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into existing from public.voxx_campaigns where id=seed;
 if found then
  if existing.owner_id=uid and existing.service_id=service_number and existing.start_at=start_time and existing.pacing_quote=accepted and existing.units=total_units and existing.pacing_quote->>'pace'=pace and (pace<>'custom' or requested_minutes=(accepted->>'duration')::int)
   and exists(select 1 from public.voxx_orders o where o.campaign_id=seed and o.target=target_url) then return seed;end if;
  raise exception 'Request ID already used';end if;
 if start_time is null or start_time<now() then raise exception 'Choose a future start time';end if;
 perform 1 from public.voxx_pacing where service_id=service_number for share;
 select min_minutes into strict minimum_gap from public.voxx_schedule_rules where service_id=service_number for share;
 quote:=public.voxx_paced_quote(service_number,total_units,pace,requested_minutes,seed);
 if quote is distinct from accepted then raise exception 'Schedule or price changed. Refresh your quote.';end if;
 insert into public.voxx_campaigns(id,owner_id,service_id,units,runs,start_at,minutes,fee_inr,pacing_quote)
 values(seed,uid,service_number,total_units,jsonb_array_length(quote->'batches'),start_time,minimum_gap,(quote->>'fee')::numeric,quote);
 for batch in select * from jsonb_array_elements(quote->'batches') loop
  child:=voxx_private.create_order_part(uid,service_number,target_url,(batch->>'quantity')::bigint,gen_random_uuid(),(batch->>'amount')::numeric,seed);
  delta:=(batch->>'offset')::int-previous_offset;previous_offset:=(batch->>'offset')::int;
  update public.voxx_orders set campaign_id=seed,gap_minutes=delta,due_at=start_time+make_interval(mins=>previous_offset) where id=child;
 end loop;
 return seed;
end $$;
revoke all on function public.voxx_paced_quote(bigint,bigint,text,int,uuid),public.voxx_book_paced(bigint,bigint,text,int,uuid,text,timestamptz,jsonb) from public,anon;
grant execute on function public.voxx_paced_quote(bigint,bigint,text,int,uuid),public.voxx_book_paced(bigint,bigint,text,int,uuid,text,timestamptz,jsonb) to authenticated;

-- Both the worker and manual admin dispatch use the same eligibility decision.
create function voxx_private.paced_due(o public.voxx_orders,c public.voxx_campaigns,r public.voxx_schedule_rules)
returns boolean language sql stable set search_path='' as $$
select c.state='Active' and o.due_at<=now() and c.runs<=r.max_runs
 and (case when c.pacing_quote is null then c.minutes between r.min_minutes and r.max_minutes
 else (o.gap_minutes=0 or o.gap_minutes between r.min_minutes and r.max_minutes)
 and exists(select 1 from public.voxx_pacing p where p.service_id=c.service_id and p.enabled and o.quantity between p.batch_min and p.batch_max
 and (c.pacing_quote->>'duration')::int<=p.max_duration and c.units::numeric*60<=least(p.medium_hourly,p.provider_capacity)::numeric*(c.pacing_quote->>'duration')::int) end)
 and not exists(select 1 from public.voxx_orders x where x.campaign_id=c.id and x.id<>o.id and
 ((x.due_at<o.due_at and x.state='Awaiting review') or x.state in ('Submitting','Needs reconciliation')
 or x.dispatched_at>now()-make_interval(mins=>coalesce(o.gap_minutes,c.minutes))))
$$;
create or replace function public.voxx_due() returns table(id uuid) language sql stable security definer set search_path='' as $$
 select o.id from public.voxx_orders o join public.voxx_campaigns c on c.id=o.campaign_id
 join public.voxx_schedule_rules r on r.service_id=c.service_id join voxx_private.services s on s.id=o.service_id and s.source='live' and s.present and s.visible
 where o.state='Awaiting review' and voxx_private.paced_due(o,c,r) order by o.due_at limit 30
$$;
create or replace function public.voxx_claim_unfunded(order_id uuid) returns setof public.voxx_orders language plpgsql security definer set search_path='' as $$
declare c public.voxx_campaigns;o public.voxx_orders;r public.voxx_schedule_rules;
begin
 select * into o from public.voxx_orders where id=order_id;
 if o.campaign_id is not null then
  select * into c from public.voxx_campaigns where id=o.campaign_id for update;
  select * into o from public.voxx_orders where id=order_id;
  select * into r from public.voxx_schedule_rules where service_id=o.service_id for share;
  if not found or voxx_private.paced_due(o,c,r) is not true then return;end if;
 end if;
 return query select * from public.voxx_claim_legacy(order_id);
end $$;
create or replace function public.voxx_schedule(service_number bigint,target_url text,units bigint,token uuid,expected_total numeric,start_at timestamptz,minutes integer,runs integer,expected_fee numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare rule public.voxx_schedule_rules; uid uuid:=auth.uid(); child uuid; existing public.voxx_campaigns;
begin
 if uid is null then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into existing from public.voxx_campaigns where id=token;
 if found then
  if existing.owner_id<>uid or (existing.service_id,existing.units,existing.start_at,existing.minutes,existing.runs,existing.fee_inr) is distinct from (service_number,units,start_at,minutes,runs,expected_fee) or not exists(select 1 from public.voxx_orders o where o.campaign_id=token and o.target=target_url and o.total_inr=expected_total) then raise exception 'Campaign key conflict'; end if;return token;
 end if;
 if exists(select 1 from public.voxx_pacing p where service_id=service_number and (not enabled or units not between p.batch_min and p.batch_max or minutes::bigint*(runs-1)>p.max_duration or (runs>1 and units::numeric*runs*60>least(p.medium_hourly,p.provider_capacity)::numeric*minutes*(runs-1)))) then raise exception 'Manual schedule outside pacing limits';end if;
 select * into strict rule from public.voxx_schedule_rules r where r.service_id=service_number for share;
 if expected_fee is distinct from rule.fee_inr or minutes not between rule.min_minutes and rule.max_minutes or runs not between 1 and rule.max_runs or start_at<now() then raise exception 'Schedule outside verified limits'; end if;
 insert into public.voxx_campaigns(id,owner_id,service_id,units,runs,start_at,minutes,fee_inr) values(token,uid,service_number,units,runs,start_at,minutes,rule.fee_inr);
 for i in 0..runs-1 loop
  child:=voxx_private.create_order_part(uid,service_number,target_url,units,gen_random_uuid(),expected_total,token);
  update public.voxx_orders set campaign_id=token,due_at=start_at+i*make_interval(mins=>minutes) where id=child;
 end loop;
 return token;
end $$;
create or replace function public.voxx_campaign_state(campaign uuid,action text) returns void language plpgsql security definer set search_path='' as $$
declare c public.voxx_campaigns;
begin
 select * into strict c from public.voxx_campaigns where id=campaign for update;
 if c.owner_id<>auth.uid() and not public.voxx_admin() then raise insufficient_privilege; end if;
 if action='approve' and public.voxx_admin() and c.state='Review' then update public.voxx_campaigns set state='Active' where id=campaign;
 elsif action='pause' and c.state='Active' then update public.voxx_campaigns set state='Paused' where id=campaign;
 elsif action='resume' and c.state='Paused' then
  with pending as(select id,min(due_at) over() as first_due from public.voxx_orders where campaign_id=campaign and state='Awaiting review')
  update public.voxx_orders o set due_at=o.due_at+greatest(now()-p.first_due,interval '0 seconds') from pending p where o.id=p.id;
  update public.voxx_campaigns set state='Active' where id=campaign;
 elsif action='cancel' and c.state in ('Review','Active','Paused') then
  update public.voxx_campaigns set state='Canceled' where id=campaign;
  update public.voxx_orders set state='Canceled' where campaign_id=campaign and state='Awaiting review';
 else raise exception 'Invalid campaign transition';end if;
end $$;
commit;
