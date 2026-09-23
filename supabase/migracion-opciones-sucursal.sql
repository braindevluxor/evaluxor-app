-- Opciones de un ítem tipo CHECKLIST que aplican en la sucursal.
-- Semántica: sin filas activas => aplican TODAS las opciones del ítem; con filas => solo las marcadas.

create table if not exists public.sucursal_opciones (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  opcion_id text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sucursal_id, item_id, opcion_id)
);

alter table public.sucursal_opciones enable row level security;

drop policy if exists sucursal_opciones_select on public.sucursal_opciones;
create policy sucursal_opciones_select on public.sucursal_opciones for select using (true);

drop policy if exists sucursal_opciones_lider on public.sucursal_opciones;
create policy sucursal_opciones_lider on public.sucursal_opciones for all using (public.es_lider()) with check (public.es_lider());