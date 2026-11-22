begin;
alter table public.voxx_payments add column mode text not null default 'test' check(mode in ('test','live'));
alter table public.voxx_ledger add column mode text not null default 'test' check(mode in ('test','live'));
create index ledger_balance on public.voxx_ledger(owner_id,mode);
create function public.voxx_balance(wallet_mode text) returns numeric language sql stable security definer set search_path='' as $$
select coalesce(sum(paise),0) from public.voxx_ledger where owner_id=auth.uid() and mode=wallet_mode
$$;
revoke all on function public.voxx_balance(text) from public,anon;
grant execute on function public.voxx_balance(text) to authenticated;
create or replace function public.voxx_test_balance() returns numeric language sql stable security definer set search_path='' as $$ select public.voxx_balance('test') $$;
create or replace function public.voxx_capture(event_key text,gateway_order text,gateway_payment text,amount_paise bigint) returns void language plpgsql security definer set search_path='' as $$
declare p public.voxx_payments;
begin
 select * into strict p from public.voxx_payments where id=gateway_order for update;
 if amount_paise is distinct from p.paise then raise exception 'Amount mismatch'; end if;
 insert into voxx_private.payment_events(id) values(event_key) on conflict do nothing;
 if not found then return; end if;
 if p.captured_id is not null and p.captured_id<>gateway_payment then raise exception 'Conflicting payment'; end if;
 if p.captured_id is null then update public.voxx_payments set state='Captured',captured_id=gateway_payment where id=p.id;end if;
 insert into public.voxx_ledger(owner_id,paise,reference,mode) values(p.owner_id,p.paise,gateway_payment,p.mode) on conflict(reference) do nothing;
end $$;
create table voxx_private.refunds(id text primary key,payment text not null,paise bigint not null check(paise>0));
create function public.voxx_refund(refund_id text,payment_id text,amount_paise bigint) returns void language plpgsql security definer set search_path='' as $$
declare p public.voxx_payments; refunded bigint;
begin
 select * into strict p from public.voxx_payments where captured_id=payment_id for update;
 perform pg_advisory_xact_lock(hashtextextended(p.owner_id::text,0));
 insert into voxx_private.refunds values(refund_id,payment_id,amount_paise) on conflict do nothing;if not found then return;end if;
 select sum(paise) into refunded from voxx_private.refunds where payment=payment_id;
 if refunded>p.paise then raise exception 'Refund exceeds capture';end if;
 insert into public.voxx_ledger(owner_id,reference,paise,mode) values(p.owner_id,refund_id,-amount_paise,p.mode);
 update public.voxx_payments set state=case when refunded=p.paise then 'Refunded' else 'Partially refunded' end where id=p.id;
end $$;
revoke all on function public.voxx_refund(text,text,bigint) from public,anon,authenticated;
grant execute on function public.voxx_refund(text,text,bigint) to service_role;
alter function public.voxx_claim_order(uuid) rename to voxx_claim_unfunded;
revoke all on function public.voxx_claim_unfunded(uuid) from service_role,public,authenticated,anon;
create function public.voxx_claim_order(order_id uuid) returns setof public.voxx_orders language plpgsql security definer set search_path='' as $$
declare item public.voxx_orders; available numeric; debit bigint; fee bigint:=0;
begin
 select * into item from public.voxx_claim_unfunded(order_id);
 if not found then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(item.owner_id::text,0));
 debit:=round(item.total_inr*100);
 if item.campaign_id is not null and not exists(select 1 from public.voxx_ledger where reference='fee/'||item.campaign_id) then
 select round(fee_inr*100) into fee from public.voxx_campaigns where id=item.campaign_id;end if;
 select coalesce(sum(paise),0) into available from public.voxx_ledger where owner_id=item.owner_id and mode='live';
 if available<debit+fee then raise exception 'Insufficient live funds';end if;
 insert into public.voxx_ledger(owner_id,reference,paise,mode) values(item.owner_id,'order/'||item.id,-debit,'live');
 if fee>0 then insert into public.voxx_ledger(owner_id,reference,paise,mode) values(item.owner_id,'fee/'||item.campaign_id,-fee,'live'); end if;
 return next item;
end $$;
revoke all on function public.voxx_claim_order(uuid) from public,anon,authenticated;
grant execute on function public.voxx_claim_order(uuid) to service_role;

create function public.voxx_resolve_order(order_id uuid,upstream_id text,confirmed_absent boolean) returns void language plpgsql security definer set search_path='' as $$
declare o public.voxx_orders; debit public.voxx_ledger; fee public.voxx_ledger;
begin
 if not public.voxx_admin() then raise insufficient_privilege;end if;
 select * into strict o from public.voxx_orders where id=order_id and (state='Needs reconciliation' or (state='Submitting' and updated_at<now()-interval '15 minutes')) for update;
 perform pg_advisory_xact_lock(hashtextextended(o.owner_id::text,0));
 if confirmed_absent and upstream_id is null then
 select * into debit from public.voxx_ledger where reference='order/'||o.id;
 if found then insert into public.voxx_ledger(owner_id,reference,paise,mode) values(o.owner_id,'reversal/'||o.id,-debit.paise,'live');end if;
 update public.voxx_orders set state='Voided',updated_at=now() where id=o.id;
 if o.campaign_id is not null then
 update public.voxx_campaigns set state='Canceled' where id=o.campaign_id;
 update public.voxx_orders set state='Canceled' where campaign_id=o.campaign_id and state='Awaiting review';
 if not exists(select 1 from public.voxx_orders where campaign_id=o.campaign_id and state not in ('Voided','Canceled')) then
 select * into fee from public.voxx_ledger where reference='fee/'||o.campaign_id;
 if found then insert into public.voxx_ledger(owner_id,reference,paise,mode) values(o.owner_id,'fee-reversal/'||o.campaign_id,-fee.paise,'live') on conflict(reference) do nothing;end if;end if;end if;
 elsif not confirmed_absent and upstream_id ~ '^[1-9][0-9]*$' then
 update public.voxx_orders set provider_id=upstream_id,state='Submitted',updated_at=now(),dispatched_at=now() where id=o.id;
 else raise exception 'Confirm provider outcome';end if;
end $$;
revoke all on function public.voxx_resolve_order(uuid,text,boolean) from public,anon;
grant execute on function public.voxx_resolve_order(uuid,text,boolean) to authenticated;
commit;
