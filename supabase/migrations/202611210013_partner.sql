begin;
create function public.voxx_reseller_catalogue(owner uuid) returns table(service bigint,name text,category text,type text,minimum bigint,maximum bigint,rate numeric,currency text) language sql stable security definer set search_path='' as $$
select s.id,s.name,s.category,s.kind,s.minimum,s.maximum,voxx_private.retail(s,cfg.markup,owner),'INR' from voxx_private.services s join voxx_private.settings cfg on cfg.source=s.source where s.source='live' and s.visible and s.present order by s.category,s.name,s.id
$$;
revoke all on function public.voxx_reseller_catalogue(uuid) from public,anon,authenticated;
grant execute on function public.voxx_reseller_catalogue(uuid) to service_role;
create function public.voxx_list_api_keys() returns table(id uuid,owner_id uuid,created_at timestamptz,revoked boolean) language sql stable security definer set search_path='' as $$
select k.id,k.owner_id,k.created_at,k.revoked from voxx_private.api_keys k where public.voxx_admin() or k.owner_id=auth.uid() order by k.created_at desc limit 100
$$;
create or replace function public.voxx_revoke_key(key_id uuid) returns void language sql security definer set search_path='' as $$
update voxx_private.api_keys set revoked=true where (owner_id=auth.uid() or public.voxx_admin()) and id=key_id
$$;
revoke all on function public.voxx_list_api_keys() from public,anon;
grant execute on function public.voxx_list_api_keys() to authenticated;
commit;
