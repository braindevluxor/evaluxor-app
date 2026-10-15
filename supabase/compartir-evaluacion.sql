-- ============================================================================
-- ENLACE PÚBLICO DE CONCILIACIÓN (pantalla de invitado)
--
-- Corre esto en el SQL Editor. Es idempotente: se puede repetir.
--
-- QUÉ RESUELVE
-- ------------
-- El coordinador de inventario quiere ver cómo va la conciliación de una
-- evaluación sin tener cuenta en la app. El backend está cerrado a `anon` a
-- propósito (ver `cerrar-permisos-anon.sql`), así que esto NO es abrir una
-- tabla: es abrir UNA función que devuelve UNA evaluación y sólo si el
-- enlace está activo.
--
-- CÓMO SE CIERRA
-- --------------
-- · La tabla nueva nace cerrada para `anon` (el `alter default privileges
--   ... revoke all on tables from anon` de `cerrar-permisos-anon.sql` lo
--   garantiza para toda tabla futura).
-- · `anon` no tiene ninguna política sobre ella: RLS le devuelve cero filas
--   aunque por error tuviera permiso de tabla.
-- · La única entrada es `ver_conciliacion_compartida(p_token)`, SECURITY
--   DEFINER, con `search_path` fijo. Si el token no existe o el enlace está
--   apagado, devuelve un objeto con `evaluacion: null` y listas vacías: no
--   se distingue entre "token equivocado" y "no hay nada", que es lo que
--   impide adivinar tokens enumerando respuestas.
-- · El token se GENERA en el cliente (32 bytes aleatorios en hex). No hay
--   forma de derivarlo de la evaluación: 2^256 de espacio, adivinarlo por
--   fuerza bruta no es viable.
--
-- RIESGO QUE QUEDA Y POR QUÉ ES ACEPTABLE
-- ---------------------------------------
-- El enlace es un secreto compartido: cualquiera que lo reciba puede ver la
-- conciliación mientras esté activo. Por eso existe `activo` y la fila se
-- puede apagar desde la app sin tocar la base. Lo que el enlace NO expone:
-- fotos, incidencias, colaboradores, otros ítems, la identidad del evaluador
-- ni el resto de las evaluaciones.
--
-- ROLLBACK
-- --------
--     revoke execute on function public.ver_conciliacion_compartida(text) from public, anon;
--     drop function public.ver_conciliacion_compartida(text);
--     drop table if exists public.evaluaciones_compartidas;
--
-- Apagar todos los enlaces sin borrar nada (una sola fila):
--     update public.evaluaciones_compartidas set activo = false;
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) La tabla: una fila por evaluación, con su token
-- ----------------------------------------------------------------------------
-- La PK es la evaluación, no el token: así "compartir" de nuevo la misma
-- evaluación REEMPLAZA el enlace anterior en vez de acumular links viejos que
-- nadie puede revocar. Es el patrón de `invitaciones.token`, con la diferencia
-- de que acá hay una sola fila por unidad de trabajo.
create table if not exists public.evaluaciones_compartidas (
  evaluacion_id uuid primary key
    references public.evaluaciones (id) on delete cascade,
  token         text   not null unique,
  activo        boolean not null default true,
  creado_por    uuid   references public.profiles (id) on delete set null,
  creado_at     timestamptz not null default now()
);

alter table public.evaluaciones_compartidas enable row level security;

-- ----------------------------------------------------------------------------
-- 2) Políticas: para sesion, nunca para anon
-- ----------------------------------------------------------------------------
-- Quien ya puede ver la evaluación puede ver que está compartida (sino, el
-- botón de compartir no tendría memoria entre sesiones).
drop policy if exists evaluaciones_compartidas_select on public.evaluaciones_compartidas;
create policy evaluaciones_compartidas_select on public.evaluaciones_compartidas
  for select to authenticated
  using (exists (
    select 1 from public.evaluaciones e
    where e.id = evaluaciones_compartidas.evaluacion_id
      and public.puede_ver_evaluacion(e)
  ));

-- Crear y apagar enlaces es configuración: mismo criterio que el catálogo.
-- Un líder apaga cualquiera, no sólo el que él creó.
drop policy if exists evaluaciones_compartidas_lider on public.evaluaciones_compartidas;
create policy evaluaciones_compartidas_lider on public.evaluaciones_compartidas
  for all to authenticated
  using (public.es_lider()) with check (public.es_lider());

