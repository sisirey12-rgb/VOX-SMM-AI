begin;
create function public.voxx_due() returns table(id uuid) language sql stable security definer set search_path='' as $$
 select o.id from public.voxx_orders o join public.voxx_campaigns c on c.id=o.campaign_id and c.state='Active'
 join public.voxx_schedule_rules r on r.service_id=c.service_id
 join voxx_private.services s on s.id=o.service_id and s.source='live' and s.visible and s.present
 where o.state='Awaiting review' and o.due_at<=now() and c.minutes between r.min_minutes and r.max_minutes and c.runs<=r.max_runs
 and not exists(select 1 from public.voxx_orders prev where prev.campaign_id=c.id and prev.id<>o.id and
 ((prev.due_at<o.due_at and prev.state='Awaiting review') or prev.state in ('Submitting','Needs reconciliation') or prev.dispatched_at>now()-make_interval(mins=>c.minutes)))
 order by o.due_at limit 30
$$;
revoke all on function public.voxx_due() from public,anon,authenticated;
grant execute on function public.voxx_due() to service_role;
create function voxx_private.finish_campaign() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.campaign_id is not null and new.state='Closed' then
 perform 1 from public.voxx_campaigns where id=new.campaign_id for update;
 if not exists(select 1 from public.voxx_orders where campaign_id=new.campaign_id and state not in('Closed','Canceled')) then
 update public.voxx_campaigns set state='Finished' where id=new.campaign_id and state <> 'Canceled'; end if;
 end if;return new;
end $$;
create trigger campaign_finished after update of state on public.voxx_orders for each row execute function voxx_private.finish_campaign();
create table public.voxx_notices(id bigint generated always as identity primary key,title text not null check(length(trim(title)) between 1 and 200),body text not null check(length(trim(body)) between 1 and 4000),created_at timestamptz default now());
alter table public.voxx_notices enable row level security;
revoke all on public.voxx_notices from public,anon,authenticated;
grant select,insert(title,body) on public.voxx_notices to authenticated;
create policy notices_read on public.voxx_notices for select to authenticated using(true);
create policy notices_write on public.voxx_notices for insert to authenticated with check(public.voxx_admin());
commit;
