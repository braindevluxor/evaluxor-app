-- ============================================================================
-- Incidencias fuera de lo programado
--
-- Lo que el evaluador ve en la tienda y no está en el formulario: una bandeja de
-- pechuga de pollo dentro de la nevera de helado, una puerta sin rotular, un
-- FIGE sin fecha de vencimiento. Se reporta desde el botón flotante de la
-- evaluación, se guarda en el teléfono y sube cuando hay señal (igual que el resto
-- del avance).
--
-- Aplicar en el SQL Editor de Supabase. Es idempotente: se puede correr de nuevo.
-- ============================================================================

create table if not exists public.incidencias (
  id uuid primary key,
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  evaluador_id uuid not null references auth.users(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  fecha date not null,
  modulo_id uuid references public.modulos(id),
  descripcion text not null,
  fotos text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

-- Cargos responsables de la incidencia. Es un jsonb y no un text[] porque cada
-- cargo lleva su propia marca: `por_validar` va en true cuando se escribió a
-- mano, que es lo que pasa siempre que no hay señal para consultar el catálogo.
-- Ese cargo puede estar mal escrito, así que no se da por bueno hasta que en la
-- próxima oportunidad se lo contrasta contra el catálogo. El Líder lo ve así
-- desde la nube: un cargo sin verificar es información, no un detalle de la UI.
--
-- jsonb (y no una tabla aparte) porque el catálogo de cargos vive en una Edge
-- Function, no en la base: no hay un `cargo_id` al que apuntar, solo el texto.
alter table public.incidencias add column if not exists responsables jsonb not null default '[]'::jsonb;

create index if not exists idx_incidencias_evaluacion on public.incidencias (evaluacion_id, created_at desc);

alter table public.incidencias enable row level security;

-- Quién puede reportar una incidencia de una evaluación: el LÍDER siempre; el
-- EVALUADOR solo si tiene un módulo activo asignado que aplique a la sucursal y
-- la evaluación está ACTIVA. Mismas reglas que `puede_responder`, pero sin exigir
-- un ítem concreto: acá la incidencia no viene de un ítem, viene de la visita.
create or replace function public.puede_reportar_incidencia(ev_id uuid, mod_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_lider() or exists (
    select 1
    from public.evaluaciones ev
    join public.asignaciones_modulos am
      on am.evaluador_id = auth.uid() and am.activa
    where ev.id = ev_id
      and ev.estado = 'ACTIVA'
      and (mod_id is null or am.modulo_id = mod_id)
      and (
        not exists (select 1 from public.sucursal_modulos sm where sm.sucursal_id = ev.sucursal_id and sm.activa)
        or exists (select 1 from public.sucursal_modulos sm where sm.sucursal_id = ev.sucursal_id and sm.activa and sm.modulo_id = am.modulo_id)
      )
  );
$$;

-- Ver una incidencia: LIDER todas; el EVALUADOR las suyas, mientras la evaluación
-- siga ACTIVA y pueda reportar en ella. La regla va en una función (como
-- `puede_ver_evaluacion` y `puede_responder` en schema.sql) porque dentro del USING
-- de una política no se puede volver a nombrar a la tabla propia: la columna se le
-- pasa como argumento y es la política quien la resuelve.
create or replace function public.puede_ver_incidencia(ev_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_lider() or exists (
    select 1
    from public.evaluaciones ev
    where ev.id = ev_id
      and ev.estado = 'ACTIVA'
      and public.puede_reportar_incidencia(ev.id, null)
  );
$$;

drop policy if exists incidencias_select on public.incidencias;
create policy incidencias_select on public.incidencias
  for select using (public.puede_ver_incidencia(evaluacion_id));

-- Crear: el que reporta es el evaluador, y tiene que estar asignado a esa evaluación.
drop policy if exists incidencias_insert on public.incidencias;
create policy incidencias_insert on public.incidencias
  for insert with check (
    auth.uid() = evaluador_id
    and public.puede_reportar_incidencia(evaluacion_id, modulo_id)
  );

-- Adjuntar las fotos al reporte (el teléfono sube primero la fila y después los
-- paths: el id del reporte lo genera el cliente y lo manda en el insert).
drop policy if exists incidencias_update on public.incidencias;
create policy incidencias_update on public.incidencias
  for update using (auth.uid() = evaluador_id) with check (auth.uid() = evaluador_id);

-- ----------------------------------------------------------------------------
-- Fotos: bucket `evidencias`, ruta `incidencias/<reporte_id>/<foto_id>`.
-- El evaluador dueño puede ver y quitar sus fotos; el LÍDER las puede ver.
-- ----------------------------------------------------------------------------
drop policy if exists storage_incidencias_insert on storage.objects;
create policy storage_incidencias_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and exists (
      select 1
      from public.incidencias i
      where i.evaluador_id = auth.uid()
        and name like 'incidencias/' || i.id::text || '/%'
    )
  );

drop policy if exists storage_incidencias_update on storage.objects;
create policy storage_incidencias_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'evidencias'
    and exists (
      select 1
      from public.incidencias i
      where i.evaluador_id = auth.uid()
        and name like 'incidencias/' || i.id::text || '/%'
    )
  )
  with check (
    bucket_id = 'evidencias'
    and exists (
      select 1
      from public.incidencias i
      where i.evaluador_id = auth.uid()
        and name like 'incidencias/' || i.id::text || '/%'
    )
  );

drop policy if exists storage_incidencias_select on storage.objects;
create policy storage_incidencias_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidencias'
    and (
      public.es_lider()
      or exists (
        select 1
        from public.incidencias i
        where i.evaluador_id = auth.uid()
          and name like 'incidencias/' || i.id::text || '/%'
      )
    )
  );

drop policy if exists storage_incidencias_delete on storage.objects;
create policy storage_incidencias_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidencias'
    and exists (
      select 1
      from public.incidencias i
      where i.evaluador_id = auth.uid()
        and name like 'incidencias/' || i.id::text || '/%'
    )
  );

comment on table public.incidencias is 'Incidencias fuera de lo programado, reportadas desde la evaluación (funciona sin conexión).';
comment on column public.incidencias.descripcion is 'Lo que vio el evaluador, con sus palabras.';
comment on column public.incidencias.fotos is 'Rutas en el bucket evidencias: incidencias/<reporte_id>/<foto_id>.';
comment on column public.incidencias.responsables is 'Cargos responsables: [{cargo, por_validar}]. por_validar=true cuando se agregó a mano sin catálogo y todavía no se confirmó.';

-- ----------------------------------------------------------------------------
-- Verificacion
-- ----------------------------------------------------------------------------
-- La columna tiene que existir y traer el default. Si `existe` sale false, el
-- `alter table` de arriba no llegó a aplicarse y los responsables no se guardan
-- (la app sigue funcionando, pero los cargos se pierden al sincronizar).
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'incidencias' and column_name = 'responsables'
  ) as existe,
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'incidencias' and column_name = 'responsables')
    as default_col,
  (select count(*) from public.incidencias
   where responsables is null or jsonb_typeof(responsables) <> 'array')  as filas_rotoas;
