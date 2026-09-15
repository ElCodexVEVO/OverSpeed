-- OverSpeed · migración 006 (OPCIONAL) — confirmar cuentas automáticamente
--
-- Úsala solo si no encuentras el interruptor «Confirm email» en el panel de
-- Supabase, o si prefieres no depender de un ajuste que ellos mueven de sitio
-- cada pocas versiones.
--
-- Qué hace: un disparador en auth.users que marca cada cuenta nueva como
-- confirmada en el momento de crearla. Los usuarios de OverSpeed no son
-- direcciones reales, así que no hay nada que verificar.
--
-- Qué NO hace: no desactiva el envío de correos de confirmación. Si el ajuste
-- sigue activo, Supabase intentará enviarlos igualmente; simplemente ya no
-- hacen falta para poder entrar.
--
-- Para revertirlo:
--   drop trigger if exists os_autoconfirm_trg on auth.users;
--   drop function if exists public.os_autoconfirm();
begin;

create or replace function public.os_autoconfirm() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.email_confirmed_at is null then
  new.email_confirmed_at := now();
 end if;
 return new;
end $$;

drop trigger if exists os_autoconfirm_trg on auth.users;
create trigger os_autoconfirm_trg
 before insert on auth.users
 for each row execute function public.os_autoconfirm();

-- Y de paso, las cuentas que ya estaban pendientes.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

commit;
