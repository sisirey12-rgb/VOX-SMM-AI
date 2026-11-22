begin;
alter table public.voxx_profiles add column pricing_tier text check(length(pricing_tier) between 1 and 80);
create function public.voxx_assign_tier(person uuid,tier text) returns void language plpgsql security definer set search_path='' as $$
begin if not public.voxx_admin() then raise insufficient_privilege;end if;
update public.voxx_profiles set pricing_tier=nullif(trim(tier),'') where id=person;
if not found then raise exception 'Unknown account';end if;end $$;
revoke all on function public.voxx_assign_tier(uuid,text) from public,anon;
grant execute on function public.voxx_assign_tier(uuid,text) to authenticated;
drop trigger audit_order on public.voxx_orders;
create trigger audit_order_insert after insert on public.voxx_orders for each row execute function voxx_private.audit_change();
create trigger audit_order_change after update on public.voxx_orders for each row when ((old.state,old.provider_status,old.aftercare) is distinct from (new.state,new.provider_status,new.aftercare)) execute function voxx_private.audit_change();
create or replace function voxx_private.retail(s voxx_private.services,default_markup numeric, buyer uuid default auth.uid()) returns numeric language sql stable set search_path='' as $$
select round(greatest(
 s.cost/(1-coalesce((select value from public.voxx_rules where scope='margin' and selector='global'),0)/100),
 coalesce(s.fixed,s.cost*(1+coalesce(
 (select value from public.voxx_rules where scope='service' and selector=s.source||'/'||s.id),
 (select value from public.voxx_rules where scope='category' and selector=s.category),default_markup)/100))*
 (1-coalesce((select value from public.voxx_rules where scope='discount' and selector=coalesce((select coalesce(pricing_tier,role) from public.voxx_profiles where id=buyer),'customer')),0)/100)
),4)
$$;
commit;
