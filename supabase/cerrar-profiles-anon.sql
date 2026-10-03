-- ============================================================================
-- CERRAR `profiles` A QUIEN NO INICIÓ SESIÓN
--
-- EL AGUJERO
-- ---------
-- `profiles` tiene, por persona: correo, usuario, nombre, rol (LIDER, GERENTE_C,
-- GERENTE_S, GERENTE_TH, EVALUADOR), sucursal y estado. La política de lectura
-- era `for select using (true)`, sin `to authenticated`, y los proyectos de
-- Supabase arrancan con un `grant all on all tables` para `anon`. Las dos cosas
-- juntas significaban que cualquiera, sin cuenta y sin contraseña, podía hacer:
--
--     curl 'https://<proyecto>.supabase.co/rest/v1/profiles?select=*' \
--          -H "apikey: <anon key>"
--
-- y llevarse la lista completa. La app expuesta en evaluxor.vercel.app tiene la anon
-- key en el bundle: no es un secreto. O sea que era público para internet.
--
-- POR QUÉ NO LO AVISÓ SUPABASE
-- ---------------------------
-- Las 29 alertas del advisor que había eran todas de funciones. Esta, que es la
-- que más datos saca, no figuraba. Por eso conviene no usar el advisor como
-- lista de pendientes: es un linter, no un inventario.
--
-- POR QUÉ `to authenticated` Y NO MÁS
-- ----------------------------------
-- Un evaluador con sesión tiene que poder leer `profiles` para los joins por FK
-- (`aperturador:profiles!evaluaciones_aperturada_por_fkey(id, nombre)`) y para
-- los nombres de los colaboradores. Cerrarlo a "solo yo" rompería esas
-- pantallas. Lo que no puede es un visitante sin sesión.
--
-- LO QUE NO SE ROMPE
-- ------------------
-- La pantalla de login sigue funcionando: `email_por_usuario` e `intento_login`
-- son `SECURITY DEFINER`, así que corren como el dueño de la tabla y no les
-- aplica ni la política ni el revoke. Por eso hace falta la función y no un
-- select directo.
--
-- CÓMO CORRERLO
-- -------------
--   1. Pegar el bloque de abajo en el SQL Editor y darle Run.
--   2. Es idempotente: se puede correr las veces que haga falta.
--   3. Al final está la verificación. Lo importante es que las dos filas de
--      `profiles` salgan en `cerrada`.
--
-- OJO CON EL ORDEN
-- ----------------
-- `reactivar-politicas.sql` ya trae este mismo fix, así que si corrés ese
-- después no hay que correr este. Pero ese archivo depende de `incidencias.sql`
-- (repone las políticas de incidencias) y está en una transacción: si la tabla
-- `incidencias` no existe, revienta y no queda a medias, tampoco nada aplicado.
-- Este archivo no depende de nada: se puede correr primero, siempre.
-- ============================================================================

-- El `drop` va dentro de un DO porque en un editor que parte las sentencias se
-- puede haber creado antes y `create policy` solo no es idempotente (42710).
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_select'
  ) then
    execute 'drop policy profiles_select on public.profiles';
  end if;
end $$;

create policy profiles_select on public.profiles
  for select to authenticated using (true);

-- Los permisos de Postgres son ADITIVOS: aunque la política ya no deje pasar a
-- `anon`, un `grant select` explícito en el rol la saltaría. Con las dos cosas
-- cerradas, `anon` no tiene ninguna vía.
revoke select on public.profiles from anon;

-- ----------------------------------------------------------------------------
-- Verificación
-- ----------------------------------------------------------------------------
-- Las dos filas de `profiles` tienen que salir en 'cerrada'.
--
-- Lo que sigue siendo verdad y es correcto: `authenticated` todavía puede leer
-- todos los perfiles, entre ellos los correos. Cada persona ve nombre, rol y
-- sucursal del resto. Si eso molesta, el paso siguiente es afinar la política a
-- `auth.uid() = id or public.es_lider()`, pero eso rompe los joins por FK de
-- `aperturador` y `sucursales.gerente_id` y hay que hacerlo junto con la app.
select
  r.rolname,
  has_table_privilege(r.rolname, 'public.profiles', 'select') as puede_select,
  has_table_privilege(r.rolname, 'public.profiles', 'insert') as puede_insert,
  has_table_privilege(r.rolname, 'public.profiles', 'update') as puede_update,
  has_table_privilege(r.rolname, 'public.profiles', 'delete') as puede_delete,
  case
    when r.rolname = 'anon' and not has_table_privilege(r.rolname, 'public.profiles', 'select')
      then 'cerrada'
    when r.rolname = 'authenticated' and has_table_privilege(r.rolname, 'public.profiles', 'select')
      then 'abierta a sesion (lo que la app necesita)'
    else 'revisar'
  end as estado
from pg_roles r
where r.rolname in ('anon', 'authenticated')
order by r.rolname;

-- Y la política, para confirmar que quedó con `to authenticated`:
select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by policyname;
