-- ============================================================================
-- EvaLuxor - Esquema de base de datos (Supabase / Postgres)
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar (todo a la vez)
-- Idempotente: puede re-ejecutarse completo sin errores.
-- Compatible MySQL (para futura migracion a cPanel): uuid -> char(36),
-- jsonb -> JSON, auth.uid() -> session, roles -> tabla/columna.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- SUCURSALES
-- ----------------------------------------------------------------------------
create table if not exists public.sucursales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  shop_id text,
  direccion text,
  gerente_id uuid references public.profiles(id) on delete set null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

-- Idempotencia: si la tabla ya existia sin la columna shop_id
alter table public.sucursales add column if not exists shop_id text;
-- Migracion: se elimina la columna codigo (se usa solo shop_id)
alter table public.sucursales drop column if exists codigo;
-- Migracion: GERENTE S a cargo de la sucursal (opcional)
alter table public.sucursales add column if not exists gerente_id uuid references public.profiles(id) on delete set null;
-- Migracion: ID de sucursal para la API de trabajadores (branchID del edge listar-colaboradores)
alter table public.sucursales add column if not exists branch_id text;

-- ----------------------------------------------------------------------------
-- PROFILES (1:1 con auth.users; el rol y sucursal se asignan desde invitacion)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  usuario text not null default '',
  nombre text not null default '',
  rol text not null default 'SIN_ROL'
    check (rol in ('SIN_ROL','LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH')),
  sucursal_id uuid references public.sucursales(id) on delete set null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotencia: si la tabla ya existia sin la columna usuario
alter table public.profiles add column if not exists usuario text not null default '';
create unique index if not exists uniq_profiles_usuario on public.profiles (lower(usuario)) where usuario <> '';

-- Migracion: bloqueo de usuario tras 5 intentos fallidos de login
alter table public.profiles add column if not exists intentos_fallidos int not null default 0;
alter table public.profiles add column if not exists bloqueado boolean not null default false;

-- RPC: resolver el correo a partir del usuario para el login (accesible sin sesion).
-- Ignora a los bloqueados (el login de frente no los deja pasar).
create or replace function public.email_por_usuario(p_usuario text)
returns text
language sql stable security definer set search_path = public as $$
  select p.email
  from public.profiles p
  where lower(p.usuario) = lower(p_usuario)
    and p.activo
    and not p.bloqueado
  limit 1;
$$;
grant execute on function public.email_por_usuario(text) to anon, authenticated;

-- INTENTO_LOGIN: valida la contraseña (contra auth.users) y lleva el conteo.
-- Se invoca SIN sesión (pantalla de login). Por eso es security definer y puede
-- ejecutarse por anon. Respuesta JSON: { ok, bloqueado, restantes }.
-- Usuarios inactivos/inexistentes devuelven respuesta genérica (no revela existencia).
create or replace function public.intento_login(p_usuario text, p_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_prof public.profiles%rowtype;
  v_usr auth.users%rowtype;
  v_ok boolean;
begin
  select * into v_prof from public.profiles p
    where lower(p.usuario) = lower(p_usuario) and p.activo
    limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'bloqueado', false, 'restantes', 5);
  end if;

  if v_prof.bloqueado then
    return jsonb_build_object('ok', false, 'bloqueado', true, 'restantes', 0);
  end if;

  select * into v_usr from auth.users u where u.id = v_prof.id;
  if not found or v_usr.encrypted_password is null then
    return jsonb_build_object('ok', false, 'bloqueado', false, 'restantes', 5);
  end if;

  v_ok := crypt(p_password, v_usr.encrypted_password::text) = v_usr.encrypted_password::text;

  if v_ok then
    update public.profiles set intentos_fallidos = 0, bloqueado = false where id = v_prof.id;
    return jsonb_build_object('ok', true, 'bloqueado', false, 'restantes', 5);
  end if;

  v_prof.intentos_fallidos := v_prof.intentos_fallidos + 1;
  if v_prof.intentos_fallidos >= 5 then
    update public.profiles set intentos_fallidos = 5, bloqueado = true where id = v_prof.id;
    return jsonb_build_object('ok', false, 'bloqueado', true, 'restantes', 0);
  end if;

  update public.profiles set intentos_fallidos = v_prof.intentos_fallidos where id = v_prof.id;
  return jsonb_build_object('ok', false, 'bloqueado', false, 'restantes', 5 - v_prof.intentos_fallidos);
