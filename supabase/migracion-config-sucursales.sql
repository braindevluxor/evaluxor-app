-- ============================================================================
-- EvaLuxor - Migración: configuración de MÓDULOS e ÍTEMS por SUCURSAL
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar
-- Idempotente: puede re-ejecutarse sin errores.
-- Semántica: si una sucursal no tiene filas activas, aplican TODOS los
-- módulos/ítems. Si tiene filas activas, solo esos aplican para esa sucursal.
-- ============================================================================

-- Configuración de módulos por sucursal
create table if not exists public.sucursal_modulos (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sucursal_id, modulo_id)
);

-- Configuración de ítems por sucursal
create table if not exists public.sucursal_items (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sucursal_id, item_id)
);

alter table public.sucursal_modulos enable row level security;
alter table public.sucursal_items enable row level security;

-- Lectura: cualquier usuario autenticado (los evaluadores usan el catálogo).
drop policy if exists sucursal_modulos_select on public.sucursal_modulos;
create policy sucursal_modulos_select on public.sucursal_modulos for select using (true);

drop policy if exists sucursal_items_select on public.sucursal_items;
create policy sucursal_items_select on public.sucursal_items for select using (true);

-- Escritura: solo el líder.
drop policy if exists sucursal_modulos_lider on public.sucursal_modulos;
create policy sucursal_modulos_lider on public.sucursal_modulos for all using (public.es_lider()) with check (public.es_lider());

drop policy if exists sucursal_items_lider on public.sucursal_items;
create policy sucursal_items_lider on public.sucursal_items for all using (public.es_lider()) with check (public.es_lider());