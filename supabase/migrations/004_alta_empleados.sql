-- OverSpeed · migración 004 — alta de empleados desde la aplicación
-- Ejecutar en el SQL Editor de Supabase, después de 003. Idempotente.
--
-- Añade la acción 'profile_create' a os_manage. La aplicación crea primero la
-- cuenta de autenticación (con signUp, desde el navegador y sin claves
-- privilegiadas) y después llama a esta acción para darle su perfil, rol y
-- comisión. Solo un administrador puede ejecutarla, igual que el resto.
--
-- Una cuenta sin fila en os_profiles no puede hacer absolutamente nada: la
-- aplicación rechaza el acceso y todas las políticas RLS dependen de
-- os_member(). Por eso el alta en dos pasos es segura.
begin;

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
 elsif p_kind='profile_create' then
  -- Alta de un empleado que ya tiene cuenta de autenticación.
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 100 then raise exception 'Nombre inválido'; end if;
  if coalesce(p_data->>'role','') not in ('admin','employee') then raise exception 'Rol inválido'; end if;
  if coalesce((p_data->>'commission')::numeric,-1) not between 0 and 100 then raise exception 'Comisión inválida'; end if;
  select id into pid from auth.users where lower(email)=lower(btrim(coalesce(p_data->>'email','')));
  if pid is null then raise exception 'No existe ninguna cuenta con ese correo'; end if;
  if exists(select 1 from public.os_profiles where id=pid) then raise exception 'Ese empleado ya está dado de alta'; end if;
  insert into public.os_profiles(id,name,email,role,commission,active)
   values(pid,btrim(p_data->>'name'),lower(btrim(p_data->>'email')),p_data->>'role',(p_data->>'commission')::numeric,true);
 elsif p_kind='service' then
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 120 then raise exception 'Nombre inválido'; end if;
  if coalesce(p_data->>'category','') not in ('Mantenimiento','Motor','Frenos','Ruedas','Estética','Tracción','Paquetes') then raise exception 'Categoría inválida'; end if;
  select to_jsonb(s) into old from public.os_services s where id=p_data->>'id';
  insert into public.os_services(id,name,category,cost,price,description,cost_confirmed,active,sort)
  values(coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text),btrim(p_data->>'name'),p_data->>'category',(p_data->>'cost')::numeric,(p_data->>'price')::numeric,left(coalesce(p_data->>'description',''),500),coalesce((p_data->>'cost_confirmed')::boolean,true),coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'sort')::integer,100))
  on conflict(id) do update set name=excluded.name,category=excluded.category,cost=excluded.cost,price=excluded.price,description=excluded.description,cost_confirmed=excluded.cost_confirmed,active=excluded.active;
 elsif p_kind='discount' then
  if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 100 then raise exception 'Nombre inválido'; end if;
  -- Mismo criterio que la foto del empleado del mes: solo HTTPS.
  if coalesce(p_data->>'logo_url','')<>'' and (p_data->>'logo_url') !~ '^https://' then raise exception 'El logo debe usar HTTPS'; end if;
  select to_jsonb(d) into old from public.os_discounts d where id=p_data->>'id';
  insert into public.os_discounts(id,name,percent,active,admin_only,logo_url)
  values(coalesce(nullif(p_data->>'id',''),gen_random_uuid()::text),btrim(p_data->>'name'),(p_data->>'percent')::numeric,(p_data->>'active')::boolean,(p_data->>'admin_only')::boolean,left(coalesce(p_data->>'logo_url',''),2000))
  on conflict(id) do update set name=excluded.name,percent=excluded.percent,active=excluded.active,admin_only=excluded.admin_only,logo_url=excluded.logo_url;
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

revoke all on function public.os_manage(text,jsonb) from public,anon;
grant execute on function public.os_manage(text,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