end $$;
grant execute on function public.intento_login(text, text) to anon, authenticated;

-- DESBLOQUEAR_USUARIO: solo el Líder activo. Limpia el contador/bloqueo y asigna
-- una contraseña provisional (que el usuario deberá cambiar luego).
create or replace function public.desbloquear_usuario(p_usuario_id uuid, p_password_provisional text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_lider public.profiles%rowtype;
  v_contador integer;
begin
  select * into v_lider from public.profiles p
    where p.id = auth.uid() and p.rol = 'LIDER' and p.activo;
  if not found then
    raise exception 'Solo el lider puede desbloquear usuarios.';
  end if;

  if p_password_provisional is null or length(trim(p_password_provisional)) < 6 then
    raise exception 'La contrasena provisional debe tener al menos 6 caracteres.';
  end if;

  select count(*) into v_contador from public.profiles where id = p_usuario_id;
  if v_contador = 0 then
    raise exception 'El usuario no existe.';
  end if;

  update public.profiles set intentos_fallidos = 0, bloqueado = false where id = p_usuario_id;
  update auth.users set encrypted_password = crypt(p_password_provisional, gen_salt('bf')) where id = p_usuario_id;

  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.desbloquear_usuario(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- INVITACIONES (el LIDER "crea" usuarios emitiendo un link de registro por rol)
-- ----------------------------------------------------------------------------
create table if not exists public.invitaciones (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  usuario text not null,
  rol text not null check (rol in ('LIDER','EVALUADOR','GERENTE_S','GERENTE_C','GERENTE_TH')),
  sucursal_id uuid references public.sucursales(id) on delete set null,
  token text not null unique default gen_random_uuid()::text,
  usado boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Idempotencia
alter table public.invitaciones add column if not exists usuario text not null default '';

-- Trigger: bloquea registros SIN invitación activa (solo el Líder crea usuarios).
create or replace function public.validar_registro()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.invitaciones
    where lower(email) = lower(new.email) and usado = false;
  if v_count = 0 then
    raise exception 'Registro no permitido: solo el Líder crea usuarios. Solicita tu invitación.';
  end if;
  return new;
end $$;

drop trigger if exists validar_registro on auth.users;
create trigger validar_registro
  before insert on auth.users
  for each row execute function public.validar_registro();

-- Trigger: al crearse un usuario en auth, se crea su perfil tomando rol/sucursal
-- de la invitación activa (consumida al primer uso).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitaciones%rowtype;
  v_rol text := 'SIN_ROL';
  v_sucursal uuid := null;
  v_usuario text := '';
begin
  select * into inv from public.invitaciones
    where lower(email) = lower(new.email) and usado = false
    order by created_at desc limit 1;

  if found then
    v_rol := inv.rol;
    v_sucursal := inv.sucursal_id;
    v_usuario := inv.usuario;
    update public.invitaciones set usado = true where id = inv.id;
  end if;

  insert into public.profiles (id, email, usuario, nombre, rol, sucursal_id)
  values (new.id, new.email, v_usuario, '', v_rol, v_sucursal);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- ASIGNACIONES (el LIDER asigna sucursales a evaluadores)
-- ----------------------------------------------------------------------------
create table if not exists public.asignaciones (
  id uuid primary key default gen_random_uuid(),
  evaluador_id uuid not null references public.profiles(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  activa boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (evaluador_id, sucursal_id)
);

-- ----------------------------------------------------------------------------
-- CATALOGO DE EVALUACION: MODULOS e ITEMS
-- ----------------------------------------------------------------------------
create table if not exists public.modulos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text not null default '',
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  tipo text not null check (tipo in (
    'CHECKLIST','CUMPLE_NO_CUMPLE','CONCILIACION','LISTA_COLABORADORES','UNIDAD_CHECKLIST'
  )),
  texto text not null,
  opciones jsonb not null default '[]'::jsonb, -- CHECKLIST: [{"id":"o1","etiqueta":"...","puntos":3?}]; puntos por opcion (opcional): si TODAS las opciones del CHECKLIST tienen puntos, la puntuacion del item se reparte entre ellas. LISTA_COLABORADORES: checklist compartido por cada colaborador
  colaboradores_filtro text check (colaboradores_filtro in ('ACTIVOS','INACTIVOS','TODOS')), -- LISTA_COLABORADORES: filtro aplicado al cargar colaboradores
  responsables jsonb not null default '[]'::jsonb, -- responsables configurables; cada opcion usa opciones[i].responsable
  orden integer not null default 0,
  requerido boolean not null default false,
  activo boolean not null default true,
  puntaje numeric not null default 0 check (puntaje >= 0 and puntaje <= 100), -- puntos ponderados; la suma dentro de un modulo no supera 100
  created_at timestamptz not null default now()
);
create index if not exists idx_items_modulo on public.items(modulo_id, orden);

-- La suma de los puntajes de los ítems de un módulo no puede exceder 100.
create or replace function public.validar_suma_puntaje_items() returns trigger
language plpgsql
as $$
declare
  v_modulo uuid;
  v_suma numeric;
begin
  if tg_op = 'DELETE' then
    v_modulo := old.modulo_id;
    v_suma := coalesce((
      select sum(puntaje) from public.items
       where modulo_id = v_modulo and id <> old.id
    ), 0);
  else
    v_modulo := new.modulo_id;
    v_suma := coalesce((
      select sum(puntaje) from public.items
       where modulo_id = v_modulo and (new.id is null or id <> new.id)
    ), 0) + coalesce(new.puntaje, 0);
  end if;

  if v_suma > 100 then
    raise exception 'La suma de puntos de los ítems del módulo (%) supera 100', v_modulo;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_puntaje_items on public.items;
create trigger trg_puntaje_items
  before insert or update or delete on public.items
  for each row execute function public.validar_suma_puntaje_items();

-- compatibilidad con bases previas (se eliminan los tipos ya retirados)
delete from public.items where tipo in ('COMENTARIO','FOTO','DESCRIPCION','CANTIDAD');
alter table public.items drop constraint if exists items_tipo_check;
alter table public.items add constraint items_tipo_check check (tipo in (
  'CHECKLIST','CUMPLE_NO_CUMPLE','CONCILIACION','LISTA_COLABORADORES','UNIDAD_CHECKLIST'
));

-- ----------------------------------------------------------------------------
-- ASIGNACIONES DE MODULOS (el LIDER asigna módulos a evaluadores)
-- Regla de negocio: un módulo activo solo se asigna a UN evaluador a la vez.
-- ----------------------------------------------------------------------------
create table if not exists public.asignaciones_modulos (
  id uuid primary key default gen_random_uuid(),
  evaluador_id uuid not null references public.profiles(id) on delete cascade,
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  activa boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (evaluador_id, modulo_id)
);

-- Se limpian asignaciones duplicadas previas conservando la mas antigua.
delete from public.asignaciones_modulos a
using public.asignaciones_modulos b
where a.activa and b.activa
  and a.modulo_id = b.modulo_id
  and a.created_at > b.created_at;

-- Exclusividad: un modulo activo solo puede pertenecer a un evaluador.
create unique index if not exists uniq_asignaciones_modulos_activo
  on public.asignaciones_modulos (modulo_id) where activa;

-- ----------------------------------------------------------------------------
-- CONFIGURACION POR SUCURSAL (que módulos e ítems aplican en cada sucursal)
-- Semántica: sin filas activas => aplican TODOS; con filas => solo las marcadas.
-- ----------------------------------------------------------------------------
create table if not exists public.sucursal_modulos (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sucursal_id, modulo_id)
);

create table if not exists public.sucursal_items (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sucursal_id, item_id)
);

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

-- ----------------------------------------------------------------------------
-- EVALUACIONES / RESPUESTAS / FOTOS
-- Evaluación compartida: la apertura/programa el LIDER (estado) y todos los
-- evaluadores llenan esa misma evaluación, cada uno sus módulos asignados.
-- ----------------------------------------------------------------------------
create table if not exists public.evaluaciones (
  id uuid primary key default gen_random_uuid(),
  offline_uuid uuid not null unique,          -- generado en el dispositivo (idem-potencia en sync)
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  aperturada_por uuid references public.profiles(id) on delete set null,
  fecha date not null default current_date,
  estado text not null default 'PROGRAMADA'
    check (estado in ('PROGRAMADA','ACTIVA','CERRADA')),
  puntuacion numeric(5,2),
  comentario_general text,
  abierta_en timestamptz,
  cerrada_en timestamptz,
  created_at timestamptz not null default now(),
  unique (sucursal_id, fecha)
);
create index if not exists idx_evaluaciones_sucursal on public.evaluaciones(sucursal_id, fecha);

create table if not exists public.respuestas (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  valor jsonb not null default 'null'::jsonb,
  respondido_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (evaluacion_id, item_id)
);
create index if not exists idx_respuestas_evaluacion on public.respuestas(evaluacion_id);

create table if not exists public.fotos (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_fotos_evaluacion on public.fotos(evaluacion_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.sucursales enable row level security;
alter table public.profiles enable row level security;
alter table public.invitaciones enable row level security;
alter table public.asignaciones enable row level security;
alter table public.asignaciones_modulos enable row level security;
alter table public.modulos enable row level security;
alter table public.items enable row level security;
alter table public.sucursal_modulos enable row level security;
alter table public.sucursal_items enable row level security;
alter table public.evaluaciones enable row level security;
alter table public.respuestas enable row level security;
alter table public.fotos enable row level security;

-- Ayudantes -------------------------------------------------------------------
create or replace function public.es_lider()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'LIDER' and p.activo);
$$;

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

-- Quién puede responder: LIDER siempre; EVALUADOR solo en evaluación ACTIVA y
-- de ítems cuyo módulo le está asignado y aplica a la sucursal.
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

-- SUCURSALES: lectura autenticados / escritura solo LIDER ---------------------
drop policy if exists sucursales_select on public.sucursales;
create policy sucursales_select on public.sucursales for select using (true);
drop policy if exists sucursales_lider on public.sucursales;
create policy sucursales_lider on public.sucursales for all using (public.es_lider()) with check (public.es_lider());

-- PROFILES: lectura autenticados / gestion completa solo LIDER ------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);
drop policy if exists profiles_lider on public.profiles;
create policy profiles_lider on public.profiles for all using (public.es_lider()) with check (public.es_lider());

-- INVITACIONES: solo LIDER ------------------------------------------------------
drop policy if exists invitaciones_lider on public.invitaciones;
create policy invitaciones_lider on public.invitaciones for all using (public.es_lider()) with check (public.es_lider());

-- ASIGNACIONES: evaluador ve las suyas / gestion solo LIDER --------------------
drop policy if exists asignaciones_select on public.asignaciones;
create policy asignaciones_select on public.asignaciones for select using (auth.uid() = evaluador_id or public.es_lider());
drop policy if exists asignaciones_lider on public.asignaciones;
create policy asignaciones_lider on public.asignaciones for all using (public.es_lider()) with check (public.es_lider());

-- ASIGNACIONES_MODULOS: evaluador ve las suyas / gestion solo LIDER ------------
drop policy if exists asignaciones_modulos_select on public.asignaciones_modulos;
create policy asignaciones_modulos_select on public.asignaciones_modulos for select using (auth.uid() = evaluador_id or public.es_lider());
drop policy if exists asignaciones_modulos_lider on public.asignaciones_modulos;
create policy asignaciones_modulos_lider on public.asignaciones_modulos for all using (public.es_lider()) with check (public.es_lider());

-- MODULOS / ITEMS: lectura autenticados / gestion solo LIDER -------------------
drop policy if exists modulos_select on public.modulos;
create policy modulos_select on public.modulos for select using (true);
drop policy if exists modulos_lider on public.modulos;
create policy modulos_lider on public.modulos for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists items_select on public.items;
create policy items_select on public.items for select using (true);
drop policy if exists items_lider on public.items;
create policy items_lider on public.items for all using (public.es_lider()) with check (public.es_lider());

-- CONFIG POR SUCURSAL: lectura autenticados / gestion solo LIDER ---------------
drop policy if exists sucursal_modulos_select on public.sucursal_modulos;
create policy sucursal_modulos_select on public.sucursal_modulos for select using (true);
drop policy if exists sucursal_modulos_lider on public.sucursal_modulos;
create policy sucursal_modulos_lider on public.sucursal_modulos for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists sucursal_items_select on public.sucursal_items;
create policy sucursal_items_select on public.sucursal_items for select using (true);
drop policy if exists sucursal_items_lider on public.sucursal_items;
create policy sucursal_items_lider on public.sucursal_items for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists sucursal_opciones_select on public.sucursal_opciones;
create policy sucursal_opciones_select on public.sucursal_opciones for select using (true);
drop policy if exists sucursal_opciones_lider on public.sucursal_opciones;
create policy sucursal_opciones_lider on public.sucursal_opciones for all using (public.es_lider()) with check (public.es_lider());

-- EVALUACIONES -----------------------------------------------------------------
-- Select: según rol + módulos asignados. Insert/Update/Delete: solo LIDER.
drop policy if exists evaluaciones_select on public.evaluaciones;
create policy evaluaciones_select on public.evaluaciones for select using (public.puede_ver_evaluacion(evaluaciones));
drop policy if exists evaluaciones_insert on public.evaluaciones;
create policy evaluaciones_insert on public.evaluaciones for insert with check (public.es_lider());
drop policy if exists evaluaciones_update on public.evaluaciones;
create policy evaluaciones_update on public.evaluaciones for update using (public.es_lider()) with check (public.es_lider());
drop policy if exists evaluaciones_delete on public.evaluaciones;
create policy evaluaciones_delete on public.evaluaciones for delete using (public.es_lider());

-- RESPUESTAS -------------------------------------------------------------------
drop policy if exists respuestas_select on public.respuestas;
create policy respuestas_select on public.respuestas for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);
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

