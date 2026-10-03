-- ============================================================================
-- SACARLE A `anon` TODO LO QUE LE SOBRA
--
-- Corre esto DESPUÉS de `cerrar-lectura-anon.sql`. Es idempotente.
--
-- QUÉ HACE, EN DOS PARTES QUE SON UNA SOLA COSA
-- ---------------------------------------------
-- 1) Le saca a `anon` el permiso sobre TODAS las tablas de `public`.
--
-- 2) Le saca a `anon` el EXECUTE de los 6 ayudantes de política RLS.
--
-- La 2 depende de la 1, y por eso van en el mismo archivo. No son dos
-- ajustes de seguridad sueltos: la 2 es IMPOSIBLE de hacer bien sin la 1.
--
-- POR QUÉ
-- --------
-- Las políticas RLS se evalúan con los privilegios de quien consulta, así que
-- una función llamada desde un `using (...)` necesita que ese rol tenga EXECUTE.
-- Eso es lo que bloqueaba la 2 antes: con `anon` teniendo permiso de tabla en
-- las 19 tablas, llegaba a evaluar políticas, y ahí `es_lider()` y compañía
-- necesitan su EXECUTE. Revocarlo tiraba la app entera con "permission denied
-- for function".
--
-- Con la 1, `anon` ya no alcanza ninguna tabla. Postgres revisa el permiso de
-- tabla ANTES que las políticas, asi que nunca llega a evaluarlas y nunca
-- llama a un ayudante. Ahi la 2 es inocua.
--
-- Ojo con el orden de las dos cosas dentro de la misma transaccion: si se
-- revocara el EXECUTE sin haber sacado los permisos de tabla, `anon` podria
-- seguir tocando las otras 12 tablas y ahi si reventaria con error. Por eso van
-- en un solo `begin`/`commit`.
--
-- LAS 19 TABLAS, NO LAS 7
-- -----------------------
-- `cerrar-lectura-anon.sql` cerro el SELECT de 7. Este archivo va mas alla por
-- dos razones:
--   · Motivo de seguridad: `anon` tambien tenia INSERT, UPDATE y DELETE sobre
--     todo el schema, y eso solo lo frenaba RLS. RLS es una capa; el permiso es
--     la otra. Con las dos capas, un `alter table ... disable row level security`
--     accidental no abre la puerta.
--   · Es lo que habilita la parte 2 con seguridad.
--
-- LO QUE NO SE ROMPE
-- ------------------
-- · La pantalla de login: `intento_login` y `email_por_usuario` siguen con
--   `anon` porque son SECURITY DEFINER y cor como el dueno de la tabla. No
--   dependen de ningun permiso de tabla. Este archivo no las toca.
-- · El registro por invitacion: el token lo valida el trigger `validar_registro`
--   sobre `auth.users`, no una consulta del navegador.
-- · La app: todos los providers que leen tablas (Catalog, Presencia) arrancan
--   recien cuando hay perfil, y todas las rutas con datos detras de RequireAuth.
--   El unico camino que consulta tablas sin sesion es la cola offline con
--   pendientes si el usuario cierra sesion sin sincronizar, y eso ya fallaba
--   antes de este archivo (RLS le devolvia cero filas); ahora falla con un
--   error, que es mas honesto y deja los items en la cola en vez de darlos por
--   subidos.
-- · Storage: `storage.objects` vive en el esquema `storage`, no en `public`, asi
--   que la barrida de tablas no lo toca. Los buckets siguen andando.
--
-- LAS ALERTAS QUE QUEDAN
-- -----------------------
-- Se van 6 de las 21 (las de `anon` sobre los ayudantes). Quedan 15, y 15 es
-- el piso correcto:
--   · 6 ayudantes para `authenticated`: necesarias. Las politicas se evaluan
--     con los privilegios del rol que consulta, y TODAS las consultas de la
--     app son con sesion.
--   · `intento_login` y `email_por_usuario` para `anon`: es la pantalla de login.
--   · `desbloquear_usuario` y `registrar_sync` para `authenticated`: la app las
--     llama con sesion.
--   · 4 triggers para `authenticated`: margen de seguridad (ver
--     `permisos-funcion.sql`).
--   · 1 de leaked password protection: es un toggle del dashboard.
--
-- Las 6 de los ayudantes para `authenticated` se pueden sacar un dia moviendo
-- los 6 a un esquema que no este expuesto. Es un cambio mas grande, con su
-- propio archivo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Ninguna tabla de `public` queda accesible para `anon`
-- ----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- Y para las que se creen en el futuro: sin esto, una tabla nueva bornaria con
-- el `grant all` por defecto de Supabase y habria que acordarse de cerrarla a
-- mano. Es el error que produjo las 7 fugas que acabamos de cerrar.
alter default privileges in schema public revoke all on tables from anon;

