-- ============================================================================
-- TALLER AUTOMOTRIZ: DE SUCURSAL A DEPARTAMENTO
--
-- POR QUÉ EXISTE ESTE ARCHIVO
-- ---------------------------
-- `departamentos-centralizados.sql` termina con:
--
--     update public.sucursales set nombre = 'Taller Automotriz' where nombre = 'Central';
--
-- Es decir: le cambió el nombre a la sucursal "Central" pero la dejó en la tabla
-- `sucursales`. El comentario de ese archivo decía "su fila queda intacta, solo
-- cambia el rótulo", y el efecto práctico es que el área se sigue evaluando como
-- sucursal. Por eso sale en Configuración > Sucursales, en /evaluar como unidad
-- disponible y —lo que se ve en el dashboard— como columna de "Ponderación por
-- sucursal y módulo", cuando su registro ya existe en `departamentos_centralizados`.
--
-- ESTE ARCHIVO
-- ------------
-- Mueve al departamento: evaluaciones, incidencias y configuración (módulos,
-- ítems, opciones). Después deja la sucursal inactiva, que es lo que la saca de
-- los tres lugares de arriba.
--
-- CÓMO SE USA
-- -----------
--   1. Corré SOLO el bloque PREVIEW y leé los cuatro puntos que imprime.
--   2. Si `colisiones_de_fecha` vino vacío, corré el APLICAR.
--   3. Es idempotente: se puede correr de nuevo y no repite nada (las filas ya
--      movidas dejan de tener `sucursal_id`, así que no vuelven a matchear).
--
-- QUÉ NO TOCA
-- -----------
-- * NO borra la fila de `sucursales`, sólo la desactiva. Borrarla dispararía el
--   `on delete cascade` de nueve tablas (evaluaciones, incidencias, asignaciones,
--   revision_pre_entrega, ...) y se llevaría el histórico puesto.
-- * Las filas de `sucursal_modulos/_items/_opciones` se COPIAN al departamento y
--   quedan donde están. Si algún día se reactiva la sucursal, su configuración
--   sigue siendo la que era, y poder deshacer vale más que ahorrar cinco filas.
-- * `profiles`, `invitaciones`, `asignaciones`, `proyectos` y
--   `revision_pre_entrega` siguen apuntando a esa sucursal: son los cinco
--   objetos que NO tienen columna de departamento a la que moverse. El punto 3
--   del PREVIEW los lista.
--
-- DESHACER
-- --------
--   update public.sucursales set activa = true where lower(nombre) = 'taller automotriz';
-- (la sucursal reaparece con su configuración intacta; las evaluaciones ya
--  movidas hay que moverlas a mano con el espejo de los UPDATE de abajo)
--
-- Aplicar en el SQL Editor de Supabase.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PREVIEW 1 — ¿Se cruzan las dos filas?
-- Si `sucursal_id` o `departamento_id` sale vacío, NO corras el APLICAR.
-- ----------------------------------------------------------------------------
select s.id          as sucursal_id,
       s.nombre      as sucursal,
       s.activa      as sucursal_activa,
       d.id          as departamento_id,
       d.nombre      as departamento
from public.sucursales s
join public.departamentos_centralizados d
  on lower(d.nombre) = lower(s.nombre)
where lower(s.nombre) = 'taller automotriz';


-- ----------------------------------------------------------------------------
-- PREVIEW 2 — ¿Hay choque de fechas?
--
-- `uniq_evaluaciones_departamento_fecha` impide que el departamento tenga dos
-- evaluaciones el mismo día. Si la de la sucursal cae un día que el departamento
-- ya evaluó, el UPDATE no puede moverla y el APLICAR entero se cae.
--
-- TENER QUE SALIR VACÍO. Si trae filas, esas fechas hay que resolverlas a mano
-- (borrar la repetida o mover la fecha) antes de correr nada.
-- ----------------------------------------------------------------------------
with u as (
  select s.id as suc_id, d.id as dep_id
  from public.sucursales s
  join public.departamentos_centralizados d
    on lower(d.nombre) = lower(s.nombre)
  where lower(s.nombre) = 'taller automotriz'
)
select ev.fecha,
       count(*) as evaluaciones_de_la_sucursal_ese_dia