-- FOTOS -------------------------------------------------------------------------
drop policy if exists fotos_select on public.fotos;
create policy fotos_select on public.fotos for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);
drop policy if exists fotos_insert on public.fotos;
create policy fotos_insert on public.fotos for insert with check (public.puede_responder(evaluacion_id, item_id));

-- REALTIME ----------------------------------------------------------------------
-- Publica respuestas para que el LIDER vea en vivo lo que los evaluadores registran.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'respuestas'
  ) then
    alter publication supabase_realtime add table public.respuestas;
  end if;
end $$;

-- ============================================================================
-- STORAGE: bucket de evidencias (privado)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false)
on conflict (id) do nothing;

drop policy if exists "evidencias_select" on storage.objects;
create policy "evidencias_select" on storage.objects for select to authenticated using (bucket_id = 'evidencias');
drop policy if exists "evidencias_insert" on storage.objects;
create policy "evidencias_insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'evidencias'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo and p.rol in ('EVALUADOR','LIDER'))
);

-- ============================================================================
-- SEED: catalogo de ejemplo (solo si no existe ningun modulo)
-- ============================================================================
insert into public.modulos (nombre, descripcion, orden)
select m.nombre, m.descripcion, m.orden
from (
  values
    ('Aseo y limpieza', 'Condiciones de aseo de pisos, estanterias y servicios', 1),
    ('Presentacion', 'Uniforme, identificacion y depto del personal', 2),
    ('Frescos', 'Calidad y rotacion en perecederos', 3),
    ('Atencion al cliente', 'Tiempos de atencion y trato', 4)
) as m(nombre, descripcion, orden)
where not exists (select 1 from public.modulos);

