-- OverSpeed · migración 003 — borrado de órdenes
-- Ejecutar en el SQL Editor de Supabase, después de 002.
-- Idempotente.
--
-- Anular y borrar son cosas distintas y conviene que sigan siéndolo:
--   · Anular  → la orden deja de contar para facturación y comisiones,
--               pero se conserva con su motivo. Es lo que se usa a diario.
--   · Borrar  → desaparece de la base de datos. Solo para errores de
--               captura: órdenes duplicadas o registradas por equivocación.
--
-- Por eso la función solo acepta órdenes que ya estén anuladas y que no
-- formen parte de un corte pagado. Antes de borrar, deja copia completa
-- de la fila en os_audit, así que el movimiento queda trazado aunque el
-- registro original ya no exista.
begin;

create or replace function public.os_delete_order(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare old public.os_orders;
begin
 if not public.os_admin() then raise exception 'Solo administradores'; end if;
 if coalesce(length(btrim(p_reason)),0) not between 3 and 300 then raise exception 'Indica el motivo del borrado'; end if;
 select * into old from public.os_orders where id=p_id for update;
 if not found then raise exception 'Orden no encontrada'; end if;
 if old.status<>'void' then raise exception 'Solo se pueden borrar órdenes anuladas; anúlala primero'; end if;
 if old.payout_id is not null then raise exception 'La orden pertenece a un corte pagado'; end if;
 insert into public.os_audit(actor_id,action,entity,before_data,after_data)
  values(auth.uid(),'order.deleted',p_id::text,to_jsonb(old),jsonb_build_object('reason',btrim(p_reason)));
 delete from public.os_orders where id=p_id;
end $$;

revoke all on function public.os_delete_order(uuid,text) from public,anon;
grant execute on function public.os_delete_order(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
