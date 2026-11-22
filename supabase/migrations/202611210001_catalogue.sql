create schema if not exists voxx_private;
revoke all on schema voxx_private from public, anon, authenticated;
create table voxx_private.admins (user_id uuid primary key references auth.users on delete cascade);
create table voxx_private.settings (singleton boolean primary key default true check(singleton), source text not null check(source in ('mock','live')), markup numeric not null check(markup between 0 and 1000));
insert into voxx_private.settings values(true,'mock',25);
create table voxx_private.services (
 source text not null, id bigint not null, name text not null, category text not null, kind text not null,
 cost numeric not null check(cost >= 0 and cost < 1e12), minimum bigint not null check(minimum >= 0), maximum bigint not null check(maximum >= minimum),
 refill boolean not null, cancel boolean not null, present boolean not null default true, visible boolean not null default true,
 fixed numeric check(fixed between 0 and 1e12), primary key(source,id)
);
alter table voxx_private.admins enable row level security;
alter table voxx_private.services enable row level security;
alter table voxx_private.settings enable row level security;

create function public.voxx_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from voxx_private.admins where user_id=auth.uid())
$$;
create function public.voxx_catalogue(manage boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if manage and not public.voxx_admin() then raise insufficient_privilege; end if;
 select jsonb_build_object('source',cfg.source,'markup',case when manage then cfg.markup end,'items',coalesce((
 select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'type',s.kind,'min',s.minimum,'max',s.maximum,'refill',s.refill,'cancel',s.cancel,'price',coalesce(s.fixed,round(s.cost*(1+cfg.markup/100),4))) ||
 case when manage then jsonb_build_object('cost',s.cost,'fixed',s.fixed,'visible',s.visible) else '{}'::jsonb end order by s.category,s.name,s.id)
 from voxx_private.services s where s.source=cfg.source and s.present and (manage or s.visible)
 ),'[]'::jsonb)) into result from voxx_private.settings cfg;
 return result;
end $$;

create function public.voxx_price(expected_source text, service_id bigint, retail numeric, listed boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.voxx_admin() then raise insufficient_privilege; end if;
 perform 1 from voxx_private.settings where source=expected_source for update;
 if not found then raise exception 'Catalogue changed. Reload.'; end if;
 update voxx_private.services set fixed=retail, visible=listed where source=expected_source and id=service_id and present;
 if not found then raise exception 'Service unavailable'; end if;
end $$;
create function public.voxx_markup(percent_value numeric) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.voxx_admin() then raise insufficient_privilege; end if;
 update voxx_private.settings set markup=percent_value;
end $$;

-- Only the server integration can publish a complete provider snapshot.
create function public.voxx_publish(rows jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)=0 then raise exception 'Invalid snapshot'; end if;
 perform 1 from voxx_private.settings for update;
 update voxx_private.services set present=false where source='live';
 insert into voxx_private.services(source,id,name,category,kind,cost,minimum,maximum,refill,cancel)
 select 'live',service,name,category,type,rate,min,max,refill,cancel from jsonb_to_recordset(rows)
 as t(service bigint,name text,category text,type text,rate numeric,min bigint,max bigint,refill boolean,cancel boolean)
 on conflict(source,id) do update set name=excluded.name,category=excluded.category,kind=excluded.kind,cost=excluded.cost,minimum=excluded.minimum,maximum=excluded.maximum,refill=excluded.refill,cancel=excluded.cancel,present=true;
 update voxx_private.settings set source='live';
end $$;
revoke all on function public.voxx_publish(jsonb) from public, anon, authenticated;
grant execute on function public.voxx_publish(jsonb) to service_role;
revoke all on function public.voxx_admin(),public.voxx_price(text,bigint,numeric,boolean),public.voxx_markup(numeric),public.voxx_catalogue(boolean) from public,anon,authenticated;
grant execute on function public.voxx_admin(),public.voxx_price(text,bigint,numeric,boolean),public.voxx_markup(numeric) to authenticated;
grant execute on function public.voxx_catalogue(boolean) to anon,authenticated;

insert into voxx_private.services(source,id,name,category,kind,cost,minimum,maximum,refill,cancel) values
('mock',1001,'Instagram Reel views','Instagram','Default',8,100,50000,false,true),
('mock',1002,'Instagram Post likes','Instagram','Default',36,50,10000,true,false),
('mock',1003,'YouTube Video views','YouTube','Default',85,100,10000,false,false),
('mock',1004,'YouTube Channel subscribers','YouTube','Default',240,10,1000,false,false),
('mock',1005,'Facebook Page followers','Facebook','Default',60,50,5000,false,false),
('mock',1006,'Telegram Channel post views','Telegram','Default',12,100,25000,false,false),
('mock',1007,'TikTok Video likes','TikTok','Default',45,50,5000,false,false);

