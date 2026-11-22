begin;

create function voxx_private.reserved_order_paise(customer uuid)
returns numeric
language sql stable
set search_path = ''
as $$
  with pending as (
    select total_inr, campaign_id
    from public.voxx_orders
    where owner_id = customer and automatic_release and state = 'Awaiting review'
  )
  select coalesce((select sum(round(total_inr * 100)) from pending), 0)
       + coalesce((
           select sum(round(c.fee_inr * 100))
           from public.voxx_campaigns c
           where c.id in (select campaign_id from pending)
             and not exists (
               select 1 from public.voxx_ledger l where l.reference = 'fee/' || c.id
             )
         ), 0);
$$;

create function voxx_private.require_booking_funds()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare available numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
  select coalesce(sum(paise), 0) into available
  from public.voxx_ledger where owner_id = new.owner_id and mode = 'live';
  if available < voxx_private.reserved_order_paise(new.owner_id) then
    raise exception 'Insufficient available live wallet balance. Add funds and wait for payment confirmation before trying again.';
  end if;
  return null;
end;
$$;

-- Evaluate after all batches have been inserted, in the same booking transaction.
create constraint trigger require_booking_funds
after insert on public.voxx_orders
deferrable initially deferred
for each row
when (new.automatic_release and new.state = 'Awaiting review')
execute function voxx_private.require_booking_funds();

create or replace function public.voxx_claim_order(order_id uuid)
returns setof public.voxx_orders
language plpgsql security definer
set search_path = ''
as $$
declare item public.voxx_orders; customer uuid; available numeric; debit bigint; fee bigint := 0;
begin
  select owner_id into customer from public.voxx_orders where id = order_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(customer::text, 0));

  select * into item from public.voxx_claim_unfunded(order_id);
  if not found then return; end if;

  debit := round(item.total_inr * 100);
  if item.campaign_id is not null and not exists (
    select 1 from public.voxx_ledger where reference = 'fee/' || item.campaign_id
  ) then
    select round(fee_inr * 100) into fee from public.voxx_campaigns where id = item.campaign_id;
  end if;
  select coalesce(sum(paise), 0) into available
  from public.voxx_ledger where owner_id = customer and mode = 'live';
  if not item.automatic_release then
    available := available - voxx_private.reserved_order_paise(customer);
  end if;
  if available < debit + fee then raise exception 'Insufficient live funds'; end if;

  insert into public.voxx_ledger(owner_id, reference, paise, mode)
  values (customer, 'order/' || item.id, -debit, 'live');
  if fee > 0 then
    insert into public.voxx_ledger(owner_id, reference, paise, mode)
    values (customer, 'fee/' || item.campaign_id, -fee, 'live');
  end if;
  return next item;
end;
$$;

commit;