-- ----------------------------------------------------------------------------
-- 3) La única puerta: leer la conciliación de un enlace
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER porque corre SIN sesión y `anon` no tiene permiso de tabla
-- sobre nada. El token es la autorización.
--
-- Devuelve sólo lo que la pantalla pública pinta: la evaluación (con su
-- sucursal o departamento), las respuestas de los ítems de conciliación, esos
-- ítems y sus contenedores, sus módulos y las opciones marcadas de la unidad.
-- NO devuelve fotos, incidencias, colaboradores ni el resto de los ítems.
--
-- `stable` a propósito: no escribe nada y PostgREST puede cachearla por
-- petición.
create or replace function public.ver_conciliacion_compartida(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with enlace as (
    select c.evaluacion_id
    from public.evaluaciones_compartidas c
    where c.activo and c.token = p_token
  ),
  ev as (
    -- Sólo columnas que la app escribe o lee por nombre en otros lados, y que
    -- la pantalla pública usa. `created_at` y `aperturada_por` quedaron fuera
    -- a propósito: la primera no está en la tabla real de algunas bases y la
    -- segunda expondría al evaluador, que el enlace no debe mostrar.
    select e.id, e.sucursal_id, e.departamento_id, e.fecha,
           e.estado, e.puntuacion, e.comentario_general, e.cerrada_en
    from public.evaluaciones e
    where e.id in (select evaluacion_id from enlace)
  ),
  resp as (
    select r.evaluacion_id, r.item_id, r.instancia_id, r.valor, r.respondido_por
    from public.respuestas r
    where r.evaluacion_id in (select evaluacion_id from enlace)
  ),
  -- Sólo los ítems de conciliación. El filtro va por `tipo` y no por los que
  -- traigan respuesta: si mañana aparece un ítem de conciliación sin responder,
  -- la pantalla lo muestra vacío en vez de no mostrarlo.
  its as (
    select i.*
    from public.items i
    where i.tipo = 'CONCILIACION'
      and i.id in (select item_id from resp)
  ),
  -- Los contenedores que los agrupan: sin ellos no se sabe en qué módulo
  -- está cada conciliación.
  padres as (
    select p.*
    from public.items p
    where p.id in (select padre_id from its where padre_id is not null)
  ),
  mods as (
    select m.*
    from public.modulos m
    where m.id in (select modulo_id from its)
  ),
  suc as (
    select s.id, s.nombre from public.sucursales s
    where s.id in (select sucursal_id from ev)
  ),
  dep as (
    select d.id, d.nombre from public.departamentos_centralizados d
    where d.id in (select departamento_id from ev)
  ),
  -- Las opciones activas de la unidad. Una evaluación es de sucursal O de
  -- departamento, así que una de las dos mitades siempre viene vacía.
  ops as (
    select o.* from public.sucursal_opciones o
     where o.sucursal_id in (select sucursal_id from ev) and o.activa
    union all
    select o.* from public.departamento_opciones o
     where o.departamento_id in (select departamento_id from ev) and o.activa
  )
  select jsonb_build_object(
    'evaluacion', (
      -- El alias hace falta en los tres: `from ev` no crea el alias `e`, y sin
      -- él Postgres resuelve `to_jsonb(e)` como una COLUMNA llamada "e".
      select to_jsonb(e) || jsonb_build_object(
        'sucursal', (select to_jsonb(s) from suc s),
        'departamento', (select to_jsonb(d) from dep d)
      )
      from ev e
    ),
    'respuestas', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from resp r),
    -- `its` y `padres` vienen de la misma tabla, así que la unión sólo
    -- desduplica y no puede mezclar columnas.
    'items',      (select coalesce(jsonb_agg(to_jsonb(i) order by i.orden), '[]'::jsonb)
                     from (select * from its union select * from padres) i),
    'modulos',    (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from mods m),
    'opciones',   (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from ops o)
  );
$$;

-- ----------------------------------------------------------------------------
-- 4) Permisos de la función
-- ----------------------------------------------------------------------------
-- `anon`, porque la pantalla corre sin sesión; y `authenticated`, porque el
-- enlace lo puede abrir alguien que YA tiene sesion (un líder mirando su
-- propio link desde un navegador con la app abierta). Sin el segundo grant,
-- abrir el enlace con la sesión puesta daba "permission denied" y parecía
-- que el enlace estaba roto.
--
-- El revoke va con PUBLIC porque los permisos en Postgres son aditivos: sin
-- quitar el grant heredado, cualquier rol seguiría pudiendo llamarla.
revoke execute on function public.ver_conciliacion_compartida(text) from public, anon;
grant  execute on function public.ver_conciliacion_compartida(text) to anon, authenticated;

commit;

-- ============================================================================
-- Verificación (sólo lectura)
-- ============================================================================

-- 1) La tabla tiene que dar anon_select = false. Si da true, el revoke general
--    de `cerrar-permisos-anon.sql` no cubrió a esta y hay que correrlo.
select
  c.relname as tabla,
  has_table_privilege('anon', c.oid, 'select')          as anon_select,
  has_table_privilege('authenticated', c.oid, 'select')  as sesion_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'evaluaciones_compartidas';

-- 2) La función tiene que ser la única abierta a anon además de las dos del
--    login. Si aparece otra acá, es una fuga.
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_puede,
  has_function_privilege('authenticated', p.oid, 'execute') as sesion_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;

-- 3) Las dos políticas existen y la tabla tiene RLS encendido.
select
  c.relname,
  c.relrowsecurity as rls,
  (select count(*)::int from pg_policies pp
    where pp.schemaname = 'public' and pp.tablename = c.relname) as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'evaluaciones_compartidas';
