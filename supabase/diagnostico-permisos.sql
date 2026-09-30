-- ============================================================================
-- DIAGNOSTICO DE PERMISOS DE LAS FUNCIONES (solo lectura)
--
-- Por que existe: el linter de Supabase dice "cualquiera puede ejecutar esta
-- funcion por /rest/v1/rpc/<nombre>". Eso es cierto, pero no dice SI DEBE.
-- Este archivo muestra quien puede en realidad y por que.
--
-- Correlo cuando quieras: no modifica nada.
-- ============================================================================

-- Ejecuta este bloque y mandame el resultado si algo no cuadra con lo esperado.
select
  p.proname                                        as funcion,
  p.prosecdef                                      as security_definer,
  coalesce(p.proconfig::text, '(sin search_path)')  as search_path,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado_puede,
  case p.proname
    -- Se invocan desde las politicas RLS (`using (public.es_lider())`). Revocar
    -- EXECUTE no es endurecimiento: rompe toda la base con "permission denied".
    when in ('es_lider','puede_ver_evaluacion','puede_responder',
             'puede_manejar_instancia','puede_reportar_incidencia',
             'puede_ver_incidencia')
      then 'ayudante de politica RLS -> NO revocar'
    -- Pantalla de login: corre antes de autenticar, necesita anon.
    when in ('intento_login','email_por_usuario')
      then 'login sin sesion -> anon OK, authenticated innecesario'
    -- Solo un usuario con sesion (y para desbloquear, ademas un Lider).
    when in ('desbloquear_usuario','registrar_sync')
      then 'solo authenticated'
    -- Trigger: `returns trigger` ya impide llamarla por RPC.
    else 'trigger -> sin uso por RPC'
  end                                              as por_que,
  case
    when p.proname = 'validar_suma_puntaje_items'
      and not (coalesce(p.proconfig::text, '') like '%search_path%')
      then 'FALTA search_path'
    when p.proname in ('desbloquear_usuario','registrar_sync')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'anon todavia puede llamarla'
    when p.proname in ('validar_registro','handle_new_user',
                       'validar_modulo_compartido','validar_unico_evaluador_modulo')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'anon todavia puede llamarla'
    when p.proname in ('intento_login','email_por_usuario')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      then 'authenticated no hace falta'
    else 'ok'
  end                                              as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'validar_suma_puntaje_items','validar_registro','handle_new_user',
    'validar_modulo_compartido','validar_unico_evaluador_modulo',
    'desbloquear_usuario','registrar_sync','es_lider','puede_ver_evaluacion',
    'puede_responder','puede_manejar_instancia','puede_reportar_incidencia',
    'puede_ver_incidencia','intento_login','email_por_usuario'
  )
order by (p.proname in ('es_lider','puede_ver_evaluacion','puede_responder',
                        'puede_manejar_instancia','puede_reportar_incidencia',
                        'puede_ver_incidencia')), p.proname;

-- ----------------------------------------------------------------------------
-- Por que `revoke ... from anon` NO alcanza (el error del primer intento)
-- ----------------------------------------------------------------------------
-- Postgres da EXECUTE al rol PUBLIC en cada funcion nueva, y ademas los
-- proyectos de Supabase traen un `grant all on all functions in schema public`
-- inicial que deja un permiso EXPLICITO para anon y authenticated.
--
-- Los permisos son ADITIVOS. Por eso:
--   revoke ... from public   ->  quita el de PUBLIC, pero anon conserva el suyo
--   revoke ... from anon     ->  quita el de anon, pero PUBLIC sigue sirviendo
-- Hay que quitar AMBOS (y volver a dar solo lo que corresponda).
--
-- Comprobacion rapida del ACL crudo de una funcion:
--
-- select p.proname, p.proacl
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'registrar_sync';
--
-- While p.proacl -> hay permiso heredado de PUBLIC.
-- X,X=.../postgres  -> hay permiso explicito para algun rol.