begin;
create table public.voxx_profiles (
 id uuid primary key references auth.users on delete cascade,
 role text not null default 'customer' check(role in ('customer','reseller','support','finance','admin','super_admin')),
 parent_id uuid references public.voxx_profiles,
 display_name text not null default '', created_at timestamptz default now()
);
create function voxx_private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.voxx_profiles(id) values(new.id) on conflict do nothing; return new; end $$;
create trigger voxx_new_user after insert on auth.users for each row execute function voxx_private.create_profile();
insert into public.voxx_profiles(id) select id from auth.users on conflict do nothing;
update public.voxx_profiles set role='admin' where id in(select user_id from voxx_private.admins);
create or replace function public.voxx_admin() returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.voxx_profiles where id=auth.uid() and role in ('super_admin','admin'))
$$;
create function public.voxx_role() returns text language sql stable security definer set search_path='' as $$
select role from public.voxx_profiles where id=auth.uid()
$$;
alter table public.voxx_profiles enable row level security;
revoke all on public.voxx_profiles from public,anon,authenticated;
grant select on public.voxx_profiles to authenticated;
grant update(display_name) on public.voxx_profiles to authenticated;
create policy profile_read on public.voxx_profiles for select to authenticated using(id=auth.uid() or parent_id=auth.uid() or public.voxx_admin());
create policy profile_name on public.voxx_profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create table public.voxx_audit(id bigint generated always as identity primary key,actor uuid,entity text not null,operation text not null,record jsonb,created_at timestamptz not null default now());
alter table public.voxx_audit enable row level security;
revoke all on public.voxx_audit from public,anon,authenticated;
grant select on public.voxx_audit to authenticated;
create policy audit_read on public.voxx_audit for select to authenticated using(public.voxx_admin());
create function voxx_private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.voxx_audit(actor,entity,operation,record) values(auth.uid(),tg_table_name,tg_op,to_jsonb(new)-'target'); return new; end $$;
create trigger audit_order after insert or update on public.voxx_orders for each row when(new.state<>'Submitted') execute function voxx_private.audit_change();
create trigger audit_profile after update on public.voxx_profiles for each row execute function voxx_private.audit_change();
create trigger audit_price after update of fixed,visible on voxx_private.services for each row execute function voxx_private.audit_change();

create table public.voxx_tickets(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users,subject text not null check(length(subject) between 2 and 160),body text not null check(length(body) between 2 and 5000),reply text,state text default 'Open' check(state in ('Open','Closed')),created_at timestamptz default now());
alter table public.voxx_tickets enable row level security;
revoke all on public.voxx_tickets from public,anon,authenticated;
grant select,insert(subject,body),update(reply,state) on public.voxx_tickets to authenticated;
create policy tickets_read on public.voxx_tickets for select to authenticated using(owner_id=auth.uid() or public.voxx_role() in ('admin','super_admin','support'));
create policy tickets_open on public.voxx_tickets for insert to authenticated with check(owner_id=auth.uid());
create policy tickets_reply on public.voxx_tickets for update to authenticated using(public.voxx_role() in ('admin','super_admin','support'));

create function public.voxx_manage_role(person uuid,new_role text,parent uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.voxx_role() is distinct from 'super_admin' or person=auth.uid() then raise insufficient_privilege; end if;
 lock table public.voxx_profiles in share row exclusive mode;
 if new_role not in ('customer','reseller','support','finance','admin','super_admin') then raise exception 'Invalid role'; end if;
 if parent is not null and (not exists(select 1 from public.voxx_profiles where id=parent and role='reseller') or exists(
 with recursive chain as (select id,parent_id from public.voxx_profiles where id=parent union select p.id,p.parent_id from public.voxx_profiles p join chain c on p.id=c.parent_id) select 1 from chain where id=person
 )) then raise exception 'Invalid reseller parent'; end if;
 if new_role<>'reseller' and exists(select 1 from public.voxx_profiles where parent_id=person) then raise exception 'Reassign children first'; end if;
 update public.voxx_profiles set role=new_role,parent_id=parent where id=person;
 if not found then raise exception 'User unavailable'; end if;
end $$;

create table public.voxx_payments(id text primary key,owner_id uuid not null references auth.users,paise bigint not null check(paise between 100 and 10000000),state text default 'Pending',captured_id text unique,created_at timestamptz default now());
create table public.voxx_ledger(id bigint generated always as identity primary key,owner_id uuid not null references auth.users,paise bigint not null,reference text not null unique,created_at timestamptz not null default now());
create table voxx_private.payment_events(id text primary key,created_at timestamptz default now());
alter table public.voxx_payments enable row level security;
alter table public.voxx_ledger enable row level security;
revoke all on public.voxx_payments,public.voxx_ledger from public,anon,authenticated;
grant select on public.voxx_payments,public.voxx_ledger to authenticated;
grant insert,select on public.voxx_payments to service_role;
create policy payments_read on public.voxx_payments for select to authenticated using(owner_id=auth.uid() or public.voxx_role() in ('finance','admin','super_admin'));
create policy ledger_read on public.voxx_ledger for select to authenticated using(owner_id=auth.uid() or public.voxx_role() in ('finance','admin','super_admin'));
create function public.voxx_capture(event_key text, gateway_order text, gateway_payment text, amount_paise bigint) returns void language plpgsql security definer set search_path='' as $$
declare p public.voxx_payments;
begin
 select * into strict p from public.voxx_payments where id=gateway_order for update;
 if amount_paise<>p.paise then raise exception 'Amount mismatch'; end if;
 insert into voxx_private.payment_events(id) values(event_key) on conflict do nothing;
 if not found then return; end if;
 if p.captured_id is not null and p.captured_id<>gateway_payment then raise exception 'Conflicting payment'; end if;
 update public.voxx_payments set state='Captured',captured_id=gateway_payment where id=p.id;
 insert into public.voxx_ledger(owner_id,paise,reference) values(p.owner_id,p.paise,gateway_payment) on conflict(reference) do nothing;
end $$;
create function public.voxx_test_balance() returns numeric language sql stable security definer set search_path='' as $$
select coalesce(sum(paise),0) from public.voxx_ledger where owner_id=auth.uid()
$$;
revoke all on function public.voxx_capture(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.voxx_capture(text,text,text,bigint) to service_role;
revoke all on function public.voxx_manage_role(uuid,text,uuid),public.voxx_role(),public.voxx_test_balance() from public,anon;
grant execute on function public.voxx_manage_role(uuid,text,uuid),public.voxx_role(),public.voxx_test_balance() to authenticated;
commit;