from public.evaluaciones ev, u
where ev.sucursal_id = u.suc_id
  and exists (
    select 1
    from public.evaluaciones otra
    where otra.departamento_id = u.dep_id
      and otra.fecha = ev.fecha
  )
group by ev.fecha
order by ev.fecha;


-- ----------------------------------------------------------------------------
-- PREVIEW 3 — Qué se mueve.
-- ----------------------------------------------------------------------------
with u as (
  select s.id as suc_id, d.id as dep_id
  from public.sucursales s
  join public.departamentos_centralizados d
    on lower(d.nombre) = lower(s.nombre)
  where lower(s.nombre) = 'taller automotriz'
)
select 'evaluaciones' as tabla, count(*)::int as filas_a_mover
  from public.evaluaciones x, u where x.sucursal_id = u.suc_id
union all
select 'incidencias', count(*)::int
  from public.incidencias x, u where x.sucursal_id = u.suc_id
union all
select 'sucursal_modulos (se copia)', count(*)::int
  from public.sucursal_modulos x, u where x.sucursal_id = u.suc_id
union all
select 'sucursal_items (se copia)', count(*)::int
  from public.sucursal_items x, u where x.sucursal_id = u.suc_id
union all
select 'sucursal_opciones (se copia)', count(*)::int
  from public.sucursal_opciones x, u where x.sucursal_id = u.suc_id
order by 1;


-- ----------------------------------------------------------------------------
-- PREVIEW 4 — Qué queda atrás, apuntando a la sucursal que va a quedar inactiva.
--
-- Ninguno de estos cinco rompe: siguen con su FK viva porque la fila no se borra.
-- Van acá para que los tengas a la vista antes de desactivar. Si hay algo que
-- te importe (p. ej. perfiles con `sucursal_id` del taller), lo resolvés después
-- con su propio update.
-- ----------------------------------------------------------------------------
with u as (
  select s.id as suc_id
  from public.sucursales s
  where lower(s.nombre) = 'taller automotriz'
)
select 'profiles (usuarios con esa sucursal)' as tabla, count(*)::int as filas
  from public.profiles x, u where x.sucursal_id = u.suc_id
union all
select 'invitaciones', count(*)::int
  from public.invitaciones x, u where x.sucursal_id = u.suc_id
union all
select 'asignaciones (evaluadores asignados)', count(*)::int
  from public.asignaciones x, u where x.sucursal_id = u.suc_id
union all
select 'proyectos', count(*)::int
  from public.proyectos x, u where x.sucursal_id = u.suc_id
union all
select 'revision_pre_entrega', count(*)::int
  from public.revision_pre_entrega x, u where x.sucursal_id = u.suc_id
order by 1;


-- ============================================================================
-- APLICAR
-- ============================================================================
do $$
declare
  v_suc uuid;
  v_dep uuid;
  v_col integer;
  v_fechas text;
  v_eval integer;
  v_inc integer;
  v_mod integer;
  v_ite integer;
  v_opc integer;
