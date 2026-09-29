-- ============================================================================
-- EvaLuxor - Proyectos y biométrico (fichajes del lector Anviz D100 por USB)
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar (todo a la vez)
-- Idempotente: puede re-ejecutarse completo sin errores.
-- ----------------------------------------------------------------------------
-- El D100 se lee con una "app puente" de escritorio (carpeta /biometrico-bridge
-- de este repo). La web sincroniza los marcajes que esa app expone por HTTP
-- local y los guarda aquí, en la nube, para consultarlos desde cualquier lugar.
-- ============================================================================

-- PROYECTOS (las "carpetas" del menú Proyectos) ------------------------------
create table if not exists public.proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text not null default '',
  tipo text not null default 'GENERICO' check (tipo in ('BIOMETRICO', 'GENERICO')),
  sucursal_id uuid references public.sucursales(id) on delete set null,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- MARCAJES (fichajes del biométrico) ----------------------------------------
create table if not exists public.marcajes (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  trabajador_dni text not null,
  trabajador_nombre text not null default '',
  rol text not null default '',
  tipo text not null default 'OTRO' check (tipo in ('ENTRADA', 'SALIDA', 'OTRO')),
  marcado_en timestamptz not null,
  creado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (proyecto_id, trabajador_dni, marcado_en)
);

create index if not exists idx_marcajes_proyecto on public.marcajes(proyecto_id, marcado_en);
create index if not exists idx_marcajes_dni on public.marcajes(proyecto_id, trabajador_dni, marcado_en);

-- RLS: cualquiera con sesión puede leer; solo el LIDER escribe o administra ---
alter table public.proyectos enable row level security;
alter table public.marcajes enable row level security;

drop policy if exists proyectos_select on public.proyectos;
create policy proyectos_select on public.proyectos
  for select using (true);

drop policy if exists proyectos_lider on public.proyectos;
create policy proyectos_lider on public.proyectos
  for all using (public.es_lider()) with check (public.es_lider());

drop policy if exists marcajes_select on public.marcajes;
create policy marcajes_select on public.marcajes
  for select using (true);

drop policy if exists marcajes_lider on public.marcajes;
create policy marcajes_lider on public.marcajes
  for all using (public.es_lider()) with check (public.es_lider());

-- REALTIME (opcional: reflejar sincronizaciones en vivo sin recargar) ---------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'marcajes'
  ) then
    alter publication supabase_realtime add table public.marcajes;
  end if;
end $$;

-- SEED: el primer proyecto es el biométrico D100 ------------------------------
insert into public.proyectos (nombre, descripcion, tipo)
select 'Biométrico D100 (Anviz)',
       'Fichajes (marcajes) del lector biométrico Anviz D100 conectado por USB mediante la app puente.',
       'BIOMETRICO'
where not exists (select 1 from public.proyectos where tipo = 'BIOMETRICO');