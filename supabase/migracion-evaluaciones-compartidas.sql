-- ============================================================================
-- EvaLuxor - Migración: EVALUACIONES COMPARTIDAS
-- Solo el LIDER apertura/programa la evaluación; todos los evaluadores llenan
-- ESA MISMA evaluación, cada uno los módulos que tiene asignados.
--
-- ADVERTENCIA: este script ELIMINA todas las evaluaciones, respuestas, fotos
--   y evidencias existentes (datos de prueba). Ejecutar solo cuando sea seguro.
--
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar
-- Idempotente: puede re-ejecutarse sin errores.
-- ============================================================================

-- 1) Purgar datos previos (pruebas)
delete from public.fotos;
delete from public.respuestas;
delete from public.evaluaciones;
-- Los archivos del bucket "evidencias" se limpian desde el Dashboard de Supabase
-- (Storage -> evidencias), ya que Supabase no permite borrar storage.objects por SQL.

-- 2) EVALUACIONES: de "una por evaluador" a "compartidas por sucursal + fecha"
-- Se eliminan primero las políticas viejas que dependen de evaluador_id
-- (más abajo se recrean con el modelo nuevo).
drop policy if exists evaluaciones_insert on public.evaluaciones;
drop policy if exists evaluaciones_delete on public.evaluaciones;
drop policy if exists respuestas_insert on public.respuestas;
drop policy if exists fotos_insert on public.fotos;

alter table public.evaluaciones drop column if exists evaluador_id;
alter table public.evaluaciones add column if not exists aperturada_por uuid references public.profiles(id) on delete set null;
alter table public.evaluaciones add column if not exists estado text not null default 'PROGRAMADA'
  check (estado in ('PROGRAMADA','ACTIVA','CERRADA'));
alter table public.evaluaciones add column if not exists abierta_en timestamptz;
alter table public.evaluaciones add column if not exists cerrada_en timestamptz;
alter table public.evaluaciones drop column if exists completed_at;

-- Una sola evaluación por sucursal y fecha
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uniq_evaluaciones_sucursal_fecha'
  ) then
    alter table public.evaluaciones
      add constraint uniq_evaluaciones_sucursal_fecha unique (sucursal_id, fecha);
  end if;
end $$;

-- 3) RESPUESTAS: quién contestó cada ítem
alter table public.respuestas add column if not exists respondido_por uuid references public.profiles(id) on delete set null;

-- 4) RLS: EVALUACIONES
--    - insert: solo LIDER apertura/programa
--    - update: solo LIDER (abrir, cerrar, puntaje, comentario)
--    - delete: solo LIDER
drop policy if exists evaluaciones_insert on public.evaluaciones;
create policy evaluaciones_insert on public.evaluaciones for insert with check (public.es_lider());

drop policy if exists evaluaciones_update on public.evaluaciones;
create policy evaluaciones_update on public.evaluaciones for update using (public.es_lider()) with check (public.es_lider());

drop policy if exists evaluaciones_delete on public.evaluaciones;
create policy evaluaciones_delete on public.evaluaciones for delete using (public.es_lider());

-- 5) Visibilidad según rol + módulos asignados a la sucursal
create or replace function public.puede_ver_evaluacion(e public.evaluaciones)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
      where p.id = auth.uid() and p.activo and (
        p.rol in ('LIDER','GERENTE_C','GERENTE_TH')
        or (p.rol = 'GERENTE_S' and e.sucursal_id = p.sucursal_id)
        or (p.rol = 'EVALUADOR' and exists (
              select 1
              from public.asignaciones_modulos am
              join public.modulos m on m.id = am.modulo_id and m.activo
              where am.evaluador_id = p.id and am.activa
                and (
                  not exists (select 1 from public.sucursal_modulos sm where sm.sucursal_id = e.sucursal_id and sm.activa)
                  or exists (select 1 from public.sucursal_modulos sm where sm.sucursal_id = e.sucursal_id and sm.activa and sm.modulo_id = am.modulo_id)
                )
            )
        )
      )
  );
$$;

drop policy if exists evaluaciones_select on public.evaluaciones;
create policy evaluaciones_select on public.evaluaciones for select using (public.puede_ver_evaluacion(evaluaciones));

-- 6) Quién puede responder: LIDER siempre; EVALUADOR solo en evaluación ACTIVA
--    y de ítems cuyo módulo le está asignado y aplica a la sucursal.
create or replace function public.puede_responder(ev_id uuid, it_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_lider() or exists (
    select 1
    from public.evaluaciones ev
    join public.items i on i.id = it_id and i.activo
    join public.asignaciones_modulos am
      on am.modulo_id = i.modulo_id and am.evaluador_id = auth.uid() and am.activa
    where ev.id = ev_id and ev.estado = 'ACTIVA'
      and (
        not exists (select 1 from public.sucursal_modulos sm where sm.sucursal_id = ev.sucursal_id and sm.activa)
        or exists (select 1 from public.sucursal_modulos sm where sm.sucursal_id = ev.sucursal_id and sm.activa and sm.modulo_id = i.modulo_id)
      )
  );
$$;

drop policy if exists respuestas_insert on public.respuestas;
create policy respuestas_insert on public.respuestas for insert with check (
  public.puede_responder(evaluacion_id, item_id)
  and (respondido_por = auth.uid() or public.es_lider())
);

drop policy if exists respuestas_update on public.respuestas;
create policy respuestas_update on public.respuestas for update
  using (public.puede_responder(evaluacion_id, item_id))
  with check (public.puede_responder(evaluacion_id, item_id)
    and (respondido_por = auth.uid() or public.es_lider()));

-- EVALUADOR solo ve SUS módulos; LIDER/GERENTES ven todo
drop policy if exists respuestas_select on public.respuestas;
create policy respuestas_select on public.respuestas for select using (
  exists (
    select 1 from public.evaluaciones e
    join public.profiles p on p.id = auth.uid() and p.activo
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
      and (p.rol in ('LIDER','GERENTE_S','GERENTE_C','GERENTE_TH') or respondido_por = p.id)
  )
);

-- 7) FOTOS: insert si puede responder el ítem; select según rol/módulo
drop policy if exists fotos_insert on public.fotos;
create policy fotos_insert on public.fotos for insert with check (public.puede_responder(evaluacion_id, item_id));

drop policy if exists fotos_select on public.fotos;
create policy fotos_select on public.fotos for select using (
  exists (
    select 1 from public.evaluaciones e
    join public.profiles p on p.id = auth.uid() and p.activo
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
      and (p.rol in ('LIDER','GERENTE_S','GERENTE_C','GERENTE_TH')
           or exists (
             select 1 from public.items i
             join public.asignaciones_modulos am on am.modulo_id = i.modulo_id
             where i.id = fotos.item_id and am.evaluador_id = p.id and am.activa
           ))
  )
);