-- ----------------------------------------------------------------------------
-- 2) Los 6 ayudantes de politica: fuera `anon`, dentro `authenticated`
-- ----------------------------------------------------------------------------
-- Se revoca de PUBLIC y de `anon` por el motivo aditivo de siempre (ver
-- `permisos-funcion.sql`), y despues se devuelve solo lo que corresponde.
-- `authenticated` los necesita porque TODAS las consultas de la app pasan por
-- ahi, y las politicas los invocan.
revoke execute on function public.es_lider() from public, anon;
grant  execute on function public.es_lider() to authenticated;

revoke execute on function public.puede_ver_evaluacion(public.evaluaciones) from public, anon;
grant  execute on function public.puede_ver_evaluacion(public.evaluaciones) to authenticated;

revoke execute on function public.puede_responder(uuid, uuid) from public, anon;
grant  execute on function public.puede_responder(uuid, uuid) to authenticated;

revoke execute on function public.puede_manejar_instancia(uuid, uuid) from public, anon;
grant  execute on function public.puede_manejar_instancia(uuid, uuid) to authenticated;

revoke execute on function public.puede_reportar_incidencia(uuid, uuid) from public, anon;
grant  execute on function public.puede_reportar_incidencia(uuid, uuid) to authenticated;

revoke execute on function public.puede_ver_incidencia(uuid) from public, anon;
grant  execute on function public.puede_ver_incidencia(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) `upsert_respuestas`: se le habia olvidado a todo el mundo
-- ----------------------------------------------------------------------------
-- Esta NO es security definer, asi que el advisor de Supabase no la marca: los
-- avisos que arma son solo de funciones security definer. Pero `anon` si la
-- puede ejecutar, porque el proyecto de Supabase deja un
-- 'grant all on all functions in schema public' inicial que nadie le revoco:
-- `permisos-funcion.sql` recorre las security definer y esta se le quedo
-- afuera. Por eso es la razon por la que la cuenta de arriba da 3 y no 2.
--
-- Que sea invoker la hace menos grave que a los ayudantes: corre con los
-- privilegios de quien llama, asi que sin permiso de tabla (parte 1) no puede
-- escribir nada. Es defensa en profundidad, no una fuga abierta.
--
-- La app la llama por RPC desde `subirRespuestas` en src/lib/offline/sync.ts,
-- siempre con sesion.
revoke execute on function public.upsert_respuestas(jsonb) from public, anon;
grant  execute on function public.upsert_respuestas(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Verificacion
-- ----------------------------------------------------------------------------
-- 1) Las tablas. TODAS tienen que dar anon_select = false.
--    sesion_select tiene que dar true en todas: si alguna da false, el
--    catalogo o el historial no cargan y hay que revertir este archivo.
select
  c.relname as tabla,
  has_table_privilege('anon', c.oid, 'select')          as anon_select,
  has_table_privilege('authenticated', c.oid, 'select')  as sesion_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

-- 2) Las funciones. Esta tabla es la que hay que leer contra las 21 alertas:
--    · los 6 ayudantes tienen que dar anon_puede = false, sesion_puede = true
--    · intento_login y email_por_usuario al reves: anon_puede = true
--    · cualquier otro anon_puede = true que aparezca aca es una alerta que
--      falta cerrar
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute')         as anon_puede,
  has_function_privilege('authenticated', p.oid, 'execute') as sesion_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- 3) El resumen. LAS TABLAS TIENEN QUE DAR 0.
--
--    En funciones NO da 0, y no es un error: da 2, que son `intento_login` y
--    `email_por_usuario`, la pantalla de login. Corre sin sesion por definicion,
--    asi que `anon` las tiene que poder llamar. Lo que no puede aparecer es
--    ninguna otra.
select
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and has_table_privilege('anon', c.oid, 'select'))      as tablas_que_anon_abre,
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('intento_login', 'email_por_usuario'))  as funciones_que_anon_abre_sin_el_login;

-- Si la de funciones da 0, lo unico que queda abierto a anon son las dos del
-- login. Es el piso correcto.
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;
-- ============================================================================
commit;