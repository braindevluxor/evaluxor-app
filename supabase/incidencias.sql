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
-- Las del evaluador que reporta, para que el LÍDER las pueda ver.
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

drop policy if exists storage_incidencias_select on storage.objects;
create policy storage_incidencias_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidencias'
    and public.es_lider()
  );

comment on table public.incidencias is 'Incidencias fuera de lo programado, reportadas desde la evaluación (funciona sin conexión).';
comment on column public.incidencias.descripcion is 'Lo que vio el evaluador, con sus palabras.';
comment on column public.incidencias.fotos is 'Rutas en el bucket evidencias: incidencias/<reporte_id>/<foto_id>.';
