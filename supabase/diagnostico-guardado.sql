-- Diagnóstico: por qué el servidor rechaza el guardado de un evaluador
-- =====================================================================
-- La app antes mostraba "No se pudo sincronizar, revisá tu conexión" para
-- CUALQUIER error. Casi nunca era la conexión: era el servidor rechazando el
-- guardado por las políticas de RLS. Esta consulta lista las causas
-- concretas, para no adivinar.
--
-- Cómo usarlo:
--   1. Reemplazar 'USUARIO' por el usuario, nombre o correo del teléfono afectado.
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
--
-- Los registros de sección repetible (`instancias_grupo`) los governs
-- puede_manejar_instancia, que pide lo mismo SALVO el punto 2: un ítem
-- desactivado no impide guardar sus registros, solo sus respuestas. Por eso la
-- columna `bloquea` dice a qué tabla aplica cada problema, para no ir a buscar
-- al lugar equivocado.
--
-- Las cuatro aparecen abajo. `sucursal_items` NO aparece porque no bloquea el
-- guardado: RLS no lo consulta (sí afecta qué ítems se muestran en la app).
-- ============================================================================

with objetivo as (
  select p.id, p.nombre, p.usuario
  from public.profiles p
  where p.usuario ilike '%USUARIO%'
     or p.nombre ilike '%USUARIO%'
     or p.email ilike '%USUARIO%'
  limit 1
),

-- 1. Evaluaciones que le impedirían guardar: no ACTIVA (CERRADA, PROGRAMADA...).
evaluaciones_bloqueadas as (
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

-- 1.
select 'EVALUACION NO ACTIVA' as problema,
       'bloquea respuestas e instancias_grupo · estado = ' || ev.estado as detalle,
       ev.sucursal || ' · ' || to_char(ev.fecha, 'DD/MM/YYYY') as donde
from evaluaciones_bloqueadas ev

union all

-- 2.
select 'ASIGNACION DADA DE BAJA',
       'bloquea respuestas e instancias_grupo · el módulo "' || m.nombre || '" ya no le está asignado (activa = false)',
       coalesce(o.nombre, o.usuario)
from public.asignaciones_modulos am
join public.modulos m on m.id = am.modulo_id
join objetivo o on o.id = am.evaluador_id
where not am.activa

union all

-- 3. El ítem se llama `texto` en la tabla items (no tiene columna `nombre`).
select 'ITEM DESACTIVADO',
       'bloquea SOLO respuestas (las instancias sí se guardan) · ' || m.nombre || ' → ' || left(i.texto, 60) || ' (items.activo = false)',
       coalesce(o.nombre, o.usuario)
from public.items i
join public.modulos m on m.id = i.modulo_id
join public.asignaciones_modulos am on am.modulo_id = m.id and am.activa
join objetivo o on o.id = am.evaluador_id
where not i.activo

union all

-- 4. El módulo no está habilitado en una sucursal que SÍ tiene otros módulos
--    activos: el `exists` de puede_responder no lo encuentra y bloquea.
select 'MODULO NO APLICA A LA SUCURSAL',
       'bloquea respuestas e instancias_grupo · ' || m.nombre || ' → ' || b.sucursal || ' (tiene ' || b.bloqueadas || ' módulo/s activo/s, no este)',
       coalesce(o.nombre, o.usuario)
from public.asignaciones_modulos am
join public.modulos m on m.id = am.modulo_id
join objetivo o on o.id = am.evaluador_id
join lateral (
  select s.nombre as sucursal, count(*)::int as bloqueadas
  from public.sucursales s
  where exists (
          select 1 from public.sucursal_modulos sm
          where sm.sucursal_id = s.id and sm.activa
        )
    and not exists (
          select 1 from public.sucursal_modulos sm
          where sm.sucursal_id = s.id and sm.modulo_id = m.id and sm.activa
        )
  group by s.nombre
) b on true
where am.activa

order by 1, 2;