begin
  select s.id into v_suc
    from public.sucursales s
   where lower(s.nombre) = 'taller automotriz';

  -- Ya no hay sucursal: o se corrió, o alguien la borró. Nada que mover.
  if v_suc is null then
    raise notice 'Taller Automotriz: no existe la sucursal. Nada que hacer (¿ya se corrió?).';
    return;
  end if;

  select d.id into v_dep
    from public.departamentos_centralizados d
   where lower(d.nombre) = 'taller automotriz';

  if v_dep is null then
    raise exception 'Hay una sucursal "Taller Automotriz" pero no el departamento con ese nombre. Crealo desde Configuracion > Departamentos y vuelve a correr este archivo.';
  end if;

  -- El índice único (departamento, fecha) haría fallar el UPDATE de abajo.
  -- Se chequea antes para que el error diga qué fechas chocan en lugar de un
  -- "duplicate key value violates unique constraint" sin contexto.
  select count(*) into v_col
    from public.evaluaciones ev
   where ev.sucursal_id = v_suc
     and exists (
       select 1
       from public.evaluaciones otra
       where otra.departamento_id = v_dep
         and otra.fecha = ev.fecha
     );

  if v_col > 0 then
    -- Se listan las fechas, no sólo el conteo: "duplicate key" sin contexto no
    -- dice qué día hay que mirar en Historial.
    select coalesce(string_agg(to_char(ev.fecha, 'YYYY-MM-DD'), ', ' order by ev.fecha), '')
      into v_fechas
      from public.evaluaciones ev
     where ev.sucursal_id = v_suc
       and exists (
         select 1
         from public.evaluaciones otra
         where otra.departamento_id = v_dep
           and otra.fecha = ev.fecha
       );

    raise exception 'Estas fechas ya tienen evaluacion en el departamento: %. El indice uniq_evaluaciones_departamento_fecha no deja dos el mismo dia. Resuelvelas a mano (borra la repetida o mueve la fecha) y vuelve a correr este archivo.', v_fechas;
  end if;

  -- 1) Evaluaciones: cambian de unidad. Las dos columnas se cambian en el MISMO
  --    update porque `evaluaciones_unidad_check` exige exactamente una de las dos.
  update public.evaluaciones
     set sucursal_id = null,
         departamento_id = v_dep
   where sucursal_id = v_suc;
  get diagnostics v_eval = row_count;

  -- 2) Incidencias heredan la unidad de su evaluación: mismo criterio, mismo check.
  update public.incidencias
     set sucursal_id = null,
         departamento_id = v_dep
   where sucursal_id = v_suc;
  get diagnostics v_inc = row_count;

  -- 3) Configuración: se copia, no se mueve. Los `not exists` respetan el índice
  --    único de la tabla de destino, así que correrlo dos veces no duplica ni falla.
  insert into public.departamento_modulos (departamento_id, modulo_id, activa, created_at)
  select v_dep, x.modulo_id, x.activa, x.created_at
    from public.sucursal_modulos x
   where x.sucursal_id = v_suc
     and not exists (
       select 1 from public.departamento_modulos d
        where d.departamento_id = v_dep and d.modulo_id = x.modulo_id
     );
  get diagnostics v_mod = row_count;

  insert into public.departamento_items (departamento_id, item_id, activa, created_at)
  select v_dep, x.item_id, x.activa, x.created_at
    from public.sucursal_items x
   where x.sucursal_id = v_suc
     and not exists (
       select 1 from public.departamento_items d
        where d.departamento_id = v_dep and d.item_id = x.item_id
     );
  get diagnostics v_ite = row_count;

  insert into public.departamento_opciones (departamento_id, item_id, opcion_id, activa, created_at)
  select v_dep, x.item_id, x.opcion_id, x.activa, x.created_at
    from public.sucursal_opciones x
   where x.sucursal_id = v_suc
     and not exists (
       select 1 from public.departamento_opciones d
        where d.departamento_id = v_dep
          and d.item_id = x.item_id
          and d.opcion_id = x.opcion_id
     );
  get diagnostics v_opc = row_count;

  -- 4) La sucursal deja de ser una unidad evaluable. No se borra: sólo sale del
  --    catálogo, que es lo que la saca de los gráficos y de Configuración.
  update public.sucursales
     set activa = false
   where id = v_suc;

  raise notice 'Taller Automotriz movido al departamento: % evaluaciones, % incidencias; copiados % modulos, % items y % opciones de la sucursal.',
    v_eval, v_inc, v_mod, v_ite, v_opc;
end $$;