-- items de ejemplo (solo si no existe ningun item)
insert into public.items (modulo_id, tipo, texto, opciones, orden, requerido)
select mod.id, it.tipo, it.texto, coalesce(it.opciones::jsonb, '[]'::jsonb), it.orden, it.requerido
from public.modulos mod
cross join (
  values
    ('Aseo y limpieza', 'CHECKLIST', 'Pisos limpios y secos', '[{"id":"a1","etiqueta":"Main entrada"},{"id":"a2","etiqueta":"Pasillos"},{"id":"a3","etiqueta":"Linea de cajas"}]'::text, 1, true),
    ('Aseo y limpieza', 'CUMPLE_NO_CUMPLE', 'Servicios sanitarios en condiciones', NULL, 2, true),
    ('Presentacion', 'CUMPLE_NO_CUMPLE', 'Uniforme completo y limpio', NULL, 1, true),
    ('Presentacion', 'CUMPLE_NO_CUMPLE', 'Identificacion visible', NULL, 2, true),
    ('Frescos', 'CUMPLE_NO_CUMPLE', 'Temperatura de vitrinas adecuada', NULL, 1, true),
    ('Atencion al cliente', 'CUMPLE_NO_CUMPLE', 'Colaboradores disponibles en la tienda', NULL, 1, true)
  ) as it(modulo_nombre, tipo, texto, opciones, orden, requerido)
where mod.nombre = it.modulo_nombre
  and not exists (select 1 from public.items);