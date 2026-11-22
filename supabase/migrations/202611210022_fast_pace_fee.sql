begin;

alter table public.voxx_pacing
  add column fast_pace_fee numeric(10,2) not null default 0 check (fast_pace_fee >= 0);
alter table public.voxx_pacing alter column hourly_fee set default 0;

-- Allocate the rounded service total across batches.
create or replace function voxx_private.create_order_part(uid uuid,service_number bigint, target_url text, units bigint, token uuid, expected_total numeric,parent_campaign uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.voxx_orders; item voxx_private.services; markup_pct numeric; rate numeric; total numeric; previous_units numeric; order_id uuid;
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
 rate:=voxx_private.retail(item,markup_pct,uid);
 if exists (select 1 from public.voxx_campaigns where id=parent_campaign and owner_id=uid and pacing_quote is not null) then
  select coalesce(sum(quantity),0) into previous_units from public.voxx_orders where campaign_id=parent_campaign;
  total:=round(rate*(previous_units+units)/1000,2)-round(rate*previous_units/1000,2);
 else
  total:=round(rate*units/1000,2);
 end if;
 if total is distinct from expected_total then raise exception 'Price changed. Refresh catalogue.'; end if;
 insert into public.voxx_orders(owner_id,request_key,service_id,service_name,target,quantity,unit_rate,total_inr,campaign_id)
 values(uid,token,service_number,item.name,target_url,units,rate,total,parent_campaign) returning id into order_id;
 return order_id;
end $$;

create or replace function public.voxx_paced_quote(service_number bigint,total_units bigint,pace text,requested_minutes int,seed uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg public.voxx_pacing; limits public.voxx_schedule_rules; item voxx_private.services;
 batch_low bigint;batch_high bigint; hourly int; desired numeric; span int; n int; batches bigint[]; gaps bigint[];
 observed_speed numeric; sample_count int; speed_limit numeric; elapsed int:=0; amount numeric; subtotal numeric:=0; allocated_units bigint:=0; rate numeric; fee numeric; fast_fee numeric:=0; plan jsonb:='[]';markup_value numeric;
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
  allocated_units:=allocated_units+batches[i];
  amount:=round(rate*allocated_units/1000,2)-subtotal;
  subtotal:=subtotal+amount;
  plan:=plan||jsonb_build_array(jsonb_build_object('offset',elapsed,'quantity',batches[i],'amount',amount));
 end loop;
 -- Charge once when the actual schedule exceeds the effective Slow target.
 if pace<>'slow' and span<ceil(total_units::numeric*60/least(cfg.slow_hourly,speed_limit)) then
  fast_fee:=cfg.fast_pace_fee;
 end if;
 fee:=limits.fee_inr+fast_fee;
 return jsonb_build_object('samples',sample_count,'capacity',cfg.provider_capacity,'pace',pace,'duration',span,'quantity',total_units,'hourly',round(total_units::numeric*60/span,2),'rate',rate,'subtotal',subtotal,'baseFee',limits.fee_inr,'hourFee',0,'fastFee',fast_fee,'fee',fee,'total',subtotal+fee,'batches',plan);
end $$;

commit;
