-- ============================================================================
-- CERRAR LA LECTURA ANÓNIMA
--
-- Corre esto PRIMERO. No depende de ningún otro archivo y se puede correr las
-- veces que haga falta.
--
-- QUÉ HACE
-- --------
-- Cierra a quien no inició sesión la lectura de 7 tablas:
--
--   profiles            correos, usuario, rol y sucursal de cada persona
--   items               la rúbrica completa: puntajes, pesos y umbrales
--   modulos             la estructura de la evaluación
--   sucursales          nombres, branch_id, shop_id, gerente_id
--   sucursal_modulos    qué módulo tiene cada sucursal
--   sucursal_items      qué ítem tiene cada sucursal
--   sucursal_opciones   qué opción tiene cada sucursal
--
-- EL AGUJERO
-- ----------
-- Las 7 tenían su política de lectura así:
--
--     create policy <tabla>_select on public.<tabla> for select using (true);
--
-- Sin `to`, una política RLS aplica a PUBLIC — y PUBLIC incluye al rol `anon`.
-- Además los proyectos de Supabase arrancan con un `grant all on all tables` para
-- `anon`. Las dos cosas juntas significaban que cualquiera, sin cuenta y sin
-- contraseña, podía hacer:
--
--     curl 'https://<proyecto>.supabase.co/rest/v1/items?select=*' \
--          -H "apikey: <anon key>"
--
-- y llevarse el contenido. La app expuesta en evaluxor.vercel.app tiene la anon
-- key adentro del bundle: no es un secreto. O sea que era público para internet.
--
-- Lo que más pesa acá es `items`: no hay credenciales, pero sí la forma completa
-- de puntuar —qué vale cada punto y desde qué umbral cuenta como aprobado— que
-- es información comercial de la empresa.
--
-- POR QUÉ SUPABASE NO LO AVISÓ
-- -----------------------------
-- Las 29 alertas del advisor que había eran todas de funciones. Ni una de
-- tablas. Por eso conviene no usar el advisor como lista de pendientes: es un
-- linter de un tipo de objeto, no un inventario de la base.
--
-- POR QUÉ `to authenticated` Y NO ALGO MÁS
-- ----------------------------------------
-- Un evaluador con sesión tiene que poder leer las 7: el catálogo entero sale de
-- ahí (src/lib/data/catalog.ts, que carga CatalogContext recién cuando ya hay
-- perfil), y los joins por FK como
-- `sucursal:sucursales!profiles_sucursal_id_fkey(id, nombre)` dependen de que
-- `sucursales` sea legible. Cerrarlas a "solo yo" o a "solo el Líder" rompe esas
-- pantallas. Lo que no puede es un visitante sin sesión.
--
-- LO QUE NO SE ROMPE
-- ------------------
-- · La pantalla de login sigue funcionando: `email_por_usuario` e
--   `intento_login` son `SECURITY DEFINER`, así que corren como el dueño de la
--   tabla y no les aplica ni la política ni el revoke. Por eso hacen falta esas
--   funciones y no un select directo.
-- · El registro por invitación sigue funcionando: el token lo valida el trigger
--   `validar_registro` sobre `auth.users`, no una consulta desde el navegador.
-- · El resto de las tablas (`evaluaciones`, `respuestas`, `instancias_grupo`,
--   `fotos`, `asignaciones`, `invitaciones`, `incidencias`) ya devolvían cero
--   filas para `anon`, porque su `using` pregunta por `auth.uid()` o por
--   `es_lider()`. No hace falta tocarlas.
--
-- POR QUÉ TAMBIÉN HAY UN `revoke`
-- ------------------------------
-- La política es la puerta de RLS. El `revoke` es la segunda: los permisos de
-- Postgres son aditivos, así que si algún día RLS quedara apagado en una de estas
-- tablas (pasa, y no se ve en ningún aviso), el `grant` por defecto de Supabase
-- pasaría a ser la única puerta. Con las dos, `anon` no tiene ninguna vía.
--
-- CÓMO CORRERLO
-- -------------
--   1. Pegá el bloque de abajo en el SQL Editor y dale Run.
--   2. Es idempotente: se puede correr las veces que haga falta.
--   3. Al final está la verificación. Lo que importa es que en la primera tabla
--      (`lectura_anon`) las 7 filas de abajo salgan en `CERRADA`.
--
-- DESPUÉS DE ESTO
-- ---------------
-- Recién ahora corré `incidencias.sql` y después `reactivar-politicas.sql` (que
-- ya trae este mismo fix). El orden va en el README de `supabase/`.
-- ============================================================================

