-- ============================================================================
-- DEPARTAMENTOS CENTRALIZADOS (áreas de la organización que no son sucursales)
--
-- Central no es una sucursal: es la oficina. Lo que ahí se evalúa son sus
-- departamentos (Mercadeo, Taller, Talento Humano, Administración, ...), y
-- cada uno se evalúa por su cuenta, como una tienda.
--
-- Van aparte de `sucursales` porque no tienen shop_id, ni branch_id, ni
-- dirección, ni Gerente S, y `evaluaciones` tendrá que apuntar a ellos cuando
-- se abra una evaluación de área.
--
-- EL NOMBRE NO ES `departamentos` A PROPÓSITO
-- ------------------------------------------
-- En la base ya existe una tabla `departamentos` (de otro proceso: trae una
-- columna `codigo NOT NULL` que no conocíamos). Para no pisarla ni depender
-- de lo que tenga adentro, la de acá se llama `departamentos_centralizados`.
-- En la app se ven y se llaman igual que siempre: "Departamentos". El sufijo
-- es solo del objeto físico.
--
-- Aplicar en el SQL Editor de Supabase. Es idempotente: se puede correr de nuevo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Catálogo
-- ----------------------------------------------------------------------------
create table if not exists public.departamentos_centralizados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.departamentos_centralizados is
  'Departamento/área de la organización evaluada por separado (Mercadeo, Taller, Talento Humano, ...). No es una sucursal. Se llama *_centralizados para no chocar con la tabla departamentos preexistente.';

-- Un departamento no se repite, ni siquiera con distinta capitalización
-- ("Mercadeo" y "mercadeo" son el mismo). El índice es sobre minúsculas; si
-- intentan guardar uno repetido, la pantalla lo dice con su propio mensaje.
drop index if exists uniq_departamentos_centralizados_nombre;
create unique index if not exists uniq_departamentos_centralizados_nombre
  on public.departamentos_centralizados (lower(nombre));

-- ----------------------------------------------------------------------------
-- RLS: lectura para cualquiera autenticado, gestión solo LÍDER
--
-- Igual que `sucursales`. El `to authenticated` en la de lectura es lo que
-- impide que el rol `anon` (con el `grant all` inicial del proyecto) lea el
-- catálogo sin sesión: mismo criterio de `cerrar-lectura-anon.sql`.
-- ----------------------------------------------------------------------------
alter table public.departamentos_centralizados enable row level security;

drop policy if exists departamentos_centralizados_select on public.departamentos_centralizados;
create policy departamentos_centralizados_select on public.departamentos_centralizados
  for select to authenticated using (true);

drop policy if exists departamentos_centralizados_lider on public.departamentos_centralizados;
create policy departamentos_centralizados_lider on public.departamentos_centralizados
  for all using (public.es_lider()) with check (public.es_lider());

-- ----------------------------------------------------------------------------
-- Configuración por departamento: módulos, ítems y puntos que aplican.
--
-- Es el gemelo de sucursal_modulos / sucursal_items / sucursal_opciones, con la
-- unidad apuntando al departamento. Misma semántica en las tres: SIN filas
-- activas aplica todo (canónicamente "sin selección = todos"), CON filas aplica
-- solo lo marcado. Los nombres no llevan prefijo "departamento_" porque esos
-- ya son de esta tabla; acá sí, para que el nombre diga de qué unidad habla.
-- ----------------------------------------------------------------------------
create table if not exists public.departamento_modulos (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid not null references public.departamentos_centralizados(id) on delete cascade,
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (departamento_id, modulo_id)
);

create table if not exists public.departamento_items (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid not null references public.departamentos_centralizados(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (departamento_id, item_id)
);

create table if not exists public.departamento_opciones (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid not null references public.departamentos_centralizados(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  opcion_id text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (departamento_id, item_id, opcion_id)
);

-- Mismo trato que la configuración por sucursal: leen los autenticados,
-- gestiona solo el LÍDER.
drop policy if exists departamento_modulos_select on public.departamento_modulos;
create policy departamento_modulos_select on public.departamento_modulos
  for select to authenticated using (true);
drop policy if exists departamento_modulos_lider on public.departamento_modulos;
create policy departamento_modulos_lider on public.departamento_modulos
  for all using (public.es_lider()) with check (public.es_lider());

drop policy if exists departamento_items_select on public.departamento_items;
create policy departamento_items_select on public.departamento_items
  for select to authenticated using (true);
drop policy if exists departamento_items_lider on public.departamento_items;
create policy departamento_items_lider on public.departamento_items
  for all using (public.es_lider()) with check (public.es_lider());

drop policy if exists departamento_opciones_select on public.departamento_opciones;
create policy departamento_opciones_select on public.departamento_opciones
  for select to authenticated using (true);
drop policy if exists departamento_opciones_lider on public.departamento_opciones;
create policy departamento_opciones_lider on public.departamento_opciones
  for all using (public.es_lider()) with check (public.es_lider());

-- ----------------------------------------------------------------------------
-- La sucursal "Central" tampoco era una sucursal: pasa a llamarse
-- "Taller Automotriz" (su fila queda intacta, solo cambia el rótulo).
--
-- Idempotente por el `where`: si ya se cambió a mano, no toca nada. También se
-- puede hacer desde Configuración > Sucursales > lápiz.
-- ----------------------------------------------------------------------------
update public.sucursales set nombre = 'Taller Automotriz' where nombre = 'Central';

-- ----------------------------------------------------------------------------
-- Siembra inicial: SOLO si la tabla quedó vacía.
--
-- Son los cuatro primeros que nacen. Después se editan, agregan o desactivan
-- desde Configuración > Departamentos; si ya hay filas, este bloque no vuelve
-- a correr y no pisa lo que hayas renombrado.
-- ----------------------------------------------------------------------------
insert into public.departamentos_centralizados (nombre)
select v.nombre
from (values
  ('Mercadeo'),
  ('Taller'),
  ('Talento Humano'),
  ('Administración')
) as v(nombre)
where not exists (select 1 from public.departamentos_centralizados);
