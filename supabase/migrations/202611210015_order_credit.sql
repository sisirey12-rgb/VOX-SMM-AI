begin;
create table public.voxx_order_credits(order_id uuid primary key references public.voxx_orders,owner_id uuid not null references public.voxx_profiles,paise bigint not null check(paise>0),reason text not null check(length(trim(reason)) between 4 and 500),approved_by uuid not null,created_at timestamptz default now());
alter table public.voxx_order_credits enable row level security;
revoke all on public.voxx_order_credits from public,anon,authenticated;
grant select on public.voxx_order_credits to authenticated;
create policy order_credits_read on public.voxx_order_credits for select to authenticated using(owner_id=auth.uid() or public.voxx_role() in ('super_admin','admin','finance'));
create function public.voxx_credit_order(order_id uuid,amount_paise bigint,reason text) returns void language plpgsql security definer set search_path='' as $$
declare o public.voxx_orders; debit bigint;
begin
 if not public.voxx_admin() then raise insufficient_privilege;end if;
 select * into strict o from public.voxx_orders where id=order_id and state='Closed' and lower(provider_status) in ('partial','canceled','cancelled') for update;
 perform pg_advisory_xact_lock(hashtextextended(o.owner_id::text,0));
 select -paise into strict debit from public.voxx_ledger where reference='order/'||o.id and mode='live';
 if amount_paise is null or amount_paise not between 1 and debit then raise exception 'Credit must be within the original debit';end if;
 insert into public.voxx_order_credits values(o.id,o.owner_id,amount_paise,reason,auth.uid(),now());
 insert into public.voxx_ledger(owner_id,mode,reference,paise) values(o.owner_id,'live','credit/'||o.id,amount_paise);
end $$;
revoke all on function public.voxx_credit_order(uuid,bigint,text) from public,anon;
grant execute on function public.voxx_credit_order(uuid,bigint,text) to authenticated;
create trigger audit_credit after insert on public.voxx_order_credits for each row execute function voxx_private.audit_change();
commit;
