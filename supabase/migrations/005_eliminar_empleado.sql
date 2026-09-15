-- OverSpeed · migración 005 — eliminar empleados
-- Ejecutar en el SQL Editor de Supabase, después de 004. Idempotente.
--
-- os_orders, os_payouts y os_featured apuntan a os_profiles con claves
-- foráneas, así que un empleado con historial no se puede borrar sin romper
-- la contabilidad. La función lo comprueba y explica qué hacer en cada caso:
--
--   · Con órdenes activas      → anúlalas primero.
--   · Con historial o cortes   → desactiva la cuenta; el borrado perdería
--                                la trazabilidad de trabajos ya facturados.
--   · Sin nada de lo anterior  → se borra el perfil y también la cuenta de
--                                autenticación, para dejar el usuario libre.
--
-- Antes de borrar se guarda una copia completa del perfil en os_audit.
begin;

create or replace function public.os_delete_profile(p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare old public.os_profiles;
begin
 if not public.os_admin() then raise exception 'Solo administradores'; end if;
 perform pg_advisory_xact_lock(7390281);

 select * into old from public.os_profiles where id=p_id for update;
 if not found then raise exception 'Empleado no encontrado'; end if;
 if p_id=auth.uid() then raise exception 'No puedes eliminar tu propia cuenta'; end if;

 if old.role='admin' and old.active
  and not exists(select 1 from public.os_profiles where id<>p_id and role='admin' and active)
 then raise exception 'Debe quedar un administrador activo'; end if;

 if exists(select 1 from public.os_orders where employee_id=p_id and status='active')
 then raise exception 'Tiene órdenes activas; anúlalas antes de eliminarlo'; end if;

 if exists(select 1 from public.os_orders where employee_id=p_id)
 then raise exception 'Tiene órdenes en el historial; desactiva la cuenta en lugar de eliminarla'; end if;

 if exists(select 1 from public.os_payouts where employee_id=p_id or created_by=p_id)
 then raise exception 'Tiene cortes de pago registrados; desactiva la cuenta en lugar de eliminarla'; end if;

 insert into public.os_audit(actor_id,action,entity,before_data)
  values(auth.uid(),'profile.deleted',p_id::text,to_jsonb(old));

 -- El destacado del mes es decorativo: se retira sin más.
 delete from public.os_featured where employee_id=p_id;
 delete from public.os_profiles where id=p_id;

 -- Liberar también el usuario. Si el rol propietario no tuviera permiso
 -- sobre auth.users, el perfil ya está borrado y la cuenta queda inservible:
 -- sin fila en os_profiles no supera os_member() ni el acceso de la app.
 begin
  delete from auth.users where id=p_id;
 exception when others then null;
 end;
end $$;

revoke all on function public.os_delete_profile(uuid) from public,anon;
grant execute on function public.os_delete_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
