-- ============================================================================
-- PERMISOS DE LAS FUNCIONES (alertas de seguridad de Supabase)
--
-- Qué son estas alertas y cuáles son reales:
--
--   · function_search_path_mutable          -> REAL, y solo UNA función.
--   · anon_security_definer_function_executable
--   · authenticated_security_definer_function_executable
--                                          -> mayormente ruido, con 2 reales.
--
-- Postgis da `EXECUTE` a `PUBLIC` por defecto en toda función nueva, así que el
-- linter ve que cualquiera las puede llamar por /rest/v1/rpc/<nombre>. Eso no
-- significa que sean accesibles: las que importan se autoprotegen (ver abajo).
--
-- LO QUE NO SE TOCA Y POR QUÉ
-- -----------------------------
-- es_lider, puede_ver_evaluacion, puede_responder, puede_manejar_instancia,
-- puede_reportar_incidencia, puede_ver_incidencia:
--   Son los ayudantes que las políticas RLS invocan (`using (public.es_lider())`).
--   Revocarles EXECUTE a anon/authenticated NO es un endurecimiento: ROMPE la app
--   entera. Cada select, insert y update empezaría a fallar con "permission
--   denied for function". El linter no sabe que se llaman desde políticas.
--   Sin sesión devuelven false (todas preguntan por auth.uid(), que es NULL), así
--   que dejarlas no abre nada.
--
-- intento_login y email_por_usuario:
--   Son la pantalla de login, que corre SIN sesión. Necesitan `anon` a propósito.
--
-- LO QUE SÍ SE CORRIGE
-- ---------------------
-- 1) validar_suma_puntaje_items era la única sin `set search_path`.
-- 2) Las de trigger no deberían poder llamarse por RPC en ningún caso: se les
--    quita el EXECUTE heredado de PUBLIC.
-- 3) desbloquear_usuario y registrar_sync solo las usa un usuario con sesión
--    (el primero además exige ser LIDER). El `grant` a authenticated ya estaba,
--    pero el de PUBLIC dejaba a `anon` también, y eso no hace falta.
--
-- Es idempotente: se puede correr las veces que haga falta.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) search_path inmutable
-- ----------------------------------------------------------------------------
-- Con el search_path modificable, un esquema anterior en el camino de búsqueda
-- podría resolver una tabla homónima y hacer que la función lea otra. Se fija
-- a `public` como en el resto del schema.
alter function public.validar_suma_puntaje_items() set search_path = public;

-- ----------------------------------------------------------------------------
-- 2) Trigger functions: sin RPC
-- ----------------------------------------------------------------------------
-- Son `security definer`, así que el trigger corre como dueño y no necesita el
-- permiso del rol que dispara el INSERT. `returns trigger` además impide
-- llamarlas por RPC igual, pero dejarlas ejecutables es superficie de attack
-- innecesaria.
revoke execute on function public.validar_registro() from public;
revoke execute on function public.validar_modulo_compartido() from public;
revoke execute on function public.validar_unico_evaluador_modulo() from public;
revoke execute on function public.handle_new_user() from public;

-- Excepción a propósito: validar_suma_puntaje_items NO es security definer, así
-- que el trigger corre como el rol que escribe (el Líder, `authenticated`) y
-- necesita el permiso. Sin este grant, cualquier edición de un ítem fallaría con
-- "permission denied for function".
revoke execute on function public.validar_suma_puntaje_items() from public;
grant execute on function public.validar_suma_puntaje_items() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Solo para quien tiene sesión
-- ----------------------------------------------------------------------------
-- El cuerpo ya se protege: `desbloquear_usuario` exige que auth.uid() sea un
-- LIDER activo y sin sesión aborta con excepción. `registrar_sync` escribe en
-- `where id = auth.uid()`, que para anon es NULL y no actualiza nada. Ninguna de
-- las dos hace falta que la pueda llamar un anónimo.
revoke execute on function public.desbloquear_usuario(uuid, text) from public;
grant  execute on function public.desbloquear_usuario(uuid, text) to authenticated;

revoke execute on function public.registrar_sync() from public;
grant  execute on function public.registrar_sync() to authenticated;

-- ----------------------------------------------------------------------------
-- Verificación
-- ----------------------------------------------------------------------------
-- Debe salir una sola fila. Las de policy helpers con 'policy-ok' son las que
-- hay que dejar ejecutables.
--
-- select p.proname,
--        p.prosecdef as security_definer,
--        p.proconfig as search_path,
--        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_puede,
--        case
--          when p.proname in ('es_lider','puede_ver_evaluacion','puede_responder',
--                             'puede_manejar_instancia','puede_reportar_incidencia',
--                             'puede_ver_incidencia') then 'policy-ok (NO revocar)'
--          when p.proname in ('intento_login','email_por_usuario') then 'login (NO revocar)'
--          else 'revisar'
--        end as nota
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('validar_suma_puntaje_items','validar_registro',
--                     'handle_new_user','validar_modulo_compartido',
--                     'validar_unico_evaluador_modulo','desbloquear_usuario',
--                     'registrar_sync','es_lider','intento_login')
-- order by p.proname;

commit;