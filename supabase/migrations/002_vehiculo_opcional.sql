-- OverSpeed · migración 002 — el vehículo pasa a ser opcional
-- Ejecutar en el SQL Editor de Supabase, después de 001.
-- Idempotente: se puede volver a ejecutar sin efectos secundarios.
--
-- La columna os_orders.model sigue siendo NOT NULL, pero acepta cadena
-- vacía. El único cambio es que os_submit_order y os_edit_order dejan de
-- exigir que tenga contenido; el límite de 100 caracteres se mantiene.
begin;

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
 -- Cambio respecto a schema.sql: el modelo puede ir vacío.
 if coalesce(length(btrim(p_order->>'model')),0) > 100 then raise exception 'Modelo demasiado largo'; end if;
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
 values(rid,me.id,me.name,btrim(p_order->>'client'),upper(btrim(p_order->>'plate')),btrim(coalesce(p_order->>'model','')),p_order->>'payment',btrim(coalesce(p_order->>'note','')),items,sub,costs,confirmed,disc,coalesce(d.name,'Sin convenio'),total_value,me.commission,earned,total_value-costs-earned) returning id into result;
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
 or coalesce(length(btrim(p_changes->>'model')),0) > 100
 or length(coalesce(p_changes->>'note',''))>1000 then raise exception 'Revisa cliente, matrícula, modelo y nota'; end if;
 update public.os_orders set client=btrim(p_changes->>'client'),plate=upper(btrim(p_changes->>'plate')),model=btrim(coalesce(p_changes->>'model','')),note=btrim(coalesce(p_changes->>'note','')),updated_at=now() where id=p_id;
 insert into public.os_audit(actor_id,action,entity,before_data,after_data) values(auth.uid(),'order.edited',p_id::text,to_jsonb(old),p_changes);
end $$;

revoke all on function public.os_submit_order(jsonb),public.os_edit_order(uuid,jsonb) from public,anon;
grant execute on function public.os_submit_order(jsonb),public.os_edit_order(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
