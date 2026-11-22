begin;

-- Existing review orders keep their current workflow.
alter table public.voxx_orders
  add column automatic_release boolean not null default false;
alter table public.voxx_orders
  alter column automatic_release set default true;
alter table public.voxx_campaigns
  alter column state set default 'Active';

create or replace function public.voxx_due()
returns table(id uuid)
language sql stable security definer set search_path = ''
as $$
  select o.id
  from public.voxx_orders o
  join voxx_private.services s
    on s.id = o.service_id and s.source = 'live' and s.present and s.visible
  join voxx_private.settings cfg on cfg.singleton and cfg.source = 'live'
  left join public.voxx_campaigns c on c.id = o.campaign_id
  left join public.voxx_schedule_rules r on r.service_id = c.service_id
  where o.state = 'Awaiting review'
    and (
      (o.campaign_id is null and o.automatic_release)
      or (r.service_id is not null and voxx_private.paced_due(o, c, r))
    )
    and (
      select coalesce(sum(l.paise), 0)
      from public.voxx_ledger l
      where l.owner_id = o.owner_id and l.mode = 'live'
    ) >= round(o.total_inr * 100) + case
      when c.id is not null and not exists (
        select 1 from public.voxx_ledger l where l.reference = 'fee/' || c.id
      ) then round(c.fee_inr * 100)
      else 0
    end
  order by coalesce(o.due_at, o.created_at), o.id
  limit 30;
$$;

commit;
