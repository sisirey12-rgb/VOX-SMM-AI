begin;
create table public.voxx_stores(owner_id uuid primary key default auth.uid() references public.voxx_profiles,id text not null unique check(id ~ '^[a-z0-9-]{3,48}$'),name text not null check(length(name) between 2 and 80),colour text not null default '#8b5cf6' check(colour ~ '^#[a-fA-F0-9]{6}$'),created_at timestamptz default now());
alter table public.voxx_stores enable row level security;
revoke all on public.voxx_stores from public,anon,authenticated;
grant select on public.voxx_stores to anon,authenticated;
grant insert(id,name,colour),update(id,name,colour) on public.voxx_stores to authenticated;
create policy storefronts on public.voxx_stores for select using(true);
create policy manage_store on public.voxx_stores for all to authenticated using(owner_id=auth.uid() and public.voxx_role()='reseller') with check(owner_id=auth.uid() and public.voxx_role()='reseller');
create function public.voxx_join_store(slug text) returns void language plpgsql security definer set search_path='' as $$
declare reseller uuid;
begin
 select s.owner_id into strict reseller from public.voxx_stores s join public.voxx_profiles p on p.id=s.owner_id and p.role='reseller' where s.id=slug;
 update public.voxx_profiles set parent_id=reseller where id=auth.uid() and role='customer' and parent_id is null and id<>reseller;
 if not found then raise exception 'Account already assigned or ineligible'; end if;
end $$;
create table voxx_private.api_keys(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.voxx_profiles,digest text not null unique,created_at timestamptz default now(),revoked boolean not null default false,minute timestamptz,calls integer not null default 0);
create function public.voxx_issue_key(owner uuid, fingerprint text) returns uuid language plpgsql security definer set search_path='' as $$
declare k uuid;
begin
 if not exists(select 1 from public.voxx_profiles where id=owner and role='reseller') then raise insufficient_privilege; end if;
 insert into voxx_private.api_keys(owner_id,digest) values(owner,fingerprint) returning id into k; return k;
end $$;
create function public.voxx_key_list() returns table(id uuid,created_at timestamptz,revoked boolean) language sql security definer set search_path='' as $$
select id,created_at,revoked from voxx_private.api_keys where owner_id=auth.uid() order by created_at desc
$$;
create function public.voxx_revoke_key(key_id uuid) returns void language sql security definer set search_path='' as $$
update voxx_private.api_keys set revoked=true where owner_id=auth.uid() and id=key_id
$$;
create function public.voxx_key_owner(fingerprint text) returns uuid language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 update voxx_private.api_keys k set minute=date_trunc('minute',now()),calls=case when k.minute=date_trunc('minute',now()) then k.calls+1 else 1 end
 from public.voxx_profiles p where p.id=k.owner_id and p.role='reseller' and k.digest=fingerprint and not k.revoked and
 (k.minute is distinct from date_trunc('minute',now()) or k.calls<60) returning k.owner_id into owner; return owner;
end $$;
revoke all on function public.voxx_issue_key(uuid,text),public.voxx_key_owner(text) from public,anon,authenticated;
grant execute on function public.voxx_issue_key(uuid,text),public.voxx_key_owner(text) to service_role;
revoke all on function public.voxx_revoke_key(uuid),public.voxx_key_list(),public.voxx_join_store(text) from public,anon;
grant execute on function public.voxx_revoke_key(uuid),public.voxx_key_list(),public.voxx_join_store(text) to authenticated;
commit;
