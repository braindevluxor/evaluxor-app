-- Diagnóstico: por qué el servidor rechaza el guardado de un evaluador
-- =====================================================================
-- La app antes mostraba "No se pudo sincronizar, revisá tu conexión" para
-- CUALQUIER error. Casi nunca era la conexión: era el servidor rechazando el
-- guardado por las políticas de RLS. Esta consulta lista las causas
-- concretas, para no adivinar.
--
-- Cómo usarlo:
--   1. Reemplazar 'USUARIO' por el usuario o nombre del teléfono afectado.
--   2. Correr en el SQL Editor de Supabase.
--   3. Si no devuelve filas, no hay bloqueos por política: el problema es otro
--      (red, caída del servidor, o falta aplicar parte del schema.sql) y la
--      app ahora muestra el detalle técnico en pantalla.
--
-- La regla que aplica el servidor (función puede_responder) exige, para un
-- EVALUADOR, las cuatro cosas a la vez:
--   1. que la evaluación esté en estado ACTIVA;
--   2. que el ítem esté activo;
--   3. que el módulo esté asignado al evaluador con asignaciones_modulos.activa;
--   4. que el módulo esté habilitado para esa sucursal (sucursal_modulos.activa).

with objetivo as (
  select p.id, p.nombre, p.usuario
  from public.profiles p
  where p.usuario ilike '%USUARIO%'
     or p.nombre ilike '%USUARIO%'
     or p.email ilike '%USUARIO%'
  limit 1
),

-- Evaluaciones no cerradas de las sucursales donde el evaluador tiene módulos.
evaluaciones_vivas as (
  select distinct ev.id, ev.sucursal_id, s.nombre as sucursal, ev.fecha, ev.estado
  from public.evaluaciones ev
  join public.sucursales s on s.id = ev.sucursal_id
  join public.asignaciones_modulos am on am.evaluador_id = (select id from objetivo)
  where ev.estado <> 'ACTIVA'
    and exists (
      select 1
      from public.sucursal_modulos sm
      where sm.sucursal_id = ev.sucursal_id and sm.modulo_id = am.modulo_id and sm.activa
    )
)

select 'EVALUACION NO ACTIVA' as problema,
       'estado = ' || ev.estado as detalle,
       ev.sucursal || ' · ' || to_char(ev.fecha, 'DD/MM/YYYY') as donde
from evaluaciones_vivas ev

union all

select 'ASIGNACION DADA DE BAJA',
       'el módulo "' || m.nombre || '" ya no le está asignado (activa = false)',
       coalesce(o.nombre, o.usuario)
from public.asignaciones_modulos am
join public.modulos m on m.id = am.modulo_id
join objetivo o on o.id = am.evaluador_id
where not am.activa

union all

select 'ITEM DESACTIVADO',
       m.nombre || ' → ' || i.nombre || ' (items.activo = false)',
       coalesce(o.nombre, o.usuario)
from public.items i
join public.modulos m on m.id = i.modulo_id
join public.asignaciones_modulos am on am.modulo_id = m.id and am.activa
join objetivo o on o.id = am.evaluador_id
where not i.activo

union all

select 'MODULO NO APLICA A LA SUCURSAL',
       m.nombre || ' no está habilitado en ' || s.nombre,
       coalesce(o.nombre, o.usuario)
from public.sucursal_items si
join public.sucursales s on s.id = si.sucursal_id
join public.items i on i.id = si.item_id
join public.modulos m on m.id = i.modulo_id
join public.asignaciones_modulos am on am.modulo_id = m.id and am.activa
join objetivo o on o.id = am.evaluador_id
where not si.activa

order by 1, 2;
