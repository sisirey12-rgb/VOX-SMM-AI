begin;
create sequence voxx_private.sync_generation;
alter table voxx_private.settings add column last_generation bigint not null default 0;
create function public.voxx_sync_start() returns bigint language sql security definer set search_path='' as $$select nextval('voxx_private.sync_generation')$$;
create function public.voxx_sync_commit(rows jsonb,currency_code text,generation bigint) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update voxx_private.settings set last_generation=generation where singleton and last_generation<generation;
 if not found then return false;end if;
 perform public.voxx_import(rows,currency_code);return true;
end $$;
revoke all on function public.voxx_sync_start(),public.voxx_sync_commit(jsonb,text,bigint) from public,anon,authenticated;
grant execute on function public.voxx_sync_start(),public.voxx_sync_commit(jsonb,text,bigint) to service_role;
grant update(state) on public.voxx_payments to service_role;
-- A changed service requires fresh scheduling evidence before any more runs.
create function voxx_private.reset_eligibility() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source='live' and (not new.present or (new.kind,new.category,new.name) is distinct from (old.kind,old.category,old.name)) then
 delete from public.voxx_schedule_rules where service_id=new.id;end if;return new;
end $$;
create trigger reset_rule after update on voxx_private.services for each row execute function voxx_private.reset_eligibility();
commit;
