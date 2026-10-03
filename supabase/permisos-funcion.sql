-- ============================================================================
-- PERMISOS DE LAS FUNCIONES (alertas de seguridad de Supabase)
--
-- POR QUE HACE FALTA UNA SEGUNDA RONDA
-- --------------------------------------
-- La primera vez se revoco `from public` y no cambio nada: las alertas de `anon`
-- siguieron igual. La razon es que los permisos en Postgres son ADITIVOS y los
-- proyectos de Supabase traen un `grant all on all functions in schema public`
-- que deja un permiso EXPLICITO para `anon`. Quitar el de PUBLIC no alcanza si
-- el rol tiene el suyo:
--
--   revoke ... from public  ->  quita el de PUBLIC, anon conserva el suyo
--   revoke ... from anon    ->  quita el de anon, PUBLIC sigue sirviendo
--
-- Por eso ahora cada revoke quita PUBLIC y el rol, y despues se vuelve a dar
-- solo lo que corresponde. Ver la nota tecnica al final del archivo.
--
-- LO QUE NO SE TOCA Y POR QUE
-- ----------------------------
-- es_lider, puede_ver_evaluacion, puede_responder, puede_manejar_instancia,
-- puede_reportar_incidencia, puede_ver_incidencia:
--   Los invocan las politicas RLS (`using (public.es_lider())`), y las politicas
--   se evaluan con los privilegios de quien consulta, asi que necesitan que
--   `authenticated` tenga EXECUTE: TODAS las consultas de la app van con sesion.
--   Eso no se puede tocar.
--   Para `anon` SI se pueden quitar, pero solo despues de quitarle a `anon` el
--   permiso de tabla: con permiso de tabla llega a evaluar politicas y ahi los
--   helpers le son indispensables, y revocar el EXECUTE sin el permiso primero
--   rompia la app con "permission denied for function". Ese orden esta en
--   `cerrar-permisos-anon.sql`, que hace las dos cosas en una transaccion.
--   El cliente nunca los llama por RPC (solo existen dentro de las politicas),
--   asi que el paso que de verdad las cerraria del todo es mudarlas a un esquema
--   no expuesto; es un cambio mas grande, con su propio archivo. Sin sesion
--   devuelven false igual, porque preguntan por auth.uid().
--
-- intento_login y email_por_usuario:
--   La pantalla de login corre antes de autenticar: necesitan `anon`. De
--   `authenticated` no lo necesitan (ver abajo).
--
-- LAS DE TRIGGER
-- --------------
-- valider_registro, handle_new_user, validar_modulo_compartido y
-- validar_unico_evaluador_modulo son `returns trigger`: Postgres ya impide
-- llamarlas por RPC ("trigger functions can only be called as triggers"), asi
-- que la alerta es puro ruido. Se les quita el acceso a `anon` y se les DEJA el
-- de `authenticated` a proposito: son security definer, asi que el trigger corre
-- como dueno y no lo necesita, pero no se juega a que Postgres no vuelva a
-- verificar el permiso al disparar. Si alguna vez hiciera falta, el grant de
-- abajo lo restaura en una linea.
--
-- Es idempotente: se puede correr las veces que haga falta.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) search_path inmutable
-- ----------------------------------------------------------------------------
-- Con el search_path modificable, un esquema anterior en el camino de busqueda
-- podria resolver una tabla homonima y hacer que la funcion lea otra.
alter function public.validar_suma_puntaje_items() set search_path = public;

-- ----------------------------------------------------------------------------
-- 2) Trigger functions: `anon` no tiene por que llamarlas
-- ----------------------------------------------------------------------------
revoke execute on function public.validar_registro() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.validar_modulo_compartido() from public, anon;
revoke execute on function public.validar_unico_evaluador_modulo() from public, anon;

-- Excepcion a proposito: esta NO es security definer, asi que el trigger corre
-- como el rol que escribe (el Lider) y si necesita el permiso. Sin el grant,
-- cualquier edicion de un item falla con "permission denied for function".
revoke execute on function public.validar_suma_puntaje_items() from public, anon;
grant  execute on function public.validar_suma_puntaje_items() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Solo para quien tiene sesion
-- ----------------------------------------------------------------------------
-- Los cuerpos ya se autoprotegen: `desbloquear_usuario` exige que auth.uid() sea
-- un Lider activo (sin sesion aborta con excepcion) y `registrar_sync` escribe
-- en `where id = auth.uid()`, que para anon es NULL y no actualiza nada. Esto
-- solo evita que un anon sin sesion pueda siquiera invocarlas.
revoke execute on function public.desbloquear_usuario(uuid, text) from public, anon;
grant  execute on function public.desbloquear_usuario(uuid, text) to authenticated;

revoke execute on function public.registrar_sync() from public, anon;
grant  execute on function public.registrar_sync() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Login: `anon` si, `authenticated` no
-- ----------------------------------------------------------------------------
-- En src/context/AuthContext.tsx, `intentoLogin` y `emailPorUsuario` se llaman
-- dentro de signIn() ANTES de supabase.auth.signInWithPassword: en ese momento
-- todavia no hay sesion, asi que la peticion va con el rol `anon`. Nunca se
-- llaman con un usuario ya autenticado, asi que el permiso para `authenticated`
-- sobra.
revoke execute on function public.intento_login(text, text) from public, authenticated;
grant  execute on function public.intento_login(text, text) to anon;

revoke execute on function public.email_por_usuario(text) from public, authenticated;
grant  execute on function public.email_por_usuario(text) to anon;

-- ----------------------------------------------------------------------------
-- Verificacion
-- ----------------------------------------------------------------------------
-- Correr `diagnostico-permisos.sql` despues de esto: la columna `estado` deberia
-- salir en `ok` para todas. Si alguna sigue en otro valor, el permiso viene de
-- otro lado (mirar p.proacl en ese archivo).
--
-- Lo que queda marcado a proposito, y no se va a corregir:
--   · los 6 ayudantes de politica para `authenticated`: las politicas RLS los
--     necesitan. Para `anon` ya no, y eso lo cierra `cerrar-permisos-anon.sql`.
--   · `intento_login`/`email_por_usuario` con `anon`: es la pantalla de login.
--   · `authenticated` en las de trigger: `returns trigger` ya las hace
--     inalcanzables por RPC y se deja como margen de seguridad.
-- ============================================================================
commit;