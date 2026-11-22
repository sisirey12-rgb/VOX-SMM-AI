begin;
create or replace function public.voxx_role() returns text language sql stable security definer set search_path='' as $$
select case when p.role in ('super_admin','admin','support','finance','reseller')
 and exists(select 1 from auth.mfa_factors f where f.user_id=p.id and f.status='verified')
 and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then 'customer' else p.role end
 from public.voxx_profiles p where p.id=auth.uid()
$$;
create or replace function public.voxx_admin() returns boolean language sql stable security definer set search_path='' as $$
select coalesce(public.voxx_role() in ('super_admin','admin'),false)
$$;
commit;