-- Cada tabla: primero se borra la política que pueda existir (por eso el `drop`
-- va explícito y no dentro de un DO: `create policy` a secas tira 42710 si ya
-- hay una, y en el SQL Editor eso corta el resto del bloque).
drop policy if exists profiles_select on public.profiles;
drop policy if exists sucursales_select on public.sucursales;
drop policy if exists modulos_select on public.modulos;
drop policy if exists items_select on public.items;
drop policy if exists sucursal_modulos_select on public.sucursal_modulos;
drop policy if exists sucursal_items_select on public.sucursal_items;
drop policy if exists sucursal_opciones_select on public.sucursal_opciones;

-- El `to authenticated` es lo que cierra. Sin esta palabra, la política sigue
-- aplicando a PUBLIC y por lo tanto a `anon`, diga lo que diga el `using`.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy sucursales_select on public.sucursales for select to authenticated using (true);
create policy modulos_select on public.modulos for select to authenticated using (true);
create policy items_select on public.items for select to authenticated using (true);
create policy sucursal_modulos_select on public.sucursal_modulos for select to authenticated using (true);
create policy sucursal_items_select on public.sucursal_items for select to authenticated using (true);
create policy sucursal_opciones_select on public.sucursal_opciones for select to authenticated using (true);

-- La segunda mitad de la cerradura.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'sucursales', 'modulos', 'items',
    'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
  ] loop
    execute format('revoke select on public.%I from anon', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verificación
-- ----------------------------------------------------------------------------
-- Las 7 filas tienen que salir en `CERRADA`.
--
-- `puede_select` en `anon` tiene que dar false en las siete. Si alguna da true, el
-- revoke no llegó a esa tabla.
--
-- Lo que sigue siendo verdad y es correcto: `authenticated` todavía puede leer
-- las 7, y en `profiles` eso incluye los correos. Cada persona ve nombre, rol y
-- sucursal del resto. Afinar `profiles` a `auth.uid() = id or es_lider()`
-- rompería los joins por FK de `aperturador` y `sucursales.gerente_id`, así que
-- eso hay que hacerlo junto con la app, no antes.
select
  t.tabla,
  has_table_privilege('anon', t.tabla, 'select') as anon_puede_select,
  has_table_privilege('authenticated', t.tabla, 'select') as sesion_puede_select,
  case
    when not has_table_privilege('anon', t.tabla, 'select') then 'CERRADA'
    when exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.tabla
        and p.policyname = t.tabla || '_select'
        and 'anon' = any (p.roles)
    ) then 'ABIERTA (la politica le da acceso a anon)'
    else 'CERRADA por politica (el permiso de tabla sigue)'
  end as lectura_anon
from unnest(array[
  'profiles', 'sucursales', 'modulos', 'items',
  'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
]) as t(tabla)
order by t.tabla;

-- Y las políticas, para confirmar que quedaron con `to authenticated`:
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'sucursales', 'modulos', 'items',
    'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
  )
  and policyname like '%\_select'
order by tablename, policyname;

-- Y que el login siga con su permiso: `intento_login` y `email_por_usuario`
-- tienen que dar true, son las dos funciones de la pantalla sin sesión.
select
  p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as sesion_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('intento_login', 'email_por_usuario')
order by p.proname;