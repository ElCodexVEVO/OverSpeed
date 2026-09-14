-- OverSpeed v1.0. Ejecutar completo en el SQL Editor de Supabase.
-- Tablas os_: independientes de las tablas de otras aplicaciones.
begin;
create table if not exists public.os_profiles (
 id uuid primary key references auth.users(id), name text not null check(length(btrim(name)) between 1 and 100),
 email text not null, role text not null default 'employee' check(role in ('admin','employee')),
 commission numeric(5,2) not null default 0 check(commission between 0 and 100), active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.os_services (
 id text primary key, category text not null, name text not null, description text not null default '',
 cost numeric(14,2) not null check(cost>=0), price numeric(14,2) not null check(price>=0),
 cost_confirmed boolean not null default true, active boolean not null default true, sort integer not null default 0
);
create table if not exists public.os_discounts (
 id text primary key, name text not null, percent numeric(5,2) not null check(percent between 0 and 100),
 active boolean not null default true, admin_only boolean not null default true
);
create table if not exists public.os_orders (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 request_id uuid not null, employee_id uuid not null references public.os_profiles(id), employee_name text not null,
 client text not null, plate text not null, model text not null, payment text not null, note text not null default '',
 items jsonb not null, subtotal numeric(16,2) not null, cost numeric(16,2) not null, cost_confirmed boolean not null,
 discount numeric(16,2) not null, discount_name text not null, total numeric(16,2) not null,
 commission_percent numeric(5,2) not null, earning numeric(16,2) not null, net numeric(16,2) not null,
 status text not null default 'active' check(status in ('active','void')), void_reason text,
 payout_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(employee_id,request_id)
);
create table if not exists public.os_payouts (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.os_profiles(id), employee_name text not null,
 amount numeric(16,2) not null, order_ids uuid[] not null, created_by uuid not null references public.os_profiles(id),
 created_at timestamptz not null default now()
);
create table if not exists public.os_featured (
 month date primary key check(extract(day from month)=1), employee_id uuid not null references public.os_profiles(id),
 photo_url text not null default '', note text not null default '', updated_at timestamptz not null default now()
);
create table if not exists public.os_audit (
 id bigint generated always as identity primary key, actor_id uuid references public.os_profiles(id),
 action text not null, entity text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index if not exists os_orders_employee_date on public.os_orders(employee_id,created_at desc);
create index if not exists os_orders_date on public.os_orders(created_at desc);
create index if not exists os_orders_plate on public.os_orders(plate);
create or replace function public.os_member() returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from public.os_profiles where id=auth.uid() and active)$$;
create or replace function public.os_admin() returns boolean language sql stable security definer set search_path=public
as $$select exists(select 1 from public.os_profiles where id=auth.uid() and active and role='admin')$$;
alter table public.os_profiles enable row level security;
alter table public.os_services enable row level security;
alter table public.os_discounts enable row level security;
alter table public.os_orders enable row level security;
alter table public.os_payouts enable row level security;
alter table public.os_featured enable row level security;
alter table public.os_audit enable row level security;
drop policy if exists os_profiles_read on public.os_profiles;
create policy os_profiles_read on public.os_profiles for select to authenticated using(public.os_admin() or (id=auth.uid() and public.os_member()));
drop policy if exists os_services_read on public.os_services;
create policy os_services_read on public.os_services for select to authenticated using(public.os_member());
drop policy if exists os_discounts_read on public.os_discounts;
create policy os_discounts_read on public.os_discounts for select to authenticated using(public.os_member() and (not admin_only or public.os_admin()));
drop policy if exists os_orders_read on public.os_orders;
create policy os_orders_read on public.os_orders for select to authenticated using(public.os_member() and (employee_id=auth.uid() or public.os_admin()));
drop policy if exists os_payouts_read on public.os_payouts;
create policy os_payouts_read on public.os_payouts for select to authenticated using(public.os_member() and (employee_id=auth.uid() or public.os_admin()));
drop policy if exists os_featured_read on public.os_featured;
create policy os_featured_read on public.os_featured for select to authenticated using(public.os_member());
drop policy if exists os_audit_read on public.os_audit;
create policy os_audit_read on public.os_audit for select to authenticated using(public.os_admin());
revoke all on public.os_profiles,public.os_services,public.os_discounts,public.os_orders,public.os_payouts,public.os_featured,public.os_audit from anon,authenticated;
grant select on public.os_profiles,public.os_services,public.os_discounts,public.os_orders,public.os_payouts,public.os_featured,public.os_audit to authenticated;

create or replace function public.os_submit_order(p_order jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare
 me public.os_profiles; s public.os_services; d public.os_discounts; l jsonb; items jsonb:='[]';
 sub numeric:=0; costs numeric:=0; disc numeric:=0; total_value numeric; earned numeric; q integer;
 rid uuid; result uuid; confirmed boolean:=true; count_lines integer:=0;
begin
 select * into me from public.os_profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Acceso denegado'; end if;
 rid:=(p_order->>'request_id')::uuid;
 if rid is null then raise exception 'Falta identificador de solicitud'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me.id::text||rid::text,0));
 select id into result from public.os_orders where employee_id=me.id and request_id=rid;
 if found then return result; end if;
 if coalesce(length(btrim(p_order->>'client')),0) not between 1 and 120 then raise exception 'Cliente / ID obligatorio'; end if;
 if coalesce(btrim(p_order->>'plate'),'') !~ '^[a-zA-Z0-9 -]{1,16}$' then raise exception 'Matrícula inválida'; end if;
 if coalesce(length(btrim(p_order->>'model')),0) not between 1 and 100 then raise exception 'Modelo obligatorio'; end if;
 if coalesce(p_order->>'payment','') not in ('Efectivo','Transferencia','Tarjeta','Otro') then raise exception 'Método de pago inválido'; end if;
 if length(coalesce(p_order->>'note',''))>1000 then raise exception 'Nota demasiado larga'; end if;
 if jsonb_typeof(p_order->'lines') is distinct from 'array' then raise exception 'Agrega servicios'; end if;
 if jsonb_array_length(p_order->'lines') not between 1 and 60 then raise exception 'Cantidad de servicios inválida'; end if;
 for l in select value from jsonb_array_elements(p_order->'lines') order by value->>'service_id' loop
  if coalesce(l->>'qty','') !~ '^[0-9]{1,4}$' then raise exception 'Cantidad inválida'; end if;
  q:=(l->>'qty')::integer;
  if q not between 1 and 9999 then raise exception 'Cantidad inválida'; end if;
  select * into s from public.os_services where id=l->>'service_id' and active for share;
  if not found then raise exception 'Servicio no disponible'; end if;
  if exists(select 1 from jsonb_array_elements(items) x where x->>'id'=s.id) then raise exception 'Servicio duplicado'; end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'qty',q,'price',s.price,'cost',s.cost,'line_total',s.price*q,'line_cost',s.cost*q,'cost_confirmed',s.cost_confirmed));
  sub:=sub+s.price*q; costs:=costs+s.cost*q; confirmed:=confirmed and s.cost_confirmed; count_lines:=count_lines+1;
 end loop;
 if nullif(p_order->>'discount_id','') is not null then
  select * into d from public.os_discounts where id=p_order->>'discount_id' and active for share;
  if not found or (d.admin_only and me.role<>'admin') then raise exception 'Convenio no autorizado'; end if;
  disc:=round(sub*d.percent/100,2);
 end if;
 total_value:=round(sub-disc,2); earned:=round(total_value*me.commission/100,2);
 insert into public.os_orders(request_id,employee_id,employee_name,client,plate,model,payment,note,items,subtotal,cost,cost_confirmed,discount,discount_name,total,commission_percent,earning,net)
 values(rid,me.id,me.name,btrim(p_order->>'client'),upper(btrim(p_order->>'plate')),btrim(p_order->>'model'),p_order->>'payment',btrim(coalesce(p_order->>'note','')),items,sub,costs,confirmed,disc,coalesce(d.name,'Sin convenio'),total_value,me.commission,earned,total_value-costs-earned) returning id into result;
 insert into public.os_audit(actor_id,action,entity,after_data) values(me.id,'order.created',result::text,jsonb_build_object('total',total_value,'client',p_order->>'client'));
 return result;
