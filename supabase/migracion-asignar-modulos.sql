-- ============================================================================
-- EvaLuxor - Migración: asignar MÓDULOS a evaluadores
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar
-- Idempotente: puede re-ejecutarse sin errores.
-- ============================================================================

create table if not exists public.asignaciones_modulos (
  id uuid primary key default gen_random_uuid(),
  evaluador_id uuid not null references public.profiles(id) on delete cascade,
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  activa boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (evaluador_id, modulo_id)
);

alter table public.asignaciones_modulos enable row level security;

drop policy if exists asignaciones_modulos_select on public.asignaciones_modulos;
create policy asignaciones_modulos_select on public.asignaciones_modulos for select using (auth.uid() = evaluador_id or public.es_lider());

drop policy if exists asignaciones_modulos_lider on public.asignaciones_modulos;
create policy asignaciones_modulos_lider on public.asignaciones_modulos for all using (public.es_lider()) with check (public.es_lider());

-- Regla de negocio: un módulo activo solo se asigna a UN evaluador a la vez.
-- Se limpian asignaciones duplicadas previas conservando la más antigua.
delete from public.asignaciones_modulos a
using public.asignaciones_modulos b
where a.activa and b.activa
  and a.modulo_id = b.modulo_id
  and a.created_at > b.created_at;

create unique index if not exists uniq_asignaciones_modulos_activo
  on public.asignaciones_modulos (modulo_id) where activa;