end $$;

create or replace function public.os_edit_order(p_id uuid,p_changes jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare old public.os_orders;
begin
 if not public.os_admin() then raise exception 'Solo administradores'; end if;
 select * into old from public.os_orders where id=p_id for update;
 if not found then raise exception 'Orden no encontrada'; end if;
 if coalesce(length(btrim(p_changes->>'client')),0) not between 1 and 120
 or coalesce(btrim(p_changes->>'plate'),'') !~ '^[a-zA-Z0-9 -]{1,16}$'
 or coalesce(length(btrim(p_changes->>'model')),0) not between 1 and 100
 or length(coalesce(p_changes->>'note',''))>1000 then raise exception 'Revisa cliente, matrícula, modelo y nota'; end if;
 update public.os_orders set client=btrim(p_changes->>'client'),plate=upper(btrim(p_changes->>'plate')),model=btrim(p_changes->>'model'),note=btrim(coalesce(p_changes->>'note','')),updated_at=now() where id=p_id;
 insert into public.os_audit(actor_id,action,entity,before_data,after_data) values(auth.uid(),'order.edited',p_id::text,to_jsonb(old),p_changes);
end $$;
create or replace function public.os_void_order(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare old public.os_orders;
begin
 if not public.os_admin() then raise exception 'Solo administradores'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 300 then raise exception 'Indica el motivo (3–300 caracteres)'; end if;
 select * into old from public.os_orders where id=p_id for update;
 if not found then raise exception 'Orden no encontrada'; end if;
 if old.payout_id is not null then raise exception 'La orden ya pertenece a un corte pagado'; end if;
 if old.status='void' then return; end if;
 update public.os_orders set status='void',void_reason=btrim(p_reason),updated_at=now() where id=p_id;
 insert into public.os_audit(actor_id,action,entity,before_data,after_data) values(auth.uid(),'order.voided',p_id::text,to_jsonb(old),jsonb_build_object('reason',p_reason));
end $$;
create or replace function public.os_pay_employee(p_employee uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare ids uuid[]; amount_value numeric; result uuid; employee public.os_profiles;
begin
 if not public.os_admin() then raise exception 'Solo administradores'; end if;
 select * into employee from public.os_profiles where id=p_employee for update;
 if not found then raise exception 'Empleado no encontrado'; end if;
 select array_agg(id order by created_at),sum(earning) into ids,amount_value from
 (select id,created_at,earning from public.os_orders where employee_id=p_employee and status='active' and payout_id is null order by id for update) locked;
 if ids is null or coalesce(amount_value,0)<=0 then raise exception 'No hay comisiones pendientes de pago'; end if;
 insert into public.os_payouts(employee_id,employee_name,amount,order_ids,created_by) values(p_employee,employee.name,amount_value,ids,auth.uid()) returning id into result;
 update public.os_orders set payout_id=result,updated_at=now() where id=any(ids);
 insert into public.os_audit(actor_id,action,entity,after_data) values(auth.uid(),'payout.created',result::text,jsonb_build_object('amount',amount_value,'orders',ids));
 return result;
end $$;
create or replace function public.os_manage(p_kind text,p_data jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare old jsonb; pid uuid; old_role text; old_active boolean;
begin
 if not public.os_admin() then raise exception 'Solo administradores'; end if;
 if p_kind='profile' then
  -- Serializes role changes to preserve at least one active administrator.
  perform pg_advisory_xact_lock(7390281);
  pid:=(p_data->>'id')::uuid;
  select to_jsonb(p),role,active into old,old_role,old_active from public.os_profiles p where id=pid for update;
  if not found then raise exception 'Empleado no encontrado'; end if;
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 100 then raise exception 'Nombre inválido'; end if;
  if pid=auth.uid() and ((p_data->>'role')<>'admin' or not (p_data->>'active')::boolean) then raise exception 'No puedes desactivar tu propia cuenta ni quitarte el rol'; end if;
  if old_role='admin' and old_active and ((p_data->>'role')<>'admin' or not (p_data->>'active')::boolean)
   and not exists(select 1 from public.os_profiles where id<>pid and role='admin' and active) then raise exception 'Debe quedar un administrador activo'; end if;
  update public.os_profiles set name=btrim(p_data->>'name'),role=p_data->>'role',commission=(p_data->>'commission')::numeric,active=(p_data->>'active')::boolean where id=pid;
 elsif p_kind='service' then
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 120 then raise exception 'Nombre inválido'; end if;
  if coalesce(p_data->>'category','') not in ('Mantenimiento','Motor','Frenos','Ruedas','Estética','Tracción','Paquetes') then raise exception 'Categoría inválida'; end if;
  select to_jsonb(s) into old from public.os_services s where id=p_data->>'id';
  insert into public.os_services(id,name,category,cost,price,description,cost_confirmed,active,sort)
  values(coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text),btrim(p_data->>'name'),p_data->>'category',(p_data->>'cost')::numeric,(p_data->>'price')::numeric,left(coalesce(p_data->>'description',''),500),coalesce((p_data->>'cost_confirmed')::boolean,true),coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'sort')::integer,100))
  on conflict(id) do update set name=excluded.name,category=excluded.category,cost=excluded.cost,price=excluded.price,description=excluded.description,cost_confirmed=excluded.cost_confirmed,active=excluded.active;
 elsif p_kind='discount' then
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 100 then raise exception 'Nombre inválido'; end if;
  select to_jsonb(d) into old from public.os_discounts d where id=p_data->>'id';
  insert into public.os_discounts(id,name,percent,active,admin_only)
  values(coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text),btrim(p_data->>'name'),(p_data->>'percent')::numeric,(p_data->>'active')::boolean,(p_data->>'admin_only')::boolean)
  on conflict(id) do update set name=excluded.name,percent=excluded.percent,active=excluded.active,admin_only=excluded.admin_only;
 elsif p_kind='featured' then
  if not exists(select 1 from public.os_profiles where id=(p_data->>'employee_id')::uuid and active) then raise exception 'Selecciona un empleado activo'; end if;
  if coalesce(p_data->>'photo_url','')<>'' and (p_data->>'photo_url') !~ '^https://' then raise exception 'La foto debe usar HTTPS'; end if;
  select to_jsonb(f) into old from public.os_featured f where month=(p_data->>'month')::date;
  insert into public.os_featured(month,employee_id,photo_url,note)
  values((p_data->>'month')::date,(p_data->>'employee_id')::uuid,left(coalesce(p_data->>'photo_url',''),2000),left(coalesce(p_data->>'note',''),200))
  on conflict(month) do update set employee_id=excluded.employee_id,photo_url=excluded.photo_url,note=excluded.note,updated_at=now();
 else raise exception 'Acción desconocida'; end if;
 insert into public.os_audit(actor_id,action,entity,before_data,after_data) values(auth.uid(),p_kind||'.saved',coalesce(p_data->>'id',p_data->>'month','new'),old,p_data);
end $$;
create or replace function public.os_month_feature(p_month date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare choice public.os_featured; employee public.os_profiles; start_at timestamptz; end_at timestamptz; result jsonb;
begin
 if not public.os_member() then raise exception 'Acceso denegado'; end if;
 start_at:=date_trunc('month',p_month::timestamp) at time zone 'America/Mexico_City';
 end_at:=(date_trunc('month',p_month::timestamp)+interval '1 month') at time zone 'America/Mexico_City';
 select * into choice from public.os_featured where month=date_trunc('month',p_month)::date;
 if found then select * into employee from public.os_profiles where id=choice.employee_id and active;
 else select p.* into employee from public.os_profiles p join public.os_orders o on o.employee_id=p.id
  where p.active and o.status='active' and o.created_at>=start_at and o.created_at<end_at group by p.id order by sum(o.total) desc,count(*) desc,p.id limit 1; end if;
 if employee.id is null then return null; end if;
 select jsonb_build_object('employee_id',employee.id,'name',employee.name,'photo_url',coalesce(choice.photo_url,''),'note',coalesce(choice.note,'Mayor facturación del mes'),'count',count(*),'total',coalesce(sum(total),0),'earning',coalesce(sum(earning),0)) into result
 from public.os_orders where employee_id=employee.id and status='active' and created_at>=start_at and created_at<end_at;
 return result;
end $$;
-- Solo se ejecuta desde SQL Editor por el propietario de la base.
create or replace function public.os_bootstrap_admin(p_email text) returns uuid
language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
 perform pg_advisory_xact_lock(7390281);
 if exists(select 1 from public.os_profiles where role='admin' and active) then raise exception 'Ya existe un administrador; usa Equipo para gestionar usuarios'; end if;
 select id into uid from auth.users where lower(email)=lower(btrim(p_email));
 if uid is null then raise exception 'Primero crea el usuario en Authentication > Users'; end if;
 insert into public.os_profiles(id,name,email,role) values(uid,'Administrador',btrim(p_email),'admin')
 on conflict(id) do update set role='admin',active=true;
 return uid;
end $$;
revoke all on function public.os_bootstrap_admin(text) from public,anon,authenticated;
revoke all on function public.os_member(),public.os_admin(),public.os_submit_order(jsonb),public.os_edit_order(uuid,jsonb),public.os_void_order(uuid,text),public.os_pay_employee(uuid),public.os_manage(text,jsonb),public.os_month_feature(date) from public,anon;
grant execute on function public.os_member(),public.os_admin(),public.os_submit_order(jsonb),public.os_edit_order(uuid,jsonb),public.os_void_order(uuid,text),public.os_pay_employee(uuid),public.os_manage(text,jsonb),public.os_month_feature(date) to authenticated;
grant all on public.os_profiles,public.os_services,public.os_discounts,public.os_orders,public.os_payouts,public.os_featured,public.os_audit to service_role;
grant usage,select on all sequences in schema public to service_role;
insert into public.os_services(id,category,name,description,cost,price,cost_confirmed,sort) values
('repair','Mantenimiento','Kit de reparación','',500,1000,true,0),
('performance','Motor','Piezas de rendimiento','',7000,10000,true,1),
('paint','Estética','Kit de pintura','',500,1500,true,2),
('cosmetic','Estética','Piezas cosméticas','',2000,4000,true,3),
('rims','Ruedas','Set de rines','',7000,10000,true,4),
('smoke','Ruedas','Humo para neumáticos','',2500,10000,true,5),
('v12','Motor','Motor V12','',250000,500000,true,6),
('v8','Motor','Motor V8','',35000,50000,true,7),
('brakes','Frenos','Frenos cerámicos','',8000,25000,true,8),
('turbo','Motor','Turbo Charger','',25000,25000,true,9),
('awd','Tracción','Tracción AWD','',8000,13000,true,10),
('rwd','Tracción','Tracción RWD','',7000,12000,true,11),
('fwd','Tracción','Tracción FWD','',6000,11000,true,12),
('slick','Ruedas','Neumáticos Slick','',4000,7000,true,13),
('semi','Ruedas','Neumáticos Semi-Slick','',3500,7000,true,14),
('offroad','Ruedas','Neumáticos Offroad','',4500,7000,true,15),
('nitro','Motor','Nitro','Coste pendiente de confirmar: la fuente lo configura en $0.',0,1000000,false,16),
('nitro-bottle','Motor','Botella de nitro','Coste pendiente de confirmar: la fuente lo configura en $0.',0,200000,false,17),
('stance','Ruedas','Stance o suspensión','',35000,35000,true,18),
('extras','Estética','Extras','',4000,10000,true,19),
('full-v12','Paquetes','Full Tuning V12','V12, turbo, frenos cerámicos, Slick, AWD y servicio.',295000,575000,false,20),
('full-v8','Paquetes','Full Tuning V8','V8, turbo, frenos cerámicos, Semi-Slick, AWD y servicio gratis. Tarifa de paquete; piezas por separado: $120,000.',79500,115000,false,21)
on conflict(id) do nothing;
insert into public.os_discounts(id,name,percent,admin_only) values('d5','Autorizado 5%',5,true),('d10','Autorizado 10%',10,true),('d15','Autorizado 15%',15,true) on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('overspeed-photos','overspeed-photos',true,2097152,array['image/webp','image/jpeg','image/png']) on conflict(id) do nothing;
drop policy if exists os_photo_admin_insert on storage.objects;
create policy os_photo_admin_insert on storage.objects for insert to authenticated with check(bucket_id='overspeed-photos' and public.os_admin());
drop policy if exists os_photo_admin_update on storage.objects;
create policy os_photo_admin_update on storage.objects for update to authenticated using(bucket_id='overspeed-photos' and public.os_admin()) with check(bucket_id='overspeed-photos' and public.os_admin());
drop policy if exists os_photo_admin_select on storage.objects;
create policy os_photo_admin_select on storage.objects for select to authenticated using(bucket_id='overspeed-photos' and public.os_admin());
notify pgrst, 'reload schema';
commit;
