
-- ###########################################################################
-- Archivo consolidado: schema.sql
-- ###########################################################################
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
-- DEPARTAMENTOS CENTRALIZADOS (areas de la organizacion que NO son sucursales)
--
-- Central es la oficina: lo que se evalua ahi son sus departamentos (Mercadeo,
-- Taller, Talento Humano, Administracion, ...), y cada uno tiene su propia
-- evaluacion. Van aparte porque no tienen shop_id, branch_id, direccion ni
-- Gerente S.
--
-- El nombre lleva el sufijo "_centralizados" porque en la base ya existia una
-- tabla `departamentos` de otro proceso (trae una columna `codigo NOT NULL`):
-- no se pisa y no se depende de lo que tenga adentro. En la app se llaman
-- "Departamentos". Ver el detalle y la siembra en
-- `departamentos-centralizados.sql`.
-- ----------------------------------------------------------------------------
create table if not exists public.departamentos_centralizados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

drop index if exists uniq_departamentos_centralizados_nombre;
create unique index if not exists uniq_departamentos_centralizados_nombre
  on public.departamentos_centralizados (lower(nombre));

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
-- Solo `anon`: la pantalla de login corre sin sesiÃ³n. `authenticated` no la
-- necesita (ya hay sesiÃ³n si hay usuario) y dejÃ¡rsela es lo que dispara dos de
-- las alertas del advisor sin motivo. Ver `permisos-funcion.sql`.
grant execute on function public.email_por_usuario(text) to anon;

-- INTENTO_LOGIN: valida la contraseÃ±a (contra auth.users) y lleva el conteo.
-- Se invoca SIN sesiÃ³n (pantalla de login). Por eso es security definer y puede
-- ejecutarse por anon. Respuesta JSON: { ok, bloqueado, restantes }.
-- Usuarios inactivos/inexistentes devuelven respuesta genÃ©rica (no revela existencia).
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
-- Solo `anon`, por lo mismo que `email_por_usuario`: la login screen no tiene
-- sesiÃ³n todavÃ­a.
grant execute on function public.intento_login(text, text) to anon;

-- DESBLOQUEAR_USUARIO: solo el LÃ­der activo. Limpia el contador/bloqueo y asigna
-- una contraseÃ±a provisional (que el usuario deberÃ¡ cambiar luego).
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

-- Trigger: bloquea registros SIN invitaciÃ³n activa (solo el LÃ­der crea usuarios).
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
    raise exception 'Registro no permitido: solo el LÃ­der crea usuarios. Solicita tu invitaciÃ³n.';
  end if;
  return new;
end $$;

drop trigger if exists validar_registro on auth.users;
create trigger validar_registro
  before insert on auth.users
  for each row execute function public.validar_registro();

-- Trigger: al crearse un usuario en auth, se crea su perfil tomando rol/sucursal
-- de la invitaciÃ³n activa (consumida al primer uso).
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
  icono text not null default 'clipboard-list',
  orden integer not null default 0,
  activo boolean not null default true,
  -- Compartido: varios evaluadores pueden llenar el mismo mÃ³dulo a la vez y ven
  -- el avance del otro en vivo (colaboraciÃ³n). No compartido = un solo evaluador.
  compartido boolean not null default false,
  created_at timestamptz not null default now()
);
-- Upgrade de instalaciones existentes.
alter table public.modulos add column if not exists compartido boolean not null default false;
alter table public.modulos add column if not exists icono text not null default 'clipboard-list';

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  tipo text not null check (tipo in (
    'CHECKLIST','CUMPLE_NO_CUMPLE','CONCILIACION','LISTA_COLABORADORES','UNIDAD_CHECKLIST','PLANO_XY','CONTENEDOR'
  )),
  texto text not null,
  opciones jsonb not null default '[]'::jsonb, -- CHECKLIST: [{"id":"o1","etiqueta":"...","puntos":3?,"tipo_respuesta":"CHECK|RANGO","minimo":30?,"unidad":"cm"?}]; puntos por opcion (opcional, hasta 3 decimales y mÃ­n. 0.001): si TODAS las opciones del CHECKLIST tienen puntos, la puntuacion del item se reparte entre ellas. tipo_respuesta RANGO: el evaluador ingresa un valor numerico y el punto cumple si alcanza el minimo aceptable. LISTA_COLABORADORES: checklist compartido por cada trabajador. PLANO_XY: sin opciones; el evaluador sube la imagen del layout y marca puntos (pines) con cumple/no cumple
  colaboradores_filtro text check (colaboradores_filtro in ('ACTIVOS','INACTIVOS','TODOS')), -- LISTA_COLABORADORES: filtro aplicado al cargar trabajadores
  responsables jsonb not null default '[]'::jsonb, -- responsables configurables; cada opcion usa opciones[i].responsable
  orden integer not null default 0,
  requerido boolean not null default false,
  activo boolean not null default true,
  puntaje numeric not null default 0 check (puntaje >= 0 and puntaje <= 100), -- puntos ponderados (hasta 3 decimales). Suma de secciones (ponderadas) + Ã­tems sueltos del mÃ³dulo â‰¤ 100; los Ã­tems de un grupo no superan los puntos de su secciÃ³n
  padre_id uuid references public.items(id) on delete cascade, -- hijo de una seccion CONTENEDOR (un solo nivel)
  created_at timestamptz not null default now()
);
create index if not exists idx_items_modulo on public.items(modulo_id, orden);

-- SecciÃ³n CONTENEDOR con API: al agregar registros se consulta una API
-- (trabajadores | vehiculos | productos) y se guardan los valores elegidos
-- (items.api_campos) con cada registro. Informativos, no afectan el puntaje.
alter table public.items add column if not exists api_id text;
alter table public.items add column if not exists api_campos jsonb not null default '[]'::jsonb;
alter table public.items add column if not exists permitir_duplicados boolean not null default false;
-- UNIDAD_CHECKLIST: repetible = permite cargar el checklist varias veces (una
-- unidad por carga); con false solo se carga una sola vez.
alter table public.items add column if not exists repetible boolean not null default true;
-- CONCILIACION: dato del sistema que se usa como teÃ³rica de referencia al
-- escanear un producto (soh â†’ stock o finalBase â†’ precio base). Se configura
-- al crear/editar el Ã­tem en Config.
alter table public.items add column if not exists contra_dato text not null default 'SOH';
alter table public.items drop constraint if exists items_contra_dato_check;
alter table public.items add constraint items_contra_dato_check check (contra_dato in ('SOH','FINAL_BASE'));

-- La suma de los puntajes de un mÃ³dulo no puede exceder 100: cuentan las secciones
-- (CONTENEDOR, ponderadas) y los Ã­tems sueltos (sin secciÃ³n). Los Ã­tems dentro de
-- una secciÃ³n no suman al mÃ³dulo: su tope es el puntaje de la secciÃ³n.
create or replace function public.validar_suma_puntaje_items() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_modulo uuid;
  v_suma_modulo numeric;
  v_suma_hijos numeric;
  v_padre_puntaje numeric;
begin
  if tg_op = 'DELETE' then
    v_modulo := old.modulo_id;
    v_suma_modulo := coalesce((
      select sum(puntaje) from public.items
       where modulo_id = v_modulo and id <> old.id
         and (tipo = 'CONTENEDOR' or padre_id is null)
    ), 0);
    if v_suma_modulo > 100 then
      raise exception 'La suma de puntos de las secciones e Ã­tems sueltos del mÃ³dulo (%) supera 100', v_modulo;
    end if;
    return old;
  end if;

  v_modulo := new.modulo_id;

  -- En una secciÃ³n, los hijos representan el 100% interno del grupo y el porcentaje
  -- logrado se aplica sobre el puntaje de la secciÃ³n. Por eso no se impone un tope
  -- directo entre ambos: la secciÃ³n es la ponderaciÃ³n final del resultado del grupo.

  -- MÃ³dulo: secciones ponderadas e Ã­tems sueltos suman hasta 100.
  v_suma_modulo := coalesce((
    select sum(puntaje) from public.items
     where modulo_id = v_modulo and (new.id is null or id <> new.id)
       and (tipo = 'CONTENEDOR' or padre_id is null)
  ), 0)
  + case
      when new.tipo = 'CONTENEDOR' then coalesce(new.puntaje, 0)
      when new.padre_id is null then coalesce(new.puntaje, 0)
      else 0
    end;

  if v_suma_modulo > 100 then
    raise exception 'La suma de puntos de las secciones e Ã­tems sueltos del mÃ³dulo (%) supera 100', v_modulo;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_puntaje_items on public.items;
create trigger trg_puntaje_items
  before insert or update or delete on public.items
  for each row execute function public.validar_suma_puntaje_items();

-- compatibilidad con bases previas (se eliminan los tipos ya retirados)
delete from public.items where tipo in ('COMENTARIO','FOTO','DESCRIPCION','CANTIDAD');
alter table public.items add column if not exists padre_id uuid references public.items(id) on delete cascade;
alter table public.items drop constraint if exists items_tipo_check;
alter table public.items add constraint items_tipo_check check (tipo in (
  'CHECKLIST','CUMPLE_NO_CUMPLE','CONCILIACION','LISTA_COLABORADORES','UNIDAD_CHECKLIST','PLANO_XY','CONTENEDOR'
));

-- ----------------------------------------------------------------------------
-- ASIGNACIONES DE MODULOS (el LIDER asigna mÃ³dulos a evaluadores)
-- Regla de negocio: un mÃ³dulo NO compartido se asigna a UN evaluador activo a la
-- vez; un mÃ³dulo COMPARTIDO puede tener varios evaluadores (colaboraciÃ³n en vivo).
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
-- (Solo aplica a mÃ³dulos NO compartidos: los compartidos admiten varios evaluadores.)
delete from public.asignaciones_modulos a
using public.asignaciones_modulos b
where a.activa and b.activa
  and a.modulo_id = b.modulo_id
  and a.created_at > b.created_at
  and not exists (select 1 from public.modulos m where m.id = a.modulo_id and m.compartido);

-- Exclusividad condicional: solo se exige Ãºnico evaluador para mÃ³dulos NO compartidos.
drop index if exists uniq_asignaciones_modulos_activo;

create or replace function public.validar_unico_evaluador_modulo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_compartido boolean;
begin
  select coalesce(m.compartido, false) into v_compartido
  from public.modulos m where m.id = new.modulo_id;
  if not v_compartido and new.activa then
    if exists (
      select 1 from public.asignaciones_modulos a
      where a.activa and a.modulo_id = new.modulo_id
        and a.evaluador_id <> new.evaluador_id
    ) then
      raise exception 'El mÃ³dulo no estÃ¡ compartido: ya tiene un evaluador asignado.';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_unico_evaluador_modulo on public.asignaciones_modulos;
create trigger trg_unico_evaluador_modulo
  before insert or update on public.asignaciones_modulos
  for each row execute function public.validar_unico_evaluador_modulo();

-- ProtecciÃ³n al desactivar "compartido": si ya hay varios evaluadores activos
-- asignados, hay que desasignar primero.
create or replace function public.validar_modulo_compartido()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_asignados integer;
begin
  if old.compartido and not new.compartido then
    select count(*) into v_asignados
    from public.asignaciones_modulos a where a.activa and a.modulo_id = old.id;
    if v_asignados > 1 then
      raise exception 'No se puede quitar "compartido": hay % evaluadores activos asignados. Desasignalo primero.', v_asignados;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_modulo_compartido on public.modulos;
create trigger trg_modulo_compartido
  before update on public.modulos
  for each row execute function public.validar_modulo_compartido();

-- ----------------------------------------------------------------------------
-- CONFIGURACION POR SUCURSAL (que mÃ³dulos e Ã­tems aplican en cada sucursal)
-- SemÃ¡ntica: sin filas activas => aplican TODOS; con filas => solo las marcadas.
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

-- Opciones de un Ã­tem tipo CHECKLIST que aplican en la sucursal.
-- SemÃ¡ntica: sin filas activas => aplican TODAS las opciones del Ã­tem; con filas => solo las marcadas.
create table if not exists public.sucursal_opciones (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  opcion_id text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sucursal_id, item_id, opcion_id)
);

-- CONFIG POR DEPARTAMENTO: gemelo de la de sucursales, con la unidad apuntando
-- a departamentos_centralizados. Misma semantica: sin filas activas aplica todo.
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

-- ----------------------------------------------------------------------------
-- EVALUACIONES / RESPUESTAS / FOTOS
-- EvaluaciÃ³n compartida: la apertura/programa el LIDER (estado) y todos los
-- evaluadores llenan esa misma evaluaciÃ³n, cada uno sus mÃ³dulos asignados.
-- ----------------------------------------------------------------------------
create table if not exists public.evaluaciones (
  id uuid primary key default gen_random_uuid(),
  offline_uuid uuid not null unique,          -- generado en el dispositivo (idem-potencia en sync)
  -- UNIDAD: una sucursal O un departamento centralizado. Exactamente una de las
  -- dos, nunca las dos ni ninguna (lo impone el check de abajo).
  sucursal_id uuid references public.sucursales(id) on delete cascade,
  departamento_id uuid references public.departamentos_centralizados(id) on delete cascade,
  aperturada_por uuid references public.profiles(id) on delete set null,
  fecha date not null default current_date,
  estado text not null default 'PROGRAMADA'
    check (estado in ('PROGRAMADA','ACTIVA','CERRADA')),
  puntuacion numeric(5,2),
  comentario_general text,
  abierta_en timestamptz,
  cerrada_en timestamptz,
  created_at timestamptz not null default now(),
  unique (sucursal_id, fecha),
  -- XOR: la evaluación mide una sola unidad, sucursal O departamento.
  constraint evaluaciones_unidad_check
    check ((sucursal_id is null) <> (departamento_id is null))
);
create index if not exists idx_evaluaciones_sucursal on public.evaluaciones(sucursal_id, fecha);
-- `unique (sucursal_id, fecha)` no cubre las de departamento: Postgres compara
-- los null como distintos. Ellas llevan su propio índice único.
create unique index if not exists uniq_evaluaciones_departamento_fecha
  on public.evaluaciones (departamento_id, fecha) where departamento_id is not null;
create index if not exists idx_evaluaciones_departamento on public.evaluaciones(departamento_id, fecha);

-- Registros repetibles de una secciÃ³n (CONTENEDOR): cada fila es una "planilla"
-- del grupo (ej. un vehÃ­culo, un productoâ€¦) identificada por su etiqueta (texto libre).
create table if not exists public.instancias_grupo (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade, -- el CONTENEDOR
  etiqueta text not null default '',
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_instancias_grupo_evaluacion on public.instancias_grupo(evaluacion_id, item_id, orden);

-- Valores traÃ­dos de la API por registro (segÃºn items.api_campos de la secciÃ³n).
alter table public.instancias_grupo add column if not exists api_id text;
alter table public.instancias_grupo add column if not exists datos jsonb;

create table if not exists public.respuestas (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  instancia_id uuid references public.instancias_grupo(id) on delete cascade, -- null = Ã­tem respondido directo
  valor jsonb not null default 'null'::jsonb,
  respondido_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_respuestas_evaluacion on public.respuestas(evaluacion_id);
-- Unicidad: una respuesta por (evaluaciÃ³n, Ã­tem, registro). Se usan dos Ã­ndices
-- parciales (directas con instancia_id NULL; registros con instancia_id NOT NULL):
-- PostgREST/ON CONFLICT no infiere Ã­ndices `NULLS NOT DISTINCT`, pero sÃ­ infiere
-- Ã­ndices parciales cuando el conflicto declara su predicado. Como PostgREST no
-- puede enviar predicados en `on_conflict`, el upsert se hace vÃ­a la funciÃ³n
-- `upsert_respuestas` (definida abajo), que declara el predicado exacto.
create unique index if not exists uniq_respuestas_directas
  on public.respuestas(evaluacion_id, item_id) where instancia_id is null;
create unique index if not exists uniq_respuestas_instancia
  on public.respuestas(evaluacion_id, item_id, instancia_id) where instancia_id is not null;

create table if not exists public.fotos (
  id uuid primary key default gen_random_uuid(),
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  instancia_id uuid references public.instancias_grupo(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_fotos_evaluacion on public.fotos(evaluacion_id);

-- compatibilidad con bases previas (secciones repetibles / registros)
alter table public.respuestas add column if not exists instancia_id uuid references public.instancias_grupo(id) on delete cascade;
alter table public.respuestas drop constraint if exists respuestas_evaluacion_id_item_id_key;
alter table public.fotos add column if not exists instancia_id uuid references public.instancias_grupo(id) on delete cascade;
-- La migraciÃ³n anterior a un Ãºnico Ã­ndice `NULLS NOT DISTINCT` no funciona en
-- todas las versiones de Postgres (no se infiere en ON CONFLICT). Se revierte al
-- estado correcto: dos Ã­ndices parciales que sÃ­ se infieren declarando su
-- predicado, y el upsert se hace vÃ­a la funciÃ³n `upsert_respuestas`.
drop index if exists public.uniq_respuestas_por_instancia;
create unique index if not exists uniq_respuestas_directas
  on public.respuestas(evaluacion_id, item_id) where instancia_id is null;
create unique index if not exists uniq_respuestas_instancia
  on public.respuestas(evaluacion_id, item_id, instancia_id) where instancia_id is not null;

-- Upsert transaccional de respuestas (directas y por registro). Recibe un arreglo
-- jsonb; por cada fila ejecuta INSERT ... ON CONFLICT declarando el predicado
-- exacto del Ã­ndice parcial correspondiente, asÃ­ la inferencia encuentra el Ã­ndice
-- en cualquier versiÃ³n de Postgres (9.5+). Con `security invoker` se aplican las
-- polÃ­ticas RLS de respuestas (insert/update), igual que con el upsert de PostgREST.
create or replace function public.upsert_respuestas(rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r jsonb;
begin
  for r in select jsonb_array_elements(rows) loop
    if (r->>'instancia_id') is null then
      insert into public.respuestas (evaluacion_id, item_id, valor, respondido_por)
      values ((r->>'evaluacion_id')::uuid, (r->>'item_id')::uuid, r->'valor', (r->>'respondido_por')::uuid)
      on conflict (evaluacion_id, item_id) where instancia_id is null
      do update set valor = excluded.valor, respondido_por = excluded.respondido_por;
    else
      insert into public.respuestas (evaluacion_id, item_id, instancia_id, valor, respondido_por)
      values ((r->>'evaluacion_id')::uuid, (r->>'item_id')::uuid, (r->>'instancia_id')::uuid, r->'valor', (r->>'respondido_por')::uuid)
      on conflict (evaluacion_id, item_id, instancia_id) where instancia_id is not null
      do update set valor = excluded.valor, respondido_por = excluded.respondido_por;
    end if;
  end loop;
end;
$$;

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

-- ¿Aplica este mÃ³dulo a esta evaluaciÃ³n? La unidad de una evaluaciÃ³n puede ser
-- una sucursal o un departamento centralizado, y cada una tiene su propia
-- configuraciÃ³n (`sucursal_modulos` / `departamento_modulos`). Misma regla en
-- los dos casos: si la configuraciÃ³n no tiene filas activas aplica todo; si
-- tiene, solo lo marcado. Las funciones de permisos delegan acÃ¡ para no
-- repetir el criterio.
create or replace function public.modulo_aplica_a_ev(e public.evaluaciones, mod_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when e.departamento_id is not null then
      not exists (select 1 from public.departamento_modulos dm
                  where dm.departamento_id = e.departamento_id and dm.activa)
      or exists (select 1 from public.departamento_modulos dm
                 where dm.departamento_id = e.departamento_id and dm.activa
                   and dm.modulo_id = mod_id)
    else
      not exists (select 1 from public.sucursal_modulos sm
                  where sm.sucursal_id = e.sucursal_id and sm.activa)
      or exists (select 1 from public.sucursal_modulos sm
                 where sm.sucursal_id = e.sucursal_id and sm.activa
                   and sm.modulo_id = mod_id)
    end;
$$;

revoke execute on function public.modulo_aplica_a_ev(public.evaluaciones, uuid) from public, anon;
grant  execute on function public.modulo_aplica_a_ev(public.evaluaciones, uuid) to authenticated;

create or replace function public.puede_ver_evaluacion(e public.evaluaciones)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
      where p.id = auth.uid() and p.activo and (
        p.rol in ('LIDER','GERENTE_C','GERENTE_TH')
        -- El GERENTE_S ve las de SU sucursal. Las de departamento no son de
        -- ninguna sucursal, así que no entran por acá.
        or (p.rol = 'GERENTE_S' and e.sucursal_id = p.sucursal_id)
        or (p.rol = 'EVALUADOR' and exists (
              select 1
              from public.asignaciones_modulos am
              join public.modulos m on m.id = am.modulo_id and m.activo
              where am.evaluador_id = p.id and am.activa
                and public.modulo_aplica_a_ev(e, am.modulo_id)
            )
        )
      )
  );
$$;

-- QuiÃ©n puede responder: LIDER siempre; EVALUADOR solo en evaluaciÃ³n ACTIVA y
-- de Ã­tems cuyo mÃ³dulo le estÃ¡ asignado y aplica a la unidad de la evaluaciÃ³n
-- (sucursal o departamento).
create or replace function public.puede_responder(ev_id uuid, it_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_lider() or exists (
    select 1
    from public.evaluaciones ev
    join public.items i on i.id = it_id and i.activo
    join public.asignaciones_modulos am
      on am.modulo_id = i.modulo_id and am.evaluador_id = auth.uid() and am.activa
    where ev.id = ev_id and ev.estado = 'ACTIVA'
      and public.modulo_aplica_a_ev(ev, i.modulo_id)
  );
$$;

-- QuiÃ©n puede crear/editar registros de una secciÃ³n: LIDER siempre; EVALUADOR
-- solo en evaluaciÃ³n ACTIVA y cuando el mÃ³dulo de la secciÃ³n le estÃ¡ asignado.
create or replace function public.puede_manejar_instancia(ev_id uuid, it_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_lider() or exists (
    select 1
    from public.evaluaciones ev
    join public.items i on i.id = it_id
    join public.asignaciones_modulos am
      on am.modulo_id = i.modulo_id and am.evaluador_id = auth.uid() and am.activa
    where ev.id = ev_id and ev.estado = 'ACTIVA'
      and public.modulo_aplica_a_ev(ev, i.modulo_id)
  );
$$;

-- SUCURSALES: lectura autenticados / escritura solo LIDER ---------------------
drop policy if exists sucursales_select on public.sucursales;
create policy sucursales_select on public.sucursales for select to authenticated using (true);
drop policy if exists sucursales_lider on public.sucursales;
create policy sucursales_lider on public.sucursales for all using (public.es_lider()) with check (public.es_lider());

-- DEPARTAMENTOS CENTRALIZADOS: mismo trato que sucursales (lectura / solo LIDER)
drop policy if exists departamentos_centralizados_select on public.departamentos_centralizados;
create policy departamentos_centralizados_select on public.departamentos_centralizados for select to authenticated using (true);
drop policy if exists departamentos_centralizados_lider on public.departamentos_centralizados;
create policy departamentos_centralizados_lider on public.departamentos_centralizados for all using (public.es_lider()) with check (public.es_lider());

-- PROFILES: lectura autenticados / gestion completa solo LIDER ------------------
-- `to authenticated` es lo que cierra esta tabla a quien no iniciÃ³ sesiÃ³n. Con
-- `using (true)` a secas (mÃ¡s el `grant all` inicial de Supabase) cualquiera desde
-- internet hacÃ­a `select * from profiles` y se llevaba TODOS los correos, roles y
-- sucursales. El detalle estÃ¡ en `cerrar-lectura-anon.sql`.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
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
-- `to authenticated` en las de lectura: sin eso la polÃ­tica aplica a PUBLIC (o
-- sea, tambiÃ©n a `anon`) y con el `grant all` inicial de Supabase cualquiera
-- desde internet se lleva el catÃ¡logo entero. En `items` eso incluye la rÃºbrica
-- completa: puntajes, pesos y umbrales de cada punto.
drop policy if exists modulos_select on public.modulos;
create policy modulos_select on public.modulos for select to authenticated using (true);
drop policy if exists modulos_lider on public.modulos;
create policy modulos_lider on public.modulos for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated using (true);
drop policy if exists items_lider on public.items;
create policy items_lider on public.items for all using (public.es_lider()) with check (public.es_lider());

-- CONFIG POR SUCURSAL: lectura autenticados / gestion solo LIDER ---------------
drop policy if exists sucursal_modulos_select on public.sucursal_modulos;
create policy sucursal_modulos_select on public.sucursal_modulos for select to authenticated using (true);
drop policy if exists sucursal_modulos_lider on public.sucursal_modulos;
create policy sucursal_modulos_lider on public.sucursal_modulos for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists sucursal_items_select on public.sucursal_items;
create policy sucursal_items_select on public.sucursal_items for select to authenticated using (true);
drop policy if exists sucursal_items_lider on public.sucursal_items;
create policy sucursal_items_lider on public.sucursal_items for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists sucursal_opciones_select on public.sucursal_opciones;
create policy sucursal_opciones_select on public.sucursal_opciones for select to authenticated using (true);
drop policy if exists sucursal_opciones_lider on public.sucursal_opciones;
create policy sucursal_opciones_lider on public.sucursal_opciones for all using (public.es_lider()) with check (public.es_lider());

-- CONFIG POR DEPARTAMENTO: mismo trato (lectura autenticados / gestion solo LIDER)
drop policy if exists departamento_modulos_select on public.departamento_modulos;
create policy departamento_modulos_select on public.departamento_modulos for select to authenticated using (true);
drop policy if exists departamento_modulos_lider on public.departamento_modulos;
create policy departamento_modulos_lider on public.departamento_modulos for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists departamento_items_select on public.departamento_items;
create policy departamento_items_select on public.departamento_items for select to authenticated using (true);
drop policy if exists departamento_items_lider on public.departamento_items;
create policy departamento_items_lider on public.departamento_items for all using (public.es_lider()) with check (public.es_lider());
drop policy if exists departamento_opciones_select on public.departamento_opciones;
create policy departamento_opciones_select on public.departamento_opciones for select to authenticated using (true);
drop policy if exists departamento_opciones_lider on public.departamento_opciones;
create policy departamento_opciones_lider on public.departamento_opciones for all using (public.es_lider()) with check (public.es_lider());

-- EVALUACIONES -----------------------------------------------------------------
-- Select: segÃºn rol + mÃ³dulos asignados. Insert/Update/Delete: solo LIDER.
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

-- INSTANCIAS_GRUPO --------------------------------------------------------------
-- Select: quien puede ver la evaluaciÃ³n. Insert/Update/Delete: quien puede
-- manejar el mÃ³dulo de la secciÃ³n (el delete en cascada limpia sus respuestas).
alter table public.instancias_grupo enable row level security;
drop policy if exists instancias_grupo_select on public.instancias_grupo;
create policy instancias_grupo_select on public.instancias_grupo for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);
drop policy if exists instancias_grupo_insert on public.instancias_grupo;
create policy instancias_grupo_insert on public.instancias_grupo for insert with check (
  public.puede_manejar_instancia(evaluacion_id, item_id)
);
drop policy if exists instancias_grupo_update on public.instancias_grupo;
create policy instancias_grupo_update on public.instancias_grupo for update
  using (public.puede_manejar_instancia(evaluacion_id, item_id))
  with check (public.puede_manejar_instancia(evaluacion_id, item_id));
drop policy if exists instancias_grupo_delete on public.instancias_grupo;
create policy instancias_grupo_delete on public.instancias_grupo for delete using (
  public.puede_manejar_instancia(evaluacion_id, item_id)
);

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
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'instancias_grupo'
  ) then
    alter publication supabase_realtime add table public.instancias_grupo;
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
-- Marcar fotos a mano (FotoEditor) re-graba el MISMO path: es un UPDATE, y sin
-- esta politica la marca volvia con "no tenes permiso". Solo quien puede VER la
-- evaluacion toca su evidencia (ev/<evaluacion>/...), la misma regla con la que
-- se lee la tabla.
drop policy if exists "evidencias_update" on storage.objects;
create policy "evidencias_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'evidencias'
    and name like 'ev/%'
    and exists (
      select 1 from public.evaluaciones e
      where e.id::text = split_part(storage.objects.name, '/', 2)
        and public.puede_ver_evaluacion(e)
    )
  )
  with check (
    bucket_id = 'evidencias'
    and name like 'ev/%'
    and exists (
      select 1 from public.evaluaciones e
      where e.id::text = split_part(storage.objects.name, '/', 2)
        and public.puede_ver_evaluacion(e)
    )
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
    ('Atencion al cliente', 'CUMPLE_NO_CUMPLE', 'Trabajadores disponibles en la tienda', NULL, 1, true)
  ) as it(modulo_nombre, tipo, texto, opciones, orden, requerido)
where mod.nombre = it.modulo_nombre
  and not exists (select 1 from public.items);
-- ============================================================================
-- ULTIMA SINCRONIZACION POR USUARIO
-- Ultima vez que cada usuario logro subir datos del dispositivo a la nube.
-- Sirve para distinguir "esta trabajando offline" de "su avance no llega".
-- El cliente la marca desde la RPC `registrar_sync` (ver src/lib/offline/sync.ts).
-- ============================================================================
alter table public.profiles add column if not exists ultima_sync timestamptz;

-- Marca la subida del usuario actual. Es `security definer` para escribir sobre
-- profiles sin abrir permisos de update a los usuarios sobre la fila de otro.
create or replace function public.registrar_sync()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set ultima_sync = now()
   where id = auth.uid()
  returning ultima_sync;
$$;
grant execute on function public.registrar_sync() to authenticated;

-- ============================================================================
-- PERMISOS DE LAS FUNCIONES
-- Postgres da `EXECUTE` a PUBLIC por defecto en cada funciÃ³n nueva, asÃ­ que sin
-- esto cualquiera las puede invocar por /rest/v1/rpc/<nombre>. El detalle de
-- cuÃ¡les sÃ­ y cuÃ¡les no (y por quÃ©) estÃ¡ en `permisos-funcion.sql`.
-- ============================================================================

-- Trigger functions: nunca se llaman por RPC. Son security definer, asÃ­ que el
-- trigger corre como dueÃ±o y no pierde nada.
revoke execute on function public.validar_registro() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.validar_modulo_compartido() from public;
revoke execute on function public.validar_unico_evaluador_modulo() from public;

-- La Ãºnica de trigger que NO es security definer: el trigger corre como el rol
-- que escribe (el LÃ­der), asÃ­ que sÃ­ necesita el permiso.
revoke execute on function public.validar_suma_puntaje_items() from public;
grant execute on function public.validar_suma_puntaje_items() to authenticated;

-- Solo para usuario con sesiÃ³n. El cuerpo de ambas ya exige auth.uid() (y para
-- desbloquear, ademÃ¡s, ser LIDER); esto solo evita exponerlas a `anon`.
revoke execute on function public.desbloquear_usuario(uuid, text) from public;
revoke execute on function public.registrar_sync() from public;

-- A propÃ³sito NO se revoca de es_lider, puede_ver_evaluacion, puede_responder,
-- puede_manejar_instancia, puede_reportar_incidencia, puede_ver_incidencia: las
-- invocan las polÃ­ticas RLS y sin EXECUTE se rompe la app entera.

-- Las dos de la pantalla de login: necesitan `anon` (se llaman antes de
-- signInWithPassword) y no necesitan `authenticated`. El revoke de PUBLIC es lo
-- que hace el trabajo: los permisos de Postgres son aditivos, asÃ­ que alcanza con
-- el `grant ... to anon` de arriba para dejarlas en manos de un solo rol.
revoke execute on function public.intento_login(text, text) from public, authenticated;
revoke execute on function public.email_por_usuario(text) from public, authenticated;

-- Tabla, no funciÃ³n. Estas 7 son las que se leÃ­an sin sesiÃ³n: `profiles` (correos,
-- roles), `items` (la rÃºbrica completa con puntajes y umbrales), `modulos`,
-- `sucursales` (nombres, branch_id, gerente_id) y las tres de configuraciÃ³n por
-- sucursal. La polÃ­tica con `to authenticated` ya las cierra; este revoke es la
-- segunda mitad de la cerradura, porque los permisos de Postgres son ADITIVOS: si
-- algÃºn dÃ­a RLS queda apagado en una de ellas (pasa, y no se ve), el `grant` por
-- defecto de Supabase pasa a ser la Ãºnica puerta y quedarÃ­a abierta.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'sucursales', 'modulos', 'items',
    'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
  ] loop
    execute format('revoke select on public.%I from anon', t);
  end loop;
end $$;


-- ###########################################################################
-- Archivo consolidado: incidencias.sql
-- ###########################################################################
-- ============================================================================
-- Incidencias fuera de lo programado
--
-- Lo que el evaluador ve en la tienda y no estÃ¡ en el formulario: una bandeja de
-- pechuga de pollo dentro de la nevera de helado, una puerta sin rotular, un
-- FIGE sin fecha de vencimiento. Se reporta desde el botÃ³n flotante de la
-- evaluaciÃ³n, se guarda en el telÃ©fono y sube cuando hay seÃ±al (igual que el resto
-- del avance).
--
-- Aplicar en el SQL Editor de Supabase. Es idempotente: se puede correr de nuevo.
-- ============================================================================

create table if not exists public.incidencias (
  id uuid primary key,
  evaluacion_id uuid not null references public.evaluaciones(id) on delete cascade,
  evaluador_id uuid not null references auth.users(id) on delete cascade,
  -- Hereda la unidad de su evaluación: sucursal o departamento, una sola.
  sucursal_id uuid references public.sucursales(id) on delete cascade,
  departamento_id uuid references public.departamentos_centralizados(id) on delete cascade,
  fecha date not null,
  modulo_id uuid references public.modulos(id),
  descripcion text not null,
  fotos text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint incidencias_unidad_check
    check ((sucursal_id is null) <> (departamento_id is null))
);
create index if not exists idx_incidencias_departamento on public.incidencias (departamento_id, created_at desc);

-- Cargos responsables de la incidencia. Es un jsonb y no un text[] porque cada
-- cargo lleva su propia marca: `por_validar` va en true cuando se escribiÃ³ a
-- mano, que es lo que pasa siempre que no hay seÃ±al para consultar el catÃ¡logo.
-- Ese cargo puede estar mal escrito, asÃ­ que no se da por bueno hasta que en la
-- prÃ³xima oportunidad se lo contrasta contra el catÃ¡logo. El LÃ­der lo ve asÃ­
-- desde la nube: un cargo sin verificar es informaciÃ³n, no un detalle de la UI.
--
-- jsonb (y no una tabla aparte) porque el catÃ¡logo de cargos vive en una Edge
-- Function, no en la base: no hay un `cargo_id` al que apuntar, solo el texto.
alter table public.incidencias add column if not exists responsables jsonb not null default '[]'::jsonb;

create index if not exists idx_incidencias_evaluacion on public.incidencias (evaluacion_id, created_at desc);

alter table public.incidencias enable row level security;

-- QuiÃ©n puede reportar una incidencia de una evaluaciÃ³n: el LÃDER siempre; el
-- EVALUADOR solo si tiene un mÃ³dulo activo asignado que aplique a la sucursal y
-- la evaluaciÃ³n estÃ¡ ACTIVA. Mismas reglas que `puede_responder`, pero sin exigir
-- un Ã­tem concreto: acÃ¡ la incidencia no viene de un Ã­tem, viene de la visita.
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
      and public.modulo_aplica_a_ev(ev, am.modulo_id)
  );
$$;

-- Ver una incidencia: LIDER todas; el EVALUADOR las suyas, mientras la evaluaciÃ³n
-- siga ACTIVA y pueda reportar en ella. La regla va en una funciÃ³n (como
-- `puede_ver_evaluacion` y `puede_responder` en schema.sql) porque dentro del USING
-- de una polÃ­tica no se puede volver a nombrar a la tabla propia: la columna se le
-- pasa como argumento y es la polÃ­tica quien la resuelve.
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

-- Crear: el que reporta es el evaluador, y tiene que estar asignado a esa evaluaciÃ³n.
drop policy if exists incidencias_insert on public.incidencias;
create policy incidencias_insert on public.incidencias
  for insert with check (
    auth.uid() = evaluador_id
    and public.puede_reportar_incidencia(evaluacion_id, modulo_id)
  );

-- Adjuntar las fotos al reporte (el telÃ©fono sube primero la fila y despuÃ©s los
-- paths: el id del reporte lo genera el cliente y lo manda en el insert).
drop policy if exists incidencias_update on public.incidencias;
create policy incidencias_update on public.incidencias
  for update using (auth.uid() = evaluador_id) with check (auth.uid() = evaluador_id);

-- ----------------------------------------------------------------------------
-- Fotos: bucket `evidencias`, ruta `incidencias/<reporte_id>/<foto_id>`.
-- El evaluador dueÃ±o puede ver y quitar sus fotos; el LÃDER las puede ver.
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

-- El Lider tambien puede reescribir: es quien revisa estas fotos desde el
-- detalle de la evaluacion ajena, y el editor de marcas las re-graba igual.
drop policy if exists storage_incidencias_update on storage.objects;
create policy storage_incidencias_update on storage.objects
  for update to authenticated
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
  )
  with check (
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

comment on table public.incidencias is 'Incidencias fuera de lo programado, reportadas desde la evaluaciÃ³n (funciona sin conexiÃ³n).';
comment on column public.incidencias.descripcion is 'Lo que vio el evaluador, con sus palabras.';
comment on column public.incidencias.fotos is 'Rutas en el bucket evidencias: incidencias/<reporte_id>/<foto_id>.';
comment on column public.incidencias.responsables is 'Cargos responsables: [{cargo, por_validar}]. por_validar=true cuando se agregÃ³ a mano sin catÃ¡logo y todavÃ­a no se confirmÃ³.';

-- ----------------------------------------------------------------------------
-- Verificacion
-- ----------------------------------------------------------------------------
-- La columna tiene que existir y traer el default. Si `existe` sale false, el
-- `alter table` de arriba no llegÃ³ a aplicarse y los responsables no se guardan
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


-- ###########################################################################
-- Archivo consolidado: departamentos-centralizados.sql
-- ###########################################################################
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


-- ###########################################################################
-- Archivo consolidado: departamentos-evaluaciones.sql
-- ###########################################################################
-- ============================================================================
-- Evaluaciones por DEPARTAMENTO
-- ============================================================================
-- Hasta ahora una evaluación medía una sucursal y punto (`sucursal_id not
-- null`). Ahora mide una UNIDAD, que puede ser una sucursal o un departamento
-- centralizado (Mercadeo, Taller, Talento Humano, Administración…).
--
-- • La unidad es exactamente una de las dos: lo impone `evaluaciones_unidad_check`
--   (XOR booleano: una en null y la otra no).
-- • Una por unidad y fecha. La de sucursal ya la garantizaba
--   `unique (sucursal_id, fecha)` y sigue vigente: Postgres compara los null
--   como distintos, así que una evaluación de departamento no choca ahí. La del
--   departamento necesita su propio índice único.
-- • Qué módulos/ítems/opciones aplican se resuelve con la configuración de la
--   unidad: `sucursal_modulos/_items/_opciones` para sucursales y sus gemelos
--   `departamento_*` para departamentos. Las funciones de permisos no repiten
--   esa lógica: la delegan en `modulo_aplica_a_ev`, así se comportan igual en
--   las dos unidades.
--
-- Idempotente: se puede pegar más de una vez en el SQL Editor de Supabase.

-- ------------------------------------------------------------------ evaluaciones
-- Puede ser de sucursal O de departamento. El FK con `on delete cascade` hace
-- que borrar el departamento borre sus evaluaciones (igual que borrar una
-- sucursal borra las suyas).
alter table public.evaluaciones
  add column if not exists departamento_id uuid
  references public.departamentos_centralizados(id) on delete cascade;

alter table public.evaluaciones alter column sucursal_id drop not null;

alter table public.evaluaciones drop constraint if exists evaluaciones_unidad_check;
alter table public.evaluaciones add constraint evaluaciones_unidad_check
  check ((sucursal_id is null) <> (departamento_id is null));

create unique index if not exists uniq_evaluaciones_departamento_fecha
  on public.evaluaciones (departamento_id, fecha)
  where departamento_id is not null;

create index if not exists idx_evaluaciones_departamento
  on public.evaluaciones (departamento_id, fecha);

-- ------------------------------------------------------------------ incidencias
-- Una incidencia nace de la visita, así que hereda la unidad de su evaluación.
alter table public.incidencias
  add column if not exists departamento_id uuid
  references public.departamentos_centralizados(id) on delete cascade;

alter table public.incidencias alter column sucursal_id drop not null;

alter table public.incidencias drop constraint if exists incidencias_unidad_check;
alter table public.incidencias add constraint incidencias_unidad_check
  check ((sucursal_id is null) <> (departamento_id is null));

create index if not exists idx_incidencias_departamento
  on public.incidencias (departamento_id, created_at desc);

-- --------------------------------------------------------- reglas de permisos
-- ¿Aplica este módulo a esta evaluación? Misma regla que siempre, dos veces:
-- si la configuración de la unidad no tiene filas activas aplica todo; si
-- tiene, solo lo marcado.
create or replace function public.modulo_aplica_a_ev(e public.evaluaciones, mod_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when e.departamento_id is not null then
      not exists (select 1 from public.departamento_modulos dm
                  where dm.departamento_id = e.departamento_id and dm.activa)
      or exists (select 1 from public.departamento_modulos dm
                 where dm.departamento_id = e.departamento_id and dm.activa
                   and dm.modulo_id = mod_id)
    else
      not exists (select 1 from public.sucursal_modulos sm
                  where sm.sucursal_id = e.sucursal_id and sm.activa)
      or exists (select 1 from public.sucursal_modulos sm
                 where sm.sucursal_id = e.sucursal_id and sm.activa
                   and sm.modulo_id = mod_id)
    end;
$$;

revoke execute on function public.modulo_aplica_a_ev(public.evaluaciones, uuid) from public, anon;
grant  execute on function public.modulo_aplica_a_ev(public.evaluaciones, uuid) to authenticated;

-- Las mismas cuatro funciones de `schema.sql`, pero delegando en
-- `modulo_aplica_a_ev`. Cambiar solo el cuerpo deja las políticas intactas: ya
-- las llaman a estas.
create or replace function public.puede_ver_evaluacion(e public.evaluaciones)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
      where p.id = auth.uid() and p.activo and (
        p.rol in ('LIDER','GERENTE_C','GERENTE_TH')
        -- El GERENTE_S ve las de SU sucursal. Las de departamento no son de
        -- ninguna sucursal, así que no entran por acá.
        or (p.rol = 'GERENTE_S' and e.sucursal_id = p.sucursal_id)
        or (p.rol = 'EVALUADOR' and exists (
              select 1
              from public.asignaciones_modulos am
              join public.modulos m on m.id = am.modulo_id and m.activo
              where am.evaluador_id = p.id and am.activa
                and public.modulo_aplica_a_ev(e, am.modulo_id)
            )
        )
      )
  );
$$;

create or replace function public.puede_responder(ev_id uuid, it_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_lider() or exists (
    select 1
    from public.evaluaciones ev
    join public.items i on i.id = it_id and i.activo
    join public.asignaciones_modulos am
      on am.modulo_id = i.modulo_id and am.evaluador_id = auth.uid() and am.activa
    where ev.id = ev_id and ev.estado = 'ACTIVA'
      and public.modulo_aplica_a_ev(ev, i.modulo_id)
  );
$$;

create or replace function public.puede_manejar_instancia(ev_id uuid, it_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_lider() or exists (
    select 1
    from public.evaluaciones ev
    join public.items i on i.id = it_id
    join public.asignaciones_modulos am
      on am.modulo_id = i.modulo_id and am.evaluador_id = auth.uid() and am.activa
    where ev.id = ev_id and ev.estado = 'ACTIVA'
      and public.modulo_aplica_a_ev(ev, i.modulo_id)
  );
$$;

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
      and public.modulo_aplica_a_ev(ev, am.modulo_id)
  );
$$;

-- Listo. Después de esto:
--   • el Líder apertura evaluaciones de departamento desde Historial;
--   • el evaluador las ve en /evaluar junto a las sucursales, y lo que responde
--     respeta los módulos/ítems/opciones marcados en Configuración → Departamentos.


-- ###########################################################################
-- Archivo consolidado: departamentos-backfill.sql
-- ###########################################################################
-- ----------------------------------------------------------------------------
-- DEPARTAMENTO DE LOS PRODUCTOS QUE YA ESTABAN ESCANEADOS (backfill)
-- ----------------------------------------------------------------------------
-- `departamento` (el `department.name` de la API de precios) se empezó a guardar
-- después de que muchas conciliaciones ya estuvieran escaneadas, así que sus
-- productos quedaron sin el campo y salen todos juntos en el grupo "Sin
-- departamento".
--
-- Estas funciones lo rellenan a partir de un mapa {"<código de barras>": "<departamento>"}
-- sin tocar ningún otro dato de la respuesta.
--
-- Herramienta manual de un solo uso: las funciones quedan instaladas aunque no
-- las llame la app. Los scripts que armaban el mapa desde la API de precios se
-- eliminaron del repositorio; si hay que repetir el relleno, hay que rearmar ese
-- mapa a mano (o recuperar esos scripts del historial de git).
--
-- CÓMO SE USA
-- -----------
--   1. Corré este archivo una vez (crea las dos funciones).
--   2. Corré primero `previsualizar_departamentos('<mapa>'::jsonb)` para ver a
--      cuántos productos les va a poner departamento, sin escribir nada.
--   3. Después corré `select public.aplicar_departamentos('<mapa>'::jsonb)`.
--
-- QUÉ TOCA Y QUÉ NO TOCA
-- ----------------------
-- Solo escribe donde `departamento` está ausente. Si el producto ya tiene valor, o
-- si su código no viene en el mapa, la fila queda como está. No toca
-- `perdidaEstimada`, ni `teorica`, ni `fisica`, ni `finalBase`/`finalTax`.
--
-- El departamento es un rótulo descriptivo: no entra en ningún cálculo de puntaje,
-- veredicto, tasa de descuadre ni pérdida estimada. Por eso rellenarlo no cambia
-- el resultado de ninguna evaluación, solo la forma en que se muestran las filas.
-- La `perdidaEstimada` congelada de las conciliaciones viejas sigue valuada como
-- se valuó ese día, que es lo correcto para un informe ya firmado.
--
-- Es idempotente: correrla dos veces con el mismo mapa no hace nada la segunda.
--
-- Se ejecuta a mano desde el SQL Editor. No se le da EXECUTE a la app: nadie
-- desde el navegador necesita llamarlas.

-- ---------------------------------------------------------------- PREVIEW ----
-- Lista los productos que el mapa les pondría departamento, SIN escribir nada.
-- Sirve para dos cosas: confirmar que el mapa está bien y ver cuántos productos y
-- respuestas van a quedar tocados. Conviene llamarla antes de la que aplica,
-- para confirmar el mapa antes de escribir.
create or replace function public.previsualizar_departamentos(mapa jsonb)
returns table (
  codigo text,
  nombre text,
  evaluacion uuid,
  departamento_nuevo text
)
language sql
stable
set search_path = public
as $$
with entradas as (
  -- `jsonb_each_text` devuelve las columnas con nombre `key` y `value`. Se les
  -- pone alias para no depender de esos nombres.
  select upper(btrim(t.clave)) as codigo, btrim(t.departamento) as departamento
  from jsonb_each_text(mapa) as t(clave, departamento)
  where btrim(t.departamento) <> ''
)
select
  upper(btrim(coalesce(y.prod->>'sku', ''))) as codigo,
  y.prod->>'nombre' as nombre,
  r.evaluacion_id as evaluacion,
  m.departamento as departamento_nuevo
from public.respuestas r
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(r.valor->'productos') = 'array' then r.valor->'productos'
    else '[]'::jsonb
  end
) as y(prod)
join entradas m on m.codigo = upper(btrim(coalesce(y.prod->>'sku', '')))
-- Solo los que están sin departamento: es lo único que la función de abajo cambia.
where (y.prod->>'departamento') is null
order by 1, 3;
$$;

-- ---------------------------------------------------------------- APLICAR ----
-- Escribe `departamento` en los productos que lo tienen ausente y cuyo código está
-- en el mapa. Devuelve cuántas respuestas (filas de `respuestas`) tocó, no cuántos
-- productos: un producto suele aparecer en más de una evaluación.
create or replace function public.aplicar_departamentos(mapa jsonb)
returns integer
language sql
set search_path = public
as $$
with entradas as (
  select upper(btrim(t.clave)) as codigo, btrim(t.departamento) as departamento
  from jsonb_each_text(mapa) as t(clave, departamento)
  where btrim(t.departamento) <> ''
),
actualizadas as (
  update public.respuestas r
  set valor = jsonb_set(r.valor, '{productos}', (
        select jsonb_agg(
            case
              when m.departamento is not null and (prod->>'departamento') is null
                then jsonb_set(prod, '{departamento}', to_jsonb(m.departamento), true)
              else prod
            end
            order by pos
          )
        from jsonb_array_elements(r.valor->'productos') with ordinality as x(prod, pos)
        left join entradas m on m.codigo = upper(btrim(coalesce(prod->>'sku', '')))
      ))
  where jsonb_typeof(r.valor->'productos') = 'array'
    and exists (
      select 1
      from jsonb_array_elements(r.valor->'productos') as y(prod)
      left join entradas m on m.codigo = upper(btrim(coalesce(y.prod->>'sku', '')))
      where m.departamento is not null and (y.prod->>'departamento') is null
    )
  returning 1
)
select count(*)::int from actualizadas;
$$;

-- La app no las llama: quedan solo para quien las corre a mano.
revoke execute on function public.previsualizar_departamentos(jsonb) from public, anon, authenticated;
revoke execute on function public.aplicar_departamentos(jsonb) from public, anon, authenticated;


-- ###########################################################################
-- Archivo consolidado: revision-pre-entrega.sql
-- ###########################################################################
-- ============================================================================
-- Revisión Pre-Entrega (herramienta)
--
-- Herramienta independiente de la evaluación: no pertenece a `evaluaciones` ni
-- compite con los módulos del cuestionario. El LÍDER configura sus preguntas
-- como cualquier otro módulo (Ítems de evaluación) y el evaluador las llena
-- generando un PDF de entrega firmada por el chofer.
--
-- Para distinguirla de los módulos que forman parte de la evaluación se agrega
-- `modulos.herramienta`: los módulos con esta columna vacía son los de siempre.
-- Así la herramienta no aparece nunca en la lista de /evaluar.
--
-- Aplicar en el SQL Editor de Supabase. Es idempotente: se puede correr de nuevo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Marca de herramienta en los módulos. NULL = módulo de evaluación (el normal).
-- ----------------------------------------------------------------------------
alter table public.modulos add column if not exists herramienta text;

drop index if exists idx_modulos_herramienta;
create unique index if not exists uniq_modulos_herramienta
  on public.modulos(herramienta) where herramienta is not null;

comment on column public.modulos.herramienta is
  'Identifica un módulo como herramienta externa (ej. REVISION_PRE_ENTREGA). NULL = módulo normal de evaluación.';

-- ----------------------------------------------------------------------------
-- Cabecera de la revisión + respuestas del check list.
--
-- Las respuestas van en un jsonb `{ item_id: valor }` porque el valor ya es
-- jsonb en `respuestas.valor` (lo produce ItemRenderer) y así la herramienta
-- no necesita una tabla hija ni entrar en el flujo de `evaluaciones`.
-- ----------------------------------------------------------------------------
create table if not exists public.revision_pre_entrega (
  id uuid primary key default gen_random_uuid(),
  evaluador_id uuid not null references auth.users(id) on delete cascade,
  sucursal_id uuid not null references public.sucursales(id) on delete cascade,
  modulo_id uuid references public.modulos(id) on delete set null,
  placa text not null,
  -- Datos del vehículo traídos de la API de flota (o a mano si no se encontró).
  vehiculo jsonb not null default '{}'::jsonb,
  -- Datos del chofer: los de la API de trabajadores o los capturados a mano.
  chofer jsonb not null default '{}'::jsonb,
  -- Firma del chofer como data URL (la imprime el PDF). Se firma en el
  -- dispositivo, así que se sube tal cual.
  chofer_firma text,
  observaciones text,
  -- Respuestas del check list: `{ [item_id]: <valor de ItemRenderer> }`.
  respuestas jsonb not null default '{}'::jsonb,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR', 'FINALIZADA')),
  fecha date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_revision_pre_entrega_evaluador
  on public.revision_pre_entrega(evaluador_id, created_at desc);
create index if not exists idx_revision_pre_entrega_sucursal
  on public.revision_pre_entrega(sucursal_id, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS
--
-- La herramienta la usan el LÍDER y el EVALUADOR. Cada uno ve y edita las
-- suyas; el LÍDER ve todas y puede corregir cualquier revisión. No se exige
-- que haya `evaluaciones` abierta: la revisión se hace aunque la sucursal no
-- tenga ninguna evaluación en curso (es una entrega, no una medición).
-- ----------------------------------------------------------------------------
alter table public.revision_pre_entrega enable row level security;

create or replace function public.puede_usar_revision_pre_entrega()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and p.rol in ('LIDER', 'EVALUADOR')
  );
$$;

drop policy if exists revision_pre_entrega_select on public.revision_pre_entrega;
create policy revision_pre_entrega_select on public.revision_pre_entrega
  for select using (evaluador_id = auth.uid() or public.es_lider());

-- Guardar el borrador y finalizarla: el dueño, y solo con la herramienta activa.
drop policy if exists revision_pre_entrega_insert on public.revision_pre_entrega;
create policy revision_pre_entrega_insert on public.revision_pre_entrega
  for insert with check (evaluador_id = auth.uid() and public.puede_usar_revision_pre_entrega());

drop policy if exists revision_pre_entrega_update on public.revision_pre_entrega;
create policy revision_pre_entrega_update on public.revision_pre_entrega
  for update using (evaluador_id = auth.uid() or public.es_lider())
  with check (evaluador_id = auth.uid() or public.es_lider());

drop policy if exists revision_pre_entrega_delete on public.revision_pre_entrega;
create policy revision_pre_entrega_delete on public.revision_pre_entrega
  for delete using (evaluador_id = auth.uid() or public.es_lider());

-- ----------------------------------------------------------------------------
-- Fotos de la revisión: bucket `evidencias`, ruta `pre-entrega/<revision_id>/<foto_id>`.
-- ----------------------------------------------------------------------------
drop policy if exists storage_pre_entrega_insert on storage.objects;
create policy storage_pre_entrega_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  );

drop policy if exists storage_pre_entrega_update on storage.objects;
create policy storage_pre_entrega_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  )
  with check (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  );

drop policy if exists storage_pre_entrega_select on storage.objects;
create policy storage_pre_entrega_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidencias'
    and (
      public.es_lider()
      or exists (
        select 1 from public.revision_pre_entrega r
        where r.evaluador_id = auth.uid()
          and name like 'pre-entrega/' || r.id::text || '/%'
      )
    )
  );

drop policy if exists storage_pre_entrega_delete on storage.objects;
create policy storage_pre_entrega_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  );

-- ----------------------------------------------------------------------------
-- Módulo y check list iniciales.
--
-- Se inserts solo lo que falta (por `herramienta` y por `texto` dentro del
-- módulo): correrlo de nuevo no toca lo que el LÍDER ya haya editado, así que
-- las respuestas guardadas siguen apuntando a ítems que no desaparecen.
-- Los puntos se dejan en 0 a propósito: la revisión no puntúa, es un check
-- list de entrega.
-- ----------------------------------------------------------------------------
do $$
declare
  v_mod uuid;
begin
  select id into v_mod from public.modulos where herramienta = 'REVISION_PRE_ENTREGA';
  if v_mod is null then
    insert into public.modulos (nombre, descripcion, orden, activo, compartido, herramienta)
    values (
      'Revisión Pre-Entrega',
      'Check list de entrega del vehículo: se llena al entregar y la firma el chofer. No forma parte de la evaluación.',
      900,
      true,
      false,
      'REVISION_PRE_ENTREGA'
    )
    returning id into v_mod;
  end if;

  -- Cada ítem: (texto, opciones). Se numera por el orden en que aparecen para
  -- que la pantalla y el PDF salgan siempre igual.
  insert into public.items (modulo_id, tipo, texto, opciones, responsables, orden, requerido, activo, puntaje, api_campos, contra_dato)
  select v_mod, 'CHECKLIST', t.texto, t.opciones, '[]'::jsonb, t.orden, false, true, 0, '[]'::jsonb, 'SOH'
  from (
    select texto, opciones, row_number() over () - 1 as orden
    from (values
      ('Documentación del vehículo y del conductor', '[
        {"id":"ppe-doc-1","etiqueta":"SOAT vigente"},
        {"id":"ppe-doc-2","etiqueta":"Revisión técnico-mecánica vigente"},
        {"id":"ppe-doc-3","etiqueta":"Licencia de conducir vigente y corresponde al conductor"},
        {"id":"ppe-doc-4","etiqueta":"Permiso de operación vigente"},
        {"id":"ppe-doc-5","etiqueta":"Póliza de seguro vigente"}
      ]'::jsonb),
      ('Carrocería y exterior', '[
        {"id":"ppe-car-1","etiqueta":"Sin abolladuras ni golpes"},
        {"id":"ppe-car-2","etiqueta":"Sin rayones"},
        {"id":"ppe-car-3","etiqueta":"Pintura en buen estado"},
        {"id":"ppe-car-4","etiqueta":"Parabrisas sin fisura ni deformación"},
        {"id":"ppe-car-5","etiqueta":"Vidrios laterales y luneta sin roturas"},
        {"id":"ppe-car-6","etiqueta":"Plumillas y limpiaparabrisas en buen estado"},
        {"id":"ppe-car-7","etiqueta":"Tapa de combustible y tapa de agua presentes"}
      ]'::jsonb),
      ('Llantas y ruedas', '[
        {"id":"ppe-lla-1","etiqueta":"Llantas con dibujo suficiente"},
        {"id":"ppe-lla-2","etiqueta":"Presión de inflado correcta"},
        {"id":"ppe-lla-3","etiqueta":"Sin deformaciones, cortes ni raíces"},
        {"id":"ppe-lla-4","etiqueta":"Tuercas con apriete adecuado"},
        {"id":"ppe-lla-5","etiqueta":"Llanta de repuesto en condiciones"},
        {"id":"ppe-lla-6","etiqueta":"Sin desgaste irregular (desalineación)"}
      ]'::jsonb),
      ('Frenos', '[
        {"id":"ppe-fre-1","etiqueta":"Freno de servicio sin falla"},
        {"id":"ppe-fre-2","etiqueta":"Freno de estacionamiento funciona"},
        {"id":"ppe-fre-3","etiqueta":"Testigo de freno apagado con el motor encendido"},
        {"id":"ppe-fre-4","etiqueta":"Discos y pastillas sin desgaste crítico"},
        {"id":"ppe-fre-5","etiqueta":"Pedal de freno sin hundimiento excesivo"},
        {"id":"ppe-fre-6","etiqueta":"Líquido de frenos por encima del mínimo"}
      ]'::jsonb),
      ('Luces y señalización', '[
        {"id":"ppe-luc-1","etiqueta":"Luces delanteras (bajas y altas)"},
        {"id":"ppe-luc-2","etiqueta":"Luces traseras y stop"},
        {"id":"ppe-luc-3","etiqueta":"Luces direccionales"},
        {"id":"ppe-luc-4","etiqueta":"Luces de emergencia"},
        {"id":"ppe-luc-5","etiqueta":"Luces de retroceso"},
        {"id":"ppe-luc-6","etiqueta":"Bocina y alarma de retroceso"},
        {"id":"ppe-luc-7","etiqueta":"Luces de posición y matrícula"}
      ]'::jsonb),
      ('Niveles y fluidos', '[
        {"id":"ppe-niv-1","etiqueta":"Aceite de motor"},
        {"id":"ppe-niv-2","etiqueta":"Refrigerante"},
        {"id":"ppe-niv-3","etiqueta":"Líquido de frenos"},
        {"id":"ppe-niv-4","etiqueta":"Líquido hidráulico de dirección"},
        {"id":"ppe-niv-5","etiqueta":"Líquido limpiaparabrisas"},
        {"id":"ppe-niv-6","etiqueta":"Batería con bornes limpios y apretados"}
      ]'::jsonb),
      ('Elementos de seguridad', '[
        {"id":"ppe-seg-1","etiqueta":"Extintor vigente y con carga"},
        {"id":"ppe-seg-2","etiqueta":"Botiquín de primeros auxilios"},
        {"id":"ppe-seg-3","etiqueta":"Chaleco reflectante"},
        {"id":"ppe-seg-4","etiqueta":"Juego de triángulos"},
        {"id":"ppe-seg-5","etiqueta":"Cinturones de seguridad en buen estado"},
        {"id":"ppe-seg-6","etiqueta":"Tapabarrotes y faldones"}
      ]'::jsonb),
      ('Motor y tablero', '[
        {"id":"ppe-mot-1","etiqueta":"Arranque normal, sin ruidos"},
        {"id":"ppe-mot-2","etiqueta":"Ralentí estable"},
        {"id":"ppe-mot-3","etiqueta":"Temperatura de motor normal"},
        {"id":"ppe-mot-4","etiqueta":"Sin humos ni fugas visibles"},
        {"id":"ppe-mot-5","etiqueta":"Testigos del tablero apagados con el motor encendido"}
      ]'::jsonb)
    ) as v(texto, opciones)
  ) t
  where not exists (
    select 1 from public.items i where i.modulo_id = v_mod and i.texto = t.texto
  );

  -- Dictamen de entrega: sin opciones, cumple / no cumple. Va al final (orden 99).
  insert into public.items (modulo_id, tipo, texto, opciones, responsables, orden, requerido, activo, puntaje, api_campos, contra_dato)
  select v_mod, 'CUMPLE_NO_CUMPLE', '¿El vehículo queda en condiciones de ser entregado?', '[]'::jsonb, '[]'::jsonb, 99, true, true, 0, '[]'::jsonb, 'SOH'
  where not exists (
    select 1 from public.items where modulo_id = v_mod and texto = '¿El vehículo queda en condiciones de ser entregado?'
  );
end $$;

comment on table public.revision_pre_entrega is
  'Revisión Pre-Entrega: check list de entrega con datos de vehículo, chofer y firma (funciona sin conexión).';
comment on column public.revision_pre_entrega.respuestas is
  'Respuestas del check list: { [item_id]: <valor jsonb de ItemRenderer> }.';
comment on column public.revision_pre_entrega.estado is
  'BORRADOR = en proceso en el teléfono. FINALIZADA = entregada y con PDF generado.';


-- ###########################################################################
-- Archivo consolidado: inspeccion-vehiculo.sql
-- ###########################################################################
-- ============================================================================
-- Inspección de vehículo (herramienta)
--
-- Inspección de vehículo PARTICULAR: estética, mecánica y sistema de gas
-- vehicular (GNV), con fotos/incidencias por punto y salida a PDF.
--
-- ES AUTOSUFICIENTE: trae el andamiaje de la Revisión Pre-Entrega
-- (`supabase/revision-pre-entrega.sql`) con guardas `if not exists`, porque en
-- una base donde esa semilla nunca se corrió no existen ni la columna
-- `modulos.herramienta` ni la tabla `revision_pre_entrega`. Así se aplica con
-- un solo archivo y en cualquier orden respecto de la otra semilla:
--
--   * `modulos.herramienta`  → marca este módulo como herramienta, así no
--     aparece nunca en /evaluar ni puntúa en ninguna evaluación.
--   * `revision_pre_entrega` → guarda la inspección. Es la misma tabla porque
--     la ficha es la misma (placa, vehículo, persona, respuestas jsonb, firma,
--     estado, sync) y porque así RLS y storage la cubren sin reglas nuevas.
--     Lo que distingue una inspección de una pre-entrega es `modulo_id`, que
--     apunta a este módulo; las fotos suben a la misma carpeta
--     `pre-entrega/<registro_id>/`. Una inspección va **sin sucursal**
--     (`sucursal_id` null): el vehículo no es de ninguna unidad, y el paso 0
--     suelta el `NOT NULL` con que la pre-entrega creó la tabla.
--
-- Aplicar en el SQL Editor de Supabase. Es idempotente: se puede correr de
-- nuevo sin pisar lo que el Líder haya editado después desde Ítems de
-- evaluación (se inserta solo lo que falta, por `herramienta` y por `texto`
-- dentro del módulo).
--
-- Nota: si un vehículo no es de gas, las opciones de la sección GNV se marcan
-- como informativas desde la pantalla o esa sección se desactiva en Ítems de
-- evaluación; no hace falta tocar este archivo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Andamiaje de la herramienta (idempotente)
--
-- Todo con guarda: si la semilla de la pre-entrega ya se corrió, esto no toca
-- nada; si nunca se corrió, la trae igual para que la inspección funcione sola.
-- ----------------------------------------------------------------------------

-- Marca de herramienta en los módulos. NULL = módulo de evaluación (el normal).
alter table public.modulos add column if not exists herramienta text;

drop index if exists idx_modulos_herramienta;
create unique index if not exists uniq_modulos_herramienta
  on public.modulos(herramienta) where herramienta is not null;

comment on column public.modulos.herramienta is
  'Identifica un módulo como herramienta externa (ej. REVISION_PRE_ENTREGA, INSPECCION_VEHICULO). NULL = módulo normal de evaluación.';

-- Cabecera de la revisión + respuestas del check list.
--
-- Las respuestas van en un jsonb `{ item_id: valor }` porque el valor ya es
-- jsonb en `respuestas.valor` (lo produce ItemRenderer) y así la herramienta
-- no necesita una tabla hija ni entrar en el flujo de `evaluaciones`.
create table if not exists public.revision_pre_entrega (
  id uuid primary key default gen_random_uuid(),
  evaluador_id uuid not null references auth.users(id) on delete cascade,
  -- Sucursal: la pre-entrega siempre es de una; la inspección no tiene (se hace
  -- donde esté el vehículo), por eso la columna admite null.
  sucursal_id uuid references public.sucursales(id) on delete cascade,
  modulo_id uuid references public.modulos(id) on delete set null,
  placa text not null,
  -- Datos del vehículo: de la API por placa o capturados a mano.
  vehiculo jsonb not null default '{}'::jsonb,
  -- Datos de la persona (chofer en la pre-entrega, propietario aquí).
  chofer jsonb not null default '{}'::jsonb,
  -- Firma como data URL (la imprime el PDF). Se firma en el dispositivo.
  chofer_firma text,
  observaciones text,
  -- Respuestas del check list: `{ [item_id]: <valor de ItemRenderer> }`.
  respuestas jsonb not null default '{}'::jsonb,
  estado text not null default 'BORRADOR' check (estado in ('BORRADOR', 'FINALIZADA')),
  fecha date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_revision_pre_entrega_evaluador
  on public.revision_pre_entrega(evaluador_id, created_at desc);
create index if not exists idx_revision_pre_entrega_sucursal
  on public.revision_pre_entrega(sucursal_id, created_at desc);

-- Instalaciones donde la tabla ya existía (la pre-entrega la creó como NOT
-- NULL): la inspección se hace sin sucursal, así que la columna se suelta.
alter table public.revision_pre_entrega alter column sucursal_id drop not null;

-- ----------------------------------------------------------------------------
-- RLS
--
-- La herramienta la usan el LÍDER y el EVALUADOR. Cada uno ve y edita las
-- suyas; el LÍDER ve todas. No se exige que haya `evaluaciones` abierta ni que
-- la fila tenga sucursal: la inspección se hace donde esté el vehículo.
-- ----------------------------------------------------------------------------
alter table public.revision_pre_entrega enable row level security;

create or replace function public.puede_usar_revision_pre_entrega()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and p.rol in ('LIDER', 'EVALUADOR')
  );
$$;

drop policy if exists revision_pre_entrega_select on public.revision_pre_entrega;
create policy revision_pre_entrega_select on public.revision_pre_entrega
  for select using (evaluador_id = auth.uid() or public.es_lider());

drop policy if exists revision_pre_entrega_insert on public.revision_pre_entrega;
create policy revision_pre_entrega_insert on public.revision_pre_entrega
  for insert with check (evaluador_id = auth.uid() and public.puede_usar_revision_pre_entrega());

drop policy if exists revision_pre_entrega_update on public.revision_pre_entrega;
create policy revision_pre_entrega_update on public.revision_pre_entrega
  for update using (evaluador_id = auth.uid() or public.es_lider())
  with check (evaluador_id = auth.uid() or public.es_lider());

drop policy if exists revision_pre_entrega_delete on public.revision_pre_entrega;
create policy revision_pre_entrega_delete on public.revision_pre_entrega
  for delete using (evaluador_id = auth.uid() or public.es_lider());

-- ----------------------------------------------------------------------------
-- Fotos de la revisión: bucket `evidencias`, ruta `pre-entrega/<registro_id>/<foto_id>`.
-- ----------------------------------------------------------------------------
drop policy if exists storage_pre_entrega_insert on storage.objects;
create policy storage_pre_entrega_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  );

drop policy if exists storage_pre_entrega_update on storage.objects;
create policy storage_pre_entrega_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  )
  with check (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  );

drop policy if exists storage_pre_entrega_select on storage.objects;
create policy storage_pre_entrega_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidencias'
    and (
      public.es_lider()
      or exists (
        select 1 from public.revision_pre_entrega r
        where r.evaluador_id = auth.uid()
          and name like 'pre-entrega/' || r.id::text || '/%'
      )
    )
  );

drop policy if exists storage_pre_entrega_delete on storage.objects;
create policy storage_pre_entrega_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidencias'
    and exists (
      select 1 from public.revision_pre_entrega r
      where r.evaluador_id = auth.uid()
        and name like 'pre-entrega/' || r.id::text || '/%'
    )
  );

-- ----------------------------------------------------------------------------
-- Módulo y check list de la inspección.
--
-- Se inserta solo lo que falta (por `herramienta` y por `texto` dentro del
-- módulo): correrlo de nuevo no toca lo que el LÍDER ya haya editado, así que
-- las respuestas guardadas siguen apuntando a ítems que no desaparecen.
-- ----------------------------------------------------------------------------

do $$
declare
  v_mod uuid;
begin
  select id into v_mod from public.modulos where herramienta = 'INSPECCION_VEHICULO';
  if v_mod is null then
    insert into public.modulos (nombre, descripcion, orden, activo, compartido, herramienta)
    values (
      'Inspección de vehículo',
      'Revisión estética, mecánica y de gas vehicular de un vehículo particular: se llena con fotos y dictamen, y se imprime en PDF. No forma parte de la evaluación.',
      910,
      true,
      false,
      'INSPECCION_VEHICULO'
    )
    returning id into v_mod;
  end if;

  -- ----------------------------------------------------------------------------
  -- Secciones (CONTENEDOR). Van primero en la pantalla y en el PDF, que abre
  -- una banda con el nombre de cada una sobre sus filas.
  -- ----------------------------------------------------------------------------
  insert into public.items (modulo_id, tipo, texto, opciones, responsables, orden, requerido, activo, puntaje, padre_id, api_campos, contra_dato)
  select v_mod, 'CONTENEDOR', t.texto, '[]'::jsonb, '[]'::jsonb, t.orden, false, true, 0, null, '[]'::jsonb, 'SOH'
  from (values
    ('Estética', 0),
    ('Mecánica', 1),
    ('Sistema de gas vehicular (GNV)', 2)
  ) as t(texto, orden)
  where not exists (
    select 1 from public.items i where i.modulo_id = v_mod and i.texto = t.texto
  );

  -- ----------------------------------------------------------------------------
  -- Preguntas por sección. Cada una es un CHECKLIST de puntos concretos: son
  -- los que el PDF lista con su estado, y sobre cada punto va la foto o la
  -- incidencia que se haya cargado.
  -- Los puntos se dejan en 0: la inspección no puntúa, es un dictamen.
  -- ----------------------------------------------------------------------------
  insert into public.items (modulo_id, tipo, texto, opciones, responsables, orden, requerido, activo, puntaje, padre_id, api_campos, contra_dato)
  select v_mod, 'CHECKLIST', t.texto, t.opciones::jsonb, '[]'::jsonb, t.orden, false, true, 0, s.id, '[]'::jsonb, 'SOH'
  from (values
    -- ---------------- Estética ----------------
    ('Estética', 'Carrocería y pintura', '[
      {"id":"ins-est-1","etiqueta":"Sin abolladuras ni golpes"},
      {"id":"ins-est-2","etiqueta":"Sin rayones profundos"},
      {"id":"ins-est-3","etiqueta":"Pintura uniforme, sin descascarada"},
      {"id":"ins-est-4","etiqueta":"Puertas, capó y baúl alineados y cerran bien"},
      {"id":"ins-est-5","etiqueta":"Sin óxido visible"}
    ]', 0),
    ('Estética', 'Vidrios y espejos', '[
      {"id":"ins-vis-1","etiqueta":"Parabrisas sin fisuras ni estrellas"},
      {"id":"ins-vis-2","etiqueta":"Vidrios laterales y luneta sin roturas"},
      {"id":"ins-vis-3","etiqueta":"Espejos retrovisores completos y firmes"},
      {"id":"ins-vis-4","etiqueta":"Cristales suben y bajan sin ruido"}
    ]', 1),
    ('Estética', 'Luces exteriores', '[
      {"id":"ins-luz-1","etiqueta":"Luz baja y alta"},
      {"id":"ins-luz-2","etiqueta":"Luz de freno y stop"},
      {"id":"ins-luz-3","etiqueta":"Direccional delantera y trasera"},
      {"id":"ins-luz-4","etiqueta":"Luz de reversa"},
      {"id":"ins-luz-5","etiqueta":"Luz de matrícula"},
      {"id":"ins-luz-6","etiqueta":"Luces de emergencia"}
    ]', 2),
    ('Estética', 'Interior', '[
      {"id":"ins-int-1","etiqueta":"Asientos y tapizados sin roturas"},
      {"id":"ins-int-2","etiqueta":"Alfombrillas y piso en buen estado"},
      {"id":"ins-int-3","etiqueta":"Tablero sin piezas rotas ni sueltas"},
      {"id":"ins-int-4","etiqueta":"Aire acondicionado enfría"}
    ]', 3),

    -- ---------------- Mecánica ----------------
    ('Mecánica', 'Frenos', '[
      {"id":"ins-fre-1","etiqueta":"Freno de servicio firme, sin hundirse"},
      {"id":"ins-fre-2","etiqueta":"Freno de estacionamiento sostiene la pendiente"},
      {"id":"ins-fre-3","etiqueta":"Pastillas y discos con espesor suficiente"},
      {"id":"ins-fre-4","etiqueta":"Líquido de frenos por encima del mínimo"},
      {"id":"ins-fre-5","etiqueta":"Sin ruidos chirriantes al frenar"}
    ]', 0),
    ('Mecánica', 'Motor y niveles', '[
      {"id":"ins-mot-1","etiqueta":"Nivel de aceite correcto"},
      {"id":"ins-mot-2","etiqueta":"Refrigerante en el depósito"},
      {"id":"ins-mot-3","etiqueta":"Batería con bornes limpios y apretados"},
      {"id":"ins-mot-4","etiqueta":"Arranca sin esfuerzo y ralentí estable"},
      {"id":"ins-mot-5","etiqueta":"Sin humos anormales ni fugas de fluidos"},
      {"id":"ins-mot-6","etiqueta":"Testigos del tablero apagados con el motor encendido"}
    ]', 1),
    ('Mecánica', 'Suspensión, dirección y llantas', '[
      {"id":"ins-sus-1","etiqueta":"Volante sin vibración ni tironeo"},
      {"id":"ins-sus-2","etiqueta":"Amortiguadores sin fugas y sin golpes al pasar baches"},
      {"id":"ins-sus-3","etiqueta":"Llantas con dibujo suficiente y presión correcta"},
      {"id":"ins-sus-4","etiqueta":"Sin desgaste irregular en los neumáticos"},
      {"id":"ins-sus-5","etiqueta":"Llanta de repuesto en condiciones"}
    ]', 2),
    ('Mecánica', 'Transmisión y embrague', '[
      {"id":"ins-tra-1","etiqueta":"Embrague sin patinar"},
      {"id":"ins-tra-2","etiqueta":"Cambios entran sin esfuerzo ni ruido"},
      {"id":"ins-tra-3","etiqueta":"Sin vibraciones a velocidad de crucero"}
    ]', 3),

    -- ------------- Sistema de gas vehicular (GNV) -------------
    ('Sistema de gas vehicular (GNV)', 'Instalación y cilindro', '[
      {"id":"ins-gnv-1","etiqueta":"Cilindro con soportes y abrazaderas firmes"},
      {"id":"ins-gnv-2","etiqueta":"Prueba hidrostática vigente y rotulada"},
      {"id":"ins-gnv-3","etiqueta":"Válvula de corte operativa"},
      {"id":"ins-gnv-4","etiqueta":"Sin deformaciones ni golpes en el cilindro"},
      {"id":"ins-gnv-5","etiqueta":"Rótulo de certificación de la instalación visible"}
    ]', 0),
    ('Sistema de gas vehicular (GNV)', 'Líneas y regulador', '[
      {"id":"ins-lin-1","etiqueta":"Tuberías sin olores de fuga"},
      {"id":"ins-lin-2","etiqueta":"Conexiones y abrazaderas sin holguras"},
      {"id":"ins-lin-3","etiqueta":"Regulador sin escapes"},
      {"id":"ins-lin-4","etiqueta":"Electroválvula de corte responde"},
      {"id":"ins-lin-5","etiqueta":"Revestimiento de las líneas en buen estado"}
    ]', 1),
    ('Sistema de gas vehicular (GNV)', 'Funcionamiento', '[
      {"id":"ins-fun-1","etiqueta":"Arranca en gas sin problema"},
      {"id":"ins-fun-2","etiqueta":"Cambia solo entre gasolina y gas"},
      {"id":"ins-fun-3","etiqueta":"Ralentí estable funcionando a gas"},
      {"id":"ins-fun-4","etiqueta":"Sin pérdida notable de potencia"},
      {"id":"ins-fun-5","etiqueta":"Sin olores de gas en cabina"},
      {"id":"ins-fun-6","etiqueta":"Testigo de selección de combustible operativo"}
    ]', 2),
    ('Sistema de gas vehicular (GNV)', 'Documentación del GNV', '[
      {"id":"ins-doc-1","etiqueta":"Permiso de instalación vigente"},
      {"id":"ins-doc-2","etiqueta":"Certificado del instalador"},
      {"id":"ins-doc-3","etiqueta":"Manual de operación a bordo"}
    ]', 3)
  ) as t(seccion, texto, opciones, orden)
  join public.items s
    on s.modulo_id = v_mod and s.tipo = 'CONTENEDOR' and s.texto = t.seccion
  where not exists (
    select 1 from public.items i where i.modulo_id = v_mod and i.texto = t.texto
  );

  -- ----------------------------------------------------------------------------
  -- Dictamen: cumple / no cumple, sin sección (se llena al final, después de
  -- las tres revisiones). Es el que hace «No aplica» cuando el vehículo no es
  -- de gas, por eso se deja como cierre y no dentro de una sección.
  -- ----------------------------------------------------------------------------
  insert into public.items (modulo_id, tipo, texto, opciones, responsables, orden, requerido, activo, puntaje, padre_id, api_campos, contra_dato)
  select v_mod, 'CUMPLE_NO_CUMPLE', '¿El vehículo queda en condiciones de circular?', '[]'::jsonb, '[]'::jsonb, 99, true, true, 0, null, '[]'::jsonb, 'SOH'
  where not exists (
    select 1 from public.items where modulo_id = v_mod and texto = '¿El vehículo queda en condiciones de circular?'
  );
end $$;


-- ###########################################################################
-- Archivo consolidado: compartir-evaluacion.sql
-- ###########################################################################
-- ============================================================================
-- ENLACE PÚBLICO DE CONCILIACIÓN (pantalla de invitado)
--
-- Corre esto en el SQL Editor. Es idempotente: se puede repetir.
--
-- QUÉ RESUELVE
-- ------------
-- El coordinador de inventario quiere ver cómo va la conciliación de una
-- evaluación sin tener cuenta en la app. El backend está cerrado a `anon` a
-- propósito (ver `cerrar-permisos-anon.sql`), así que esto NO es abrir una
-- tabla: es abrir UNA función que devuelve UNA evaluación y sólo si el
-- enlace está activo.
--
-- CÓMO SE CIERRA
-- --------------
-- · La tabla nueva nace cerrada para `anon` (el `alter default privileges
--   ... revoke all on tables from anon` de `cerrar-permisos-anon.sql` lo
--   garantiza para toda tabla futura).
-- · `anon` no tiene ninguna política sobre ella: RLS le devuelve cero filas
--   aunque por error tuviera permiso de tabla.
-- · La única entrada es `ver_conciliacion_compartida(p_token)`, SECURITY
--   DEFINER, con `search_path` fijo. Si el token no existe o el enlace está
--   apagado, devuelve un objeto con `evaluacion: null` y listas vacías: no
--   se distingue entre "token equivocado" y "no hay nada", que es lo que
--   impide adivinar tokens enumerando respuestas.
-- · El token se GENERA en el cliente (32 bytes aleatorios en hex). No hay
--   forma de derivarlo de la evaluación: 2^256 de espacio, adivinarlo por
--   fuerza bruta no es viable.
--
-- RIESGO QUE QUEDA Y POR QUÉ ES ACEPTABLE
-- ---------------------------------------
-- El enlace es un secreto compartido: cualquiera que lo reciba puede ver la
-- conciliación mientras esté activo. Por eso existe `activo` y la fila se
-- puede apagar desde la app sin tocar la base. Lo que el enlace NO expone:
-- fotos, incidencias, colaboradores, otros ítems, la identidad del evaluador
-- ni el resto de las evaluaciones.
--
-- ROLLBACK
-- --------
--     revoke execute on function public.ver_conciliacion_compartida(text) from public, anon;
--     drop function public.ver_conciliacion_compartida(text);
--     drop table if exists public.evaluaciones_compartidas;
--
-- Apagar todos los enlaces sin borrar nada (una sola fila):
--     update public.evaluaciones_compartidas set activo = false;
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) La tabla: una fila por evaluación, con su token
-- ----------------------------------------------------------------------------
-- La PK es la evaluación, no el token: así "compartir" de nuevo la misma
-- evaluación REEMPLAZA el enlace anterior en vez de acumular links viejos que
-- nadie puede revocar. Es el patrón de `invitaciones.token`, con la diferencia
-- de que acá hay una sola fila por unidad de trabajo.
create table if not exists public.evaluaciones_compartidas (
  evaluacion_id uuid primary key
    references public.evaluaciones (id) on delete cascade,
  token         text   not null unique,
  activo        boolean not null default true,
  creado_por    uuid   references public.profiles (id) on delete set null,
  creado_at     timestamptz not null default now()
);

alter table public.evaluaciones_compartidas enable row level security;

-- ----------------------------------------------------------------------------
-- 2) Políticas: para sesion, nunca para anon
-- ----------------------------------------------------------------------------
-- Quien ya puede ver la evaluación puede ver que está compartida (sino, el
-- botón de compartir no tendría memoria entre sesiones).
drop policy if exists evaluaciones_compartidas_select on public.evaluaciones_compartidas;
create policy evaluaciones_compartidas_select on public.evaluaciones_compartidas
  for select to authenticated
  using (exists (
    select 1 from public.evaluaciones e
    where e.id = evaluaciones_compartidas.evaluacion_id
      and public.puede_ver_evaluacion(e)
  ));

-- Crear y apagar enlaces es configuración: mismo criterio que el catálogo.
-- Un líder apaga cualquiera, no sólo el que él creó.
drop policy if exists evaluaciones_compartidas_lider on public.evaluaciones_compartidas;
create policy evaluaciones_compartidas_lider on public.evaluaciones_compartidas
  for all to authenticated
  using (public.es_lider()) with check (public.es_lider());

-- ----------------------------------------------------------------------------
-- 3) La única puerta: leer la conciliación de un enlace
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER porque corre SIN sesión y `anon` no tiene permiso de tabla
-- sobre nada. El token es la autorización.
--
-- Devuelve sólo lo que la pantalla pública pinta: la evaluación (con su
-- sucursal o departamento), las respuestas de los ítems de conciliación, esos
-- ítems y sus contenedores, sus módulos y las opciones marcadas de la unidad.
-- NO devuelve fotos, incidencias, colaboradores ni el resto de los ítems.
--
-- `stable` a propósito: no escribe nada y PostgREST puede cachearla por
-- petición.
create or replace function public.ver_conciliacion_compartida(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with enlace as (
    select c.evaluacion_id
    from public.evaluaciones_compartidas c
    where c.activo and c.token = p_token
  ),
  ev as (
    -- Sólo columnas que la app escribe o lee por nombre en otros lados, y que
    -- la pantalla pública usa. `created_at` y `aperturada_por` quedaron fuera
    -- a propósito: la primera no está en la tabla real de algunas bases y la
    -- segunda expondría al evaluador, que el enlace no debe mostrar.
    select e.id, e.sucursal_id, e.departamento_id, e.fecha,
           e.estado, e.puntuacion, e.comentario_general, e.cerrada_en
    from public.evaluaciones e
    where e.id in (select evaluacion_id from enlace)
  ),
  resp as (
    select r.evaluacion_id, r.item_id, r.instancia_id, r.valor, r.respondido_por
    from public.respuestas r
    where r.evaluacion_id in (select evaluacion_id from enlace)
  ),
  -- Sólo los ítems de conciliación. El filtro va por `tipo` y no por los que
  -- traigan respuesta: si mañana aparece un ítem de conciliación sin responder,
  -- la pantalla lo muestra vacío en vez de no mostrarlo.
  its as (
    select i.*
    from public.items i
    where i.tipo = 'CONCILIACION'
      and i.id in (select item_id from resp)
  ),
  -- Los contenedores que los agrupan: sin ellos no se sabe en qué módulo
  -- está cada conciliación.
  padres as (
    select p.*
    from public.items p
    where p.id in (select padre_id from its where padre_id is not null)
  ),
  mods as (
    select m.*
    from public.modulos m
    where m.id in (select modulo_id from its)
  ),
  suc as (
    select s.id, s.nombre from public.sucursales s
    where s.id in (select sucursal_id from ev)
  ),
  dep as (
    select d.id, d.nombre from public.departamentos_centralizados d
    where d.id in (select departamento_id from ev)
  ),
  -- Las opciones activas de la unidad. Una evaluación es de sucursal O de
  -- departamento, así que una de las dos mitades siempre viene vacía.
  ops as (
    select o.* from public.sucursal_opciones o
     where o.sucursal_id in (select sucursal_id from ev) and o.activa
    union all
    select o.* from public.departamento_opciones o
     where o.departamento_id in (select departamento_id from ev) and o.activa
  )
  select jsonb_build_object(
    'evaluacion', (
      -- El alias hace falta en los tres: `from ev` no crea el alias `e`, y sin
      -- él Postgres resuelve `to_jsonb(e)` como una COLUMNA llamada "e".
      select to_jsonb(e) || jsonb_build_object(
        'sucursal', (select to_jsonb(s) from suc s),
        'departamento', (select to_jsonb(d) from dep d)
      )
      from ev e
    ),
    'respuestas', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from resp r),
    -- `its` y `padres` vienen de la misma tabla, así que la unión sólo
    -- desduplica y no puede mezclar columnas.
    'items',      (select coalesce(jsonb_agg(to_jsonb(i) order by i.orden), '[]'::jsonb)
                     from (select * from its union select * from padres) i),
    'modulos',    (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from mods m),
    'opciones',   (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from ops o)
  );
$$;

-- ----------------------------------------------------------------------------
-- 4) Permisos de la función
-- ----------------------------------------------------------------------------
-- `anon`, porque la pantalla corre sin sesión; y `authenticated`, porque el
-- enlace lo puede abrir alguien que YA tiene sesion (un líder mirando su
-- propio link desde un navegador con la app abierta). Sin el segundo grant,
-- abrir el enlace con la sesión puesta daba "permission denied" y parecía
-- que el enlace estaba roto.
--
-- El revoke va con PUBLIC porque los permisos en Postgres son aditivos: sin
-- quitar el grant heredado, cualquier rol seguiría pudiendo llamarla.
revoke execute on function public.ver_conciliacion_compartida(text) from public, anon;
grant  execute on function public.ver_conciliacion_compartida(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) Utilerias que se corren a mano desde el SQL Editor
-- ----------------------------------------------------------------------------
-- `mergear_conciliacion` es el helper con el que `upsert_respuestas` fusiona el
-- valor de una conciliacion en vez de pisarlo (union por SKU de las dos listas).
-- Corre como el que sube, asi que `authenticated` si la necesita.
revoke execute on function public.mergear_conciliacion(jsonb, jsonb, text) from public, anon;
grant  execute on function public.mergear_conciliacion(jsonb, jsonb, text) to authenticated;

-- Las dos del backfill de departamentos no las llama la app: el mapa se arma a
-- mano (los scripts que lo generaban se eliminaron del repo). Sin EXECUTE para nadie.
revoke execute on function public.previsualizar_departamentos(jsonb) from public, anon, authenticated;
revoke execute on function public.aplicar_departamentos(jsonb) from public, anon, authenticated;

-- Y la de la pre-entrega/inspeccion: es security definer, pero la invocan las
-- politicas RLS, que corren con sesion. Para anon no aporta nada y sobra.
revoke execute on function public.puede_usar_revision_pre_entrega() from public, anon;
grant  execute on function public.puede_usar_revision_pre_entrega() to authenticated;

commit;

-- ============================================================================
-- Verificación (sólo lectura)
-- ============================================================================

-- 1) La tabla tiene que dar anon_select = false. Si da true, el revoke general
--    de `cerrar-permisos-anon.sql` no cubrió a esta y hay que correrlo.
select
  c.relname as tabla,
  has_table_privilege('anon', c.oid, 'select')          as anon_select,
  has_table_privilege('authenticated', c.oid, 'select')  as sesion_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'evaluaciones_compartidas';

-- 2) La función tiene que ser la única abierta a anon además de las dos del
--    login. Si aparece otra acá, es una fuga.
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_puede,
  has_function_privilege('authenticated', p.oid, 'execute') as sesion_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;

-- 3) Las dos políticas existen y la tabla tiene RLS encendido.
select
  c.relname,
  c.relrowsecurity as rls,
  (select count(*)::int from pg_policies pp
    where pp.schemaname = 'public' and pp.tablename = c.relname) as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'evaluaciones_compartidas';


-- ###########################################################################
-- Archivo consolidado: conciliacion-borrar-productos.sql
-- ###########################################################################
-- ============================================================================
-- Borrar un producto escaneado: hace falta una marca, porque el servidor fusiona
-- ============================================================================
--
-- Problema: en produccion `upsert_respuestas` no reemplaza el valor de una
-- conciliacion, lo FUSIONA con el que ya esta en la nube usando
-- `mergear_conciliacion`, y esa fusion es una union por SKU de las dos listas.
--
-- Con esa regla borrar era imposible, y no de vez en cuando: era imposible en
-- la misma escritura. Se mandaba una lista sin el producto X, el servidor la
-- unia con la anterior (que todavia traia X), agrupaba por sku y X volvia. El
-- usuario veia que en el editor desaparecia y en el detalle seguia.
--
-- Arreglo: el que borra manda una MARCA, no una lista corta.
--
--   * `borrados`  : skus que hay que sacar. Vive en el valor guardado a proposito.
--                   Un telefono que todavia no sincronizo manda el sku de vuelta,
--                   y como la marca sigue ahi el servidor lo vuelve a matar: sin
--                   persistirla, el borrado dependia de que nadie mas subiera.
--   * `reabrir`   : skus que vuelven a la lista a proposito (alguien lo
--                   re-escaneo) y con eso se levanta su marca. Es de una sola
--                   pasada: el servidor lo consume y no lo guarda.
--
-- `reabrir` hace falta porque es lo unico que distingue los dos casos que suben
-- el mismo sku: "lo re-escaneo porque lo quiero" y "este equipo no se entero del
-- borrado y me manda la lista vieja". Sin el aviso, los dos se ven igual y el
-- re-escaneo se moria igual que el producto borrado.
--
-- Como correrlo: pegar tal cual en el SQL Editor de Supabase y ejecutar. Es
-- idempotente (create or replace), se puede correr mas de una vez.
--
-- La FIRMA NO CAMBIA: `upsert_respuestas` (que es security invoker y llama a
-- esta con los permisos de quien sube) sigue llamandola igual y no hay que
-- tocarlo. Los privilegios tampoco.
-- ============================================================================

create or replace function public.mergear_conciliacion(previo jsonb, entrante jsonb, contra_dato text default 'SOH')
returns jsonb
language sql
immutable
set search_path = public
as $$
  with base as (
    -- Lo que sube manda por clave; lo que solo existia en la nube se conserva.
    -- Sin photoIds: son ids locales del telefono, no rutas del bucket.
    select (coalesce(previo, '{}'::jsonb) || coalesce(entrante, '{}'::jsonb)) - 'photoIds' as v
  ),
  -- Skus que quedan fuera de la fusion. Se unen las dos marcas y solo
  -- `entrante.reabrir` las levanta. Sale como texto: `sku` es un jsonb escalar
  -- y compararlo contra el `->>'sku'` de los productos da "operator does not
  -- exist: jsonb = text".
  borrados as (
    select distinct (t.sku #>> '{}') as sku
    from (
      select jsonb_array_elements(
        case when jsonb_typeof(previo->'borrados') = 'array' then previo->'borrados' else '[]'::jsonb end
      ) as sku
      union all
      select jsonb_array_elements(
        case when jsonb_typeof(entrante->'borrados') = 'array' then entrante->'borrados' else '[]'::jsonb end
      ) as sku
    ) t
    where jsonb_typeof(t.sku) = 'string'
      and not exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(entrante->'reabrir') = 'array' then entrante->'reabrir' else '[]'::jsonb end
        ) r
        where r = t.sku
      )
  ),
  viejos as (
    select value as p, value->>'sku' as sku
    from jsonb_array_elements(previo->'productos') value
    where previo ? 'productos'
      and value->>'sku' is not null and value->>'sku' <> ''
      and not exists (select 1 from borrados b where b.sku = value->>'sku')
  ),
  nuevos as (
    select value as p, value->>'sku' as sku
    from jsonb_array_elements(entrante->'productos') value
    where entrante ? 'productos'
      and value->>'sku' is not null and value->>'sku' <> ''
      and not exists (select 1 from borrados b where b.sku = value->>'sku')
  ),
  unidos as (
    select p, sku, 'n' as o from nuevos
    union all
    select p, sku, 'v' from viejos
  ),
  -- Evidencia por producto: la union de las `paths` de la nube con las que suben,
  -- casada al sku. Solo strings.
  --
  -- El filtro va adentro del join y no como `t.e is null or ...`: con el left
  -- join lateral, un producto al que le falta `paths` daba UNA fila con `e` en
  -- null, esa fila pasaba el `is null`, y `jsonb_agg` la metía al arreglo —el
  -- producto quedaba con `["ev/f1.jpg", null]`. Sacando el null del where, ese
  -- producto no da fila, el left join de abajo lo deja en null y el coalesce lo
  -- devuelve con `'[]'`.
  fotos_por_sku as (
    select u.sku,
           coalesce(jsonb_agg(distinct t.e order by t.e), '[]'::jsonb) as arr
    from unidos u
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(u.p -> 'paths') = 'array' then u.p -> 'paths' else '[]'::jsonb end
    ) as t(e) on true
    where jsonb_typeof(t.e) = 'string'
    group by u.sku
  ),
  por_sku as (
    select sku,
      coalesce(max(p->>'nombre')       filter (where o = 'n'), max(p->>'nombre')       filter (where o = 'v')) as nombre,
      coalesce(max(p->>'teorica')      filter (where o = 'n'), max(p->>'teorica')      filter (where o = 'v')) as teorica,
      max(coalesce((p->>'fisica')::numeric, 0))                                           as fisica,
      coalesce(max(p->>'soh')          filter (where o = 'n'), max(p->>'soh')          filter (where o = 'v')) as soh,
      coalesce(max(p->>'lastSync')     filter (where o = 'n'), max(p->>'lastSync')     filter (where o = 'v')) as lastSync,
      coalesce(max(p->>'finalBase')    filter (where o = 'n'), max(p->>'finalBase')    filter (where o = 'v')) as finalBase,
      coalesce(max(p->>'finalTax')     filter (where o = 'n'), max(p->>'finalTax')     filter (where o = 'v')) as finalTax,
      coalesce(max(p->>'departamento') filter (where o = 'n'), max(p->>'departamento') filter (where o = 'v')) as departamento,
      coalesce(max(p->>'apiId')        filter (where o = 'n'), max(p->>'apiId')        filter (where o = 'v')) as api_id,
      coalesce(max(p->>'escaneadoPor') filter (where o = 'n'), max(p->>'escaneadoPor') filter (where o = 'v')) as escaneado_por,
      coalesce(max(p->>'sinHablador')  filter (where o = 'n'), max(p->>'sinHablador')  filter (where o = 'v')) as sinHablador
    from unidos
    group by sku
  ),
  ajustados as (
    select *,
      case when sinHablador = 'true' then null else fisica end as fisica_efectiva
    from por_sku
  ),
  lista as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sku', a.sku,
      'apiId', case when a.api_id ~ '^[0-9]+$' then a.api_id::bigint else null end,
      'escaneadoPor', a.escaneado_por,
      'nombre', a.nombre,
      'teorica', a.teorica::numeric,
      'fisica', a.fisica_efectiva,
      'soh', a.soh::numeric,
      'lastSync', a.lastSync,
      'finalBase', a.finalBase::numeric,
      'finalTax', a.finalTax::numeric,
      'departamento', a.departamento,
      'sinHablador', (a.sinHablador = 'true'),
      'paths', coalesce(fp.arr, '[]'::jsonb),
      'perdidaEstimada',
        case
          when contra_dato = 'SOH'
           and a.teorica::numeric is not null
           and a.fisica_efectiva is not null
           and a.finalBase::numeric is not null
          then greatest(0::numeric, a.teorica::numeric - a.fisica_efectiva)
               * (a.finalBase::numeric + coalesce(a.finalTax::numeric, 0))
          else null
        end
    ) order by a.sku), '[]'::jsonb) as arr
    from ajustados a
    left join fotos_por_sku fp on fp.sku = a.sku
  ),
  con_productos as (
    select jsonb_set(base.v, '{productos}', (select arr from lista), true) as v
    from base
  ),
  con_gerente as (
    select jsonb_set(
      con_productos.v,
      '{responsablesGerente}',
      coalesce(previo->'responsablesGerente', entrante->'responsablesGerente', 'null'::jsonb),
      true
    ) as v
    from con_productos
  ),
  -- Las marcas quedan guardadas: son las que matan al sku en la proxima subida
  -- de un telefono que no se entero. Vacias, se caen solas para no dejar el
  -- valor lleno de listas muertas.
  con_marcas as (
    select case
      when (select count(*) from borrados) > 0
        then jsonb_set(con_gerente.v, '{borrados}',
               (select coalesce(jsonb_agg(to_jsonb(sku) order by sku), '[]'::jsonb) from borrados), true)
      else con_gerente.v - 'borrados'
    end as v
    from con_gerente
  ),
  -- Hereda de una version vieja del formato, donde las `paths` estaban arriba del
  -- valor y no dentro del producto: se unen igual para no perderlas.
  fotos as (
    select distinct e
    from (
      (select jsonb_array_elements(
        case when jsonb_typeof(previo->'paths') = 'array' then previo->'paths' else '[]'::jsonb end
      ) as e)
      union all
      (select jsonb_array_elements(
        case when jsonb_typeof(entrante->'paths') = 'array' then entrante->'paths' else '[]'::jsonb end
      ) as e)
    ) x
    where jsonb_typeof(e) = 'string'
  ),
  paths_union as (
    select coalesce(jsonb_agg(e order by e), '[]'::jsonb) as arr
    from fotos
  )
  select case
    when (select jsonb_array_length(arr) from paths_union) > 0
      then jsonb_set(con_marcas.v, '{paths}', (select arr from paths_union), true)
    else con_marcas.v
  -- `reabrir` es de una sola pasada: ya cumplio su funcion de levantar la marca
  -- y guardarla seria dejar un comando pegado al valor para siempre.
  end - 'reabrir'
  from con_marcas;
$$;

-- Privilegios como los del resto de helpers internos de `upsert_respuestas`.
revoke execute on function public.mergear_conciliacion(jsonb, jsonb, text) from public, anon;
grant  execute on function public.mergear_conciliacion(jsonb, jsonb, text) to authenticated;

-- ============================================================================
-- Verificacion (solo lectura). Correr despues del parche.
-- ============================================================================

-- 1) Lo que se pide: borrar mata al sku aunque el valor anterior lo traiga.
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1},{"sku":"B"}]}'::jsonb,
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1}],"borrados":["B"]}'::jsonb,
--   'SOH'
-- );
-- Esperado: solo el producto A, y el valor guardado sigue con borrados = ["B"].

-- 2) El caso que resiste: otro telefono manda el sku borrado sin saber nada, y la
--    marca que quedo guardada lo vuelve a matar.
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A"}],"borrados":["B"]}'::jsonb,
--   '{"productos":[{"sku":"A"},{"sku":"B"}]}'::jsonb,
--   'SOH'
-- );
-- Esperado: solo A. B no vuelve.

-- 3) Y el caso contrario: alguien lo re-escanea a proposito y lo levanta.
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A"}],"borrados":["B"]}'::jsonb,
--   '{"productos":[{"sku":"A"},{"sku":"B"}],"reabrir":["B"]}'::jsonb,
--   'SOH'
-- );
-- Esperado: A y B, y el valor guardado ya sin borrados (la marca se levanto).

-- 4) Sin cambios de nada, se comporta igual que siempre.
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1,"paths":["ev/e/i/f1.jpg"]}]}'::jsonb,
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1,"informativo":false}]}'::jsonb,
--   'SOH'
-- );
-- Esperado: A conserva paths = ["ev/e/i/f1.jpg"].


-- ###########################################################################
-- Archivo consolidado: taller-automotriz-a-departamento.sql
-- ###########################################################################
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


-- ###########################################################################
-- Archivo consolidado: cerrar-lectura-anon.sql
-- ###########################################################################
-- ============================================================================
-- CERRAR LA LECTURA ANÃ“NIMA
--
-- Corre esto PRIMERO. No depende de ningÃºn otro archivo y se puede correr las
-- veces que haga falta.
--
-- QUÃ‰ HACE
-- --------
-- Cierra a quien no iniciÃ³ sesiÃ³n la lectura de 7 tablas:
--
--   profiles            correos, usuario, rol y sucursal de cada persona
--   items               la rÃºbrica completa: puntajes, pesos y umbrales
--   modulos             la estructura de la evaluaciÃ³n
--   sucursales          nombres, branch_id, shop_id, gerente_id
--   sucursal_modulos    quÃ© mÃ³dulo tiene cada sucursal
--   sucursal_items      quÃ© Ã­tem tiene cada sucursal
--   sucursal_opciones   quÃ© opciÃ³n tiene cada sucursal
--
-- EL AGUJERO
-- ----------
-- Las 7 tenÃ­an su polÃ­tica de lectura asÃ­:
--
--     create policy <tabla>_select on public.<tabla> for select using (true);
--
-- Sin `to`, una polÃ­tica RLS aplica a PUBLIC â€” y PUBLIC incluye al rol `anon`.
-- AdemÃ¡s los proyectos de Supabase arrancan con un `grant all on all tables` para
-- `anon`. Las dos cosas juntas significaban que cualquiera, sin cuenta y sin
-- contraseÃ±a, podÃ­a hacer:
--
--     curl 'https://<proyecto>.supabase.co/rest/v1/items?select=*' \
--          -H "apikey: <anon key>"
--
-- y llevarse el contenido. La app expuesta en evaluxor.vercel.app tiene la anon
-- key adentro del bundle: no es un secreto. O sea que era pÃºblico para internet.
--
-- Lo que mÃ¡s pesa acÃ¡ es `items`: no hay credenciales, pero sÃ­ la forma completa
-- de puntuar â€”quÃ© vale cada punto y desde quÃ© umbral cuenta como aprobadoâ€” que
-- es informaciÃ³n comercial de la empresa.
--
-- POR QUÃ‰ SUPABASE NO LO AVISÃ“
-- -----------------------------
-- Las 29 alertas del advisor que habÃ­a eran todas de funciones. Ni una de
-- tablas. Por eso conviene no usar el advisor como lista de pendientes: es un
-- linter de un tipo de objeto, no un inventario de la base.
--
-- POR QUÃ‰ `to authenticated` Y NO ALGO MÃS
-- ----------------------------------------
-- Un evaluador con sesiÃ³n tiene que poder leer las 7: el catÃ¡logo entero sale de
-- ahÃ­ (src/lib/data/catalog.ts, que carga CatalogContext reciÃ©n cuando ya hay
-- perfil), y los joins por FK como
-- `sucursal:sucursales!profiles_sucursal_id_fkey(id, nombre)` dependen de que
-- `sucursales` sea legible. Cerrarlas a "solo yo" o a "solo el LÃ­der" rompe esas
-- pantallas. Lo que no puede es un visitante sin sesiÃ³n.
--
-- LO QUE NO SE ROMPE
-- ------------------
-- Â· La pantalla de login sigue funcionando: `email_por_usuario` e
--   `intento_login` son `SECURITY DEFINER`, asÃ­ que corren como el dueÃ±o de la
--   tabla y no les aplica ni la polÃ­tica ni el revoke. Por eso hacen falta esas
--   funciones y no un select directo.
-- Â· El registro por invitaciÃ³n sigue funcionando: el token lo valida el trigger
--   `validar_registro` sobre `auth.users`, no una consulta desde el navegador.
-- Â· El resto de las tablas (`evaluaciones`, `respuestas`, `instancias_grupo`,
--   `fotos`, `asignaciones`, `invitaciones`, `incidencias`) ya devolvÃ­an cero
--   filas para `anon`, porque su `using` pregunta por `auth.uid()` o por
--   `es_lider()`. No hace falta tocarlas.
--
-- POR QUÃ‰ TAMBIÃ‰N HAY UN `revoke`
-- ------------------------------
-- La polÃ­tica es la puerta de RLS. El `revoke` es la segunda: los permisos de
-- Postgres son aditivos, asÃ­ que si algÃºn dÃ­a RLS quedara apagado en una de estas
-- tablas (pasa, y no se ve en ningÃºn aviso), el `grant` por defecto de Supabase
-- pasarÃ­a a ser la Ãºnica puerta. Con las dos, `anon` no tiene ninguna vÃ­a.
--
-- CÃ“MO CORRERLO
-- -------------
--   1. PegÃ¡ el bloque de abajo en el SQL Editor y dale Run.
--   2. Es idempotente: se puede correr las veces que haga falta.
--   3. Al final estÃ¡ la verificaciÃ³n. Lo que importa es que en la primera tabla
--      (`lectura_anon`) las 7 filas de abajo salgan en `CERRADA`.
--
-- DESPUÃ‰S DE ESTO
-- ---------------
-- ReciÃ©n ahora corrÃ© `incidencias.sql` y despuÃ©s `reactivar-politicas.sql` (que
-- ya trae este mismo fix). El orden va en el README de `supabase/`.
-- ============================================================================

-- Cada tabla: primero se borra la polÃ­tica que pueda existir (por eso el `drop`
-- va explÃ­cito y no dentro de un DO: `create policy` a secas tira 42710 si ya
-- hay una, y en el SQL Editor eso corta el resto del bloque).
drop policy if exists profiles_select on public.profiles;
drop policy if exists sucursales_select on public.sucursales;
drop policy if exists modulos_select on public.modulos;
drop policy if exists items_select on public.items;
drop policy if exists sucursal_modulos_select on public.sucursal_modulos;
drop policy if exists sucursal_items_select on public.sucursal_items;
drop policy if exists sucursal_opciones_select on public.sucursal_opciones;

-- El `to authenticated` es lo que cierra. Sin esta palabra, la polÃ­tica sigue
-- aplicando a PUBLIC y por lo tanto a `anon`, diga lo que diga el `using`.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy sucursales_select on public.sucursales for select to authenticated using (true);
create policy modulos_select on public.modulos for select to authenticated using (true);
create policy items_select on public.items for select to authenticated using (true);
create policy sucursal_modulos_select on public.sucursal_modulos for select to authenticated using (true);
create policy sucursal_items_select on public.sucursal_items for select to authenticated using (true);
create policy sucursal_opciones_select on public.sucursal_opciones for select to authenticated using (true);

-- La segunda mitad de la cerradura.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'sucursales', 'modulos', 'items',
    'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
  ] loop
    execute format('revoke select on public.%I from anon', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- VerificaciÃ³n
-- ----------------------------------------------------------------------------
-- Las 7 filas tienen que salir en `CERRADA`.
--
-- `puede_select` en `anon` tiene que dar false en las siete. Si alguna da true, el
-- revoke no llegÃ³ a esa tabla.
--
-- Lo que sigue siendo verdad y es correcto: `authenticated` todavÃ­a puede leer
-- las 7, y en `profiles` eso incluye los correos. Cada persona ve nombre, rol y
-- sucursal del resto. Afinar `profiles` a `auth.uid() = id or es_lider()`
-- romperÃ­a los joins por FK de `aperturador` y `sucursales.gerente_id`, asÃ­ que
-- eso hay que hacerlo junto con la app, no antes.
select
  t.tabla,
  has_table_privilege('anon', t.tabla, 'select') as anon_puede_select,
  has_table_privilege('authenticated', t.tabla, 'select') as sesion_puede_select,
  case
    when not has_table_privilege('anon', t.tabla, 'select') then 'CERRADA'
    when exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.tabla
        and p.policyname = t.tabla || '_select'
        and 'anon' = any (p.roles)
    ) then 'ABIERTA (la politica le da acceso a anon)'
    else 'CERRADA por politica (el permiso de tabla sigue)'
  end as lectura_anon
from unnest(array[
  'profiles', 'sucursales', 'modulos', 'items',
  'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
]) as t(tabla)
order by t.tabla;

-- Y las polÃ­ticas, para confirmar que quedaron con `to authenticated`:
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'sucursales', 'modulos', 'items',
    'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
  )
  and policyname like '%\_select'
order by tablename, policyname;

-- Y que el login siga con su permiso: `intento_login` y `email_por_usuario`
-- tienen que dar true, son las dos funciones de la pantalla sin sesiÃ³n.
select
  p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as sesion_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('intento_login', 'email_por_usuario')
order by p.proname;

-- ###########################################################################
-- Archivo consolidado: cerrar-permisos-anon.sql
-- ###########################################################################
-- ============================================================================
-- SACARLE A `anon` TODO LO QUE LE SOBRA
--
-- Corre esto DESPUÃ‰S de `cerrar-lectura-anon.sql`. Es idempotente.
--
-- QUÃ‰ HACE, EN DOS PARTES QUE SON UNA SOLA COSA
-- ---------------------------------------------
-- 1) Le saca a `anon` el permiso sobre TODAS las tablas de `public`.
--
-- 2) Le saca a `anon` el EXECUTE de los 6 ayudantes de polÃ­tica RLS.
--
-- La 2 depende de la 1, y por eso van en el mismo archivo. No son dos
-- ajustes de seguridad sueltos: la 2 es IMPOSIBLE de hacer bien sin la 1.
--
-- POR QUÃ‰
-- --------
-- Las polÃ­ticas RLS se evalÃºan con los privilegios de quien consulta, asÃ­ que
-- una funciÃ³n llamada desde un `using (...)` necesita que ese rol tenga EXECUTE.
-- Eso es lo que bloqueaba la 2 antes: con `anon` teniendo permiso de tabla en
-- las 19 tablas, llegaba a evaluar polÃ­ticas, y ahÃ­ `es_lider()` y compaÃ±Ã­a
-- necesitan su EXECUTE. Revocarlo tiraba la app entera con "permission denied
-- for function".
--
-- Con la 1, `anon` ya no alcanza ninguna tabla. Postgres revisa el permiso de
-- tabla ANTES que las polÃ­ticas, asi que nunca llega a evaluarlas y nunca
-- llama a un ayudante. Ahi la 2 es inocua.
--
-- Ojo con el orden de las dos cosas dentro de la misma transaccion: si se
-- revocara el EXECUTE sin haber sacado los permisos de tabla, `anon` podria
-- seguir tocando las otras 12 tablas y ahi si reventaria con error. Por eso van
-- en un solo `begin`/`commit`.
--
-- LAS 19 TABLAS, NO LAS 7
-- -----------------------
-- `cerrar-lectura-anon.sql` cerro el SELECT de 7. Este archivo va mas alla por
-- dos razones:
--   Â· Motivo de seguridad: `anon` tambien tenia INSERT, UPDATE y DELETE sobre
--     todo el schema, y eso solo lo frenaba RLS. RLS es una capa; el permiso es
--     la otra. Con las dos capas, un `alter table ... disable row level security`
--     accidental no abre la puerta.
--   Â· Es lo que habilita la parte 2 con seguridad.
--
-- LO QUE NO SE ROMPE
-- ------------------
-- Â· La pantalla de login: `intento_login` y `email_por_usuario` siguen con
--   `anon` porque son SECURITY DEFINER y cor como el dueno de la tabla. No
--   dependen de ningun permiso de tabla. Este archivo no las toca.
-- Â· El registro por invitacion: el token lo valida el trigger `validar_registro`
--   sobre `auth.users`, no una consulta del navegador.
-- Â· La app: todos los providers que leen tablas (Catalog, Presencia) arrancan
--   recien cuando hay perfil, y todas las rutas con datos detras de RequireAuth.
--   El unico camino que consulta tablas sin sesion es la cola offline con
--   pendientes si el usuario cierra sesion sin sincronizar, y eso ya fallaba
--   antes de este archivo (RLS le devolvia cero filas); ahora falla con un
--   error, que es mas honesto y deja los items en la cola en vez de darlos por
--   subidos.
-- Â· Storage: `storage.objects` vive en el esquema `storage`, no en `public`, asi
--   que la barrida de tablas no lo toca. Los buckets siguen andando.
--
-- LAS ALERTAS QUE QUEDAN
-- -----------------------
-- Se van 6 de las 21 (las de `anon` sobre los ayudantes). Quedan 15, y 15 es
-- el piso correcto:
--   Â· 6 ayudantes para `authenticated`: necesarias. Las politicas se evaluan
--     con los privilegios del rol que consulta, y TODAS las consultas de la
--     app son con sesion.
--   Â· `intento_login` y `email_por_usuario` para `anon`: es la pantalla de login.
--   Â· `ver_conciliacion_compartida` para `anon`: la UNICA apertura posterior al
--     login, y es deliberada. Es el enlace publico de conciliacion
--     (`/compartir/:token`); no da permiso de tabla, es SECURITY DEFINER y su
--     autorizacion es el token, no el rol. Ver `compartir-evaluacion.sql`.
--   Â· `desbloquear_usuario` y `registrar_sync` para `authenticated`: la app las
--     llama con sesion.
--   Â· 4 triggers para `authenticated`: margen de seguridad (ver
--     `permisos-funcion.sql`).
--   Â· 1 de leaked password protection: es un toggle del dashboard.
--
-- Las 6 de los ayudantes para `authenticated` se pueden sacar un dia moviendo
-- los 6 a un esquema que no este expuesto. Es un cambio mas grande, con su
-- propio archivo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Ninguna tabla de `public` queda accesible para `anon`
-- ----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- Y para las que se creen en el futuro: sin esto, una tabla nueva bornaria con
-- el `grant all` por defecto de Supabase y habria que acordarse de cerrarla a
-- mano. Es el error que produjo las 7 fugas que acabamos de cerrar.
alter default privileges in schema public revoke all on tables from anon;

-- ----------------------------------------------------------------------------
-- 2) Los 6 ayudantes de politica: fuera `anon`, dentro `authenticated`
-- ----------------------------------------------------------------------------
-- Se revoca de PUBLIC y de `anon` por el motivo aditivo de siempre (ver
-- `permisos-funcion.sql`), y despues se devuelve solo lo que corresponde.
-- `authenticated` los necesita porque TODAS las consultas de la app pasan por
-- ahi, y las politicas los invocan.
revoke execute on function public.es_lider() from public, anon;
grant  execute on function public.es_lider() to authenticated;

revoke execute on function public.puede_ver_evaluacion(public.evaluaciones) from public, anon;
grant  execute on function public.puede_ver_evaluacion(public.evaluaciones) to authenticated;

revoke execute on function public.puede_responder(uuid, uuid) from public, anon;
grant  execute on function public.puede_responder(uuid, uuid) to authenticated;

revoke execute on function public.puede_manejar_instancia(uuid, uuid) from public, anon;
grant  execute on function public.puede_manejar_instancia(uuid, uuid) to authenticated;

revoke execute on function public.puede_reportar_incidencia(uuid, uuid) from public, anon;
grant  execute on function public.puede_reportar_incidencia(uuid, uuid) to authenticated;

revoke execute on function public.puede_ver_incidencia(uuid) from public, anon;
grant  execute on function public.puede_ver_incidencia(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) `upsert_respuestas`: se le habia olvidado a todo el mundo
-- ----------------------------------------------------------------------------
-- Esta NO es security definer, asi que el advisor de Supabase no la marca: los
-- avisos que arma son solo de funciones security definer. Pero `anon` si la
-- puede ejecutar, porque el proyecto de Supabase deja un
-- 'grant all on all functions in schema public' inicial que nadie le revoco:
-- `permisos-funcion.sql` recorre las security definer y esta se le quedo
-- afuera. Por eso es la razon por la que la cuenta de arriba da 3 y no 2.
--
-- Que sea invoker la hace menos grave que a los ayudantes: corre con los
-- privilegios de quien llama, asi que sin permiso de tabla (parte 1) no puede
-- escribir nada. Es defensa en profundidad, no una fuga abierta.
--
-- La app la llama por RPC desde `subirRespuestas` en src/lib/offline/sync.ts,
-- siempre con sesion.
revoke execute on function public.upsert_respuestas(jsonb) from public, anon;
grant  execute on function public.upsert_respuestas(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- Verificacion
-- ----------------------------------------------------------------------------
-- 1) Las tablas. TODAS tienen que dar anon_select = false.
--    sesion_select tiene que dar true en todas: si alguna da false, el
--    catalogo o el historial no cargan y hay que revertir este archivo.
select
  c.relname as tabla,
  has_table_privilege('anon', c.oid, 'select')          as anon_select,
  has_table_privilege('authenticated', c.oid, 'select')  as sesion_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

-- 2) Las funciones. Esta tabla es la que hay que leer contra las 21 alertas:
--    Â· los 6 ayudantes tienen que dar anon_puede = false, sesion_puede = true
--    Â· intento_login, email_por_usuario y ver_conciliacion_compartida al reves: anon_puede = true
--    Â· cualquier otro anon_puede = true que aparezca aca es una alerta que
--      falta cerrar
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute')         as anon_puede,
  has_function_privilege('authenticated', p.oid, 'execute') as sesion_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- 3) El resumen. LAS TABLAS TIENEN QUE DAR 0.
--
--    En funciones NO da 0, y no es un error: da 3, que son `intento_login`,
--    `email_por_usuario` y `ver_conciliacion_compartida` (el enlace publico de
--    conciliacion). Las dos primeras son la pantalla de login, que corre sin
--    sesion por definicion; la tercera es la unica apertura deliberada
--    posterior al login y su autorizacion es el token, no el rol. Lo que no
--    puede aparecer es ninguna otra.
select
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and has_table_privilege('anon', c.oid, 'select'))      as tablas_que_anon_abre,
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('intento_login', 'email_por_usuario'))  as funciones_que_anon_abre_sin_el_login;

-- Si la de funciones da 0, lo unico que queda abierto a anon son las dos del
-- login. Es el piso correcto.
select
  p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_puede
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;
-- ============================================================================
commit;

-- ###########################################################################
-- Archivo consolidado: permisos-funcion.sql
-- ###########################################################################
-- ============================================================================
-- PERMISOS DE LAS FUNCIONES (alertas de seguridad de Supabase)
--
-- POR QUE HACE FALTA UNA SEGUNDA RONDA
-- --------------------------------------
-- La primera vez se revoco `from public` y no cambio nada: las alertas de `anon`
-- siguieron igual. La razon es que los permisos en Postgres son ADITIVOS y los
-- proyectos de Supabase traen un `grant all on all functions in schema public`
-- que deja un permiso EXPLICITO para `anon`. Quitar el de PUBLIC no alcanza si
-- el rol tiene el suyo:
--
--   revoke ... from public  ->  quita el de PUBLIC, anon conserva el suyo
--   revoke ... from anon    ->  quita el de anon, PUBLIC sigue sirviendo
--
-- Por eso ahora cada revoke quita PUBLIC y el rol, y despues se vuelve a dar
-- solo lo que corresponde. Ver la nota tecnica al final del archivo.
--
-- LO QUE NO SE TOCA Y POR QUE
-- ----------------------------
-- es_lider, puede_ver_evaluacion, puede_responder, puede_manejar_instancia,
-- puede_reportar_incidencia, puede_ver_incidencia:
--   Los invocan las politicas RLS (`using (public.es_lider())`), y las politicas
--   se evaluan con los privilegios de quien consulta, asi que necesitan que
--   `authenticated` tenga EXECUTE: TODAS las consultas de la app van con sesion.
--   Eso no se puede tocar.
--   Para `anon` SI se pueden quitar, pero solo despues de quitarle a `anon` el
--   permiso de tabla: con permiso de tabla llega a evaluar politicas y ahi los
--   helpers le son indispensables, y revocar el EXECUTE sin el permiso primero
--   rompia la app con "permission denied for function". Ese orden esta en
--   `cerrar-permisos-anon.sql`, que hace las dos cosas en una transaccion.
--   El cliente nunca los llama por RPC (solo existen dentro de las politicas),
--   asi que el paso que de verdad las cerraria del todo es mudarlas a un esquema
--   no expuesto; es un cambio mas grande, con su propio archivo. Sin sesion
--   devuelven false igual, porque preguntan por auth.uid().
--
-- intento_login y email_por_usuario:
--   La pantalla de login corre antes de autenticar: necesitan `anon`. De
--   `authenticated` no lo necesitan (ver abajo).
--
-- LAS DE TRIGGER
-- --------------
-- valider_registro, handle_new_user, validar_modulo_compartido y
-- validar_unico_evaluador_modulo son `returns trigger`: Postgres ya impide
-- llamarlas por RPC ("trigger functions can only be called as triggers"), asi
-- que la alerta es puro ruido. Se les quita el acceso a `anon` y se les DEJA el
-- de `authenticated` a proposito: son security definer, asi que el trigger corre
-- como dueno y no lo necesita, pero no se juega a que Postgres no vuelva a
-- verificar el permiso al disparar. Si alguna vez hiciera falta, el grant de
-- abajo lo restaura en una linea.
--
-- Es idempotente: se puede correr las veces que haga falta.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) search_path inmutable
-- ----------------------------------------------------------------------------
-- Con el search_path modificable, un esquema anterior en el camino de busqueda
-- podria resolver una tabla homonima y hacer que la funcion lea otra.
alter function public.validar_suma_puntaje_items() set search_path = public;

-- ----------------------------------------------------------------------------
-- 2) Trigger functions: `anon` no tiene por que llamarlas
-- ----------------------------------------------------------------------------
revoke execute on function public.validar_registro() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.validar_modulo_compartido() from public, anon;
revoke execute on function public.validar_unico_evaluador_modulo() from public, anon;

-- Excepcion a proposito: esta NO es security definer, asi que el trigger corre
-- como el rol que escribe (el Lider) y si necesita el permiso. Sin el grant,
-- cualquier edicion de un item falla con "permission denied for function".
revoke execute on function public.validar_suma_puntaje_items() from public, anon;
grant  execute on function public.validar_suma_puntaje_items() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Solo para quien tiene sesion
-- ----------------------------------------------------------------------------
-- Los cuerpos ya se autoprotegen: `desbloquear_usuario` exige que auth.uid() sea
-- un Lider activo (sin sesion aborta con excepcion) y `registrar_sync` escribe
-- en `where id = auth.uid()`, que para anon es NULL y no actualiza nada. Esto
-- solo evita que un anon sin sesion pueda siquiera invocarlas.
revoke execute on function public.desbloquear_usuario(uuid, text) from public, anon;
grant  execute on function public.desbloquear_usuario(uuid, text) to authenticated;

revoke execute on function public.registrar_sync() from public, anon;
grant  execute on function public.registrar_sync() to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Login: `anon` si, `authenticated` no
-- ----------------------------------------------------------------------------
-- En src/context/AuthContext.tsx, `intentoLogin` y `emailPorUsuario` se llaman
-- dentro de signIn() ANTES de supabase.auth.signInWithPassword: en ese momento
-- todavia no hay sesion, asi que la peticion va con el rol `anon`. Nunca se
-- llaman con un usuario ya autenticado, asi que el permiso para `authenticated`
-- sobra.
revoke execute on function public.intento_login(text, text) from public, authenticated;
grant  execute on function public.intento_login(text, text) to anon;

revoke execute on function public.email_por_usuario(text) from public, authenticated;
grant  execute on function public.email_por_usuario(text) to anon;

-- ----------------------------------------------------------------------------
-- 5) La que este archivo recorre por falta de aviso: `upsert_respuestas`
-- ----------------------------------------------------------------------------
-- Todo lo de arriba son security definer, que es lo unico que el advisor de
-- Supabase marca. `upsert_respuestas` es security INVOKER, asi que no genera
-- ninguna alerta y a este archivo (que recorre las del advisor) se le escapaba:
-- `anon` podia ejecutarla con el 'grant all on all functions in schema public'
-- inicial de Supabase.
--
-- Invoker la hace poco grave: corre con los privilegios de quien llama, asi que
-- sin permiso de tabla sobre `respuestas` no escribe nada. Pero es defensa en
-- profundidad. La app la llama por RPC desde src/lib/offline/sync.ts:145, siempre
-- con sesion.
revoke execute on function public.upsert_respuestas(jsonb) from public, anon;
grant  execute on function public.upsert_respuestas(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) Enlace publico de conciliacion: `anon` SI, a proposito
-- ----------------------------------------------------------------------------
-- Es la UNICA apertura a `anon` despues del login, y es deliberada. Existe una
-- pantalla publica (`/compartir/:token`) que muestra la conciliacion de UNA
-- evaluacion a quien no tiene cuenta: el coordinador de inventario que quiere
-- ver el proceso sin que le den acceso a la app.
--
-- Lo que la hace segura no es el permiso de tabla (no tiene ninguno: el revoke
-- general de `cerrar-permisos-anon.sql` se la deja quitada) sino que es
-- SECURITY DEFINER con `search_path` fijo y devuelve exactamente una
-- evaluacion, y sólo si el token coincide con un enlace activo. Sin token
-- valido devuelve `evaluacion: null`, que es indistinguible de "no existe",
-- asi que no se pueden enumerar enlaces probando tokens.
--
-- Tambien va para `authenticated` porque el enlace lo puede abrir alguien que
-- YA tiene sesion (un lider mirando su propio link con la app abierta): sin
-- ese grant, con la sesion puesta el enlace daba "permission denied".
--
-- La app la llama por RPC desde src/lib/data/compartir.ts, SIN sesion.
revoke execute on function public.ver_conciliacion_compartida(text) from public, anon;
grant  execute on function public.ver_conciliacion_compartida(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) Utilerias que se corren a mano desde el SQL Editor
-- ----------------------------------------------------------------------------
-- `mergear_conciliacion` es el helper con el que `upsert_respuestas` fusiona el
-- valor de una conciliacion en vez de pisarlo (union por SKU de las dos listas).
-- Corre como el que sube, asi que `authenticated` si la necesita.
revoke execute on function public.mergear_conciliacion(jsonb, jsonb, text) from public, anon;
grant  execute on function public.mergear_conciliacion(jsonb, jsonb, text) to authenticated;

-- Las dos del backfill de departamentos no las llama la app: el mapa se arma a
-- mano (los scripts que lo generaban se eliminaron del repo). Sin EXECUTE para nadie.
revoke execute on function public.previsualizar_departamentos(jsonb) from public, anon, authenticated;
revoke execute on function public.aplicar_departamentos(jsonb) from public, anon, authenticated;

-- Y la de la pre-entrega/inspeccion: es security definer, pero la invocan las
-- politicas RLS, que corren con sesion. Para anon no aporta nada y sobra.
revoke execute on function public.puede_usar_revision_pre_entrega() from public, anon;
grant  execute on function public.puede_usar_revision_pre_entrega() to authenticated;

-- ----------------------------------------------------------------------------
-- Verificacion
-- ----------------------------------------------------------------------------
-- Correr `diagnostico-permisos.sql` despues de esto: la columna `estado` deberia
-- salir en `ok` para todas. Si alguna sigue en otro valor, el permiso viene de
-- otro lado (mirar p.proacl en ese archivo).
--
-- Lo que queda marcado a proposito, y no se va a corregir:
--   Â· los 6 ayudantes de politica para `authenticated`: las politicas RLS los
--     necesitan. Para `anon` ya no, y eso lo cierra `cerrar-permisos-anon.sql`.
--   Â· `intento_login`/`email_por_usuario` con `anon`: es la pantalla de login.
--     Son las dos unicas funciones que deben quedar ejecutables por anon.
--   Â· `authenticated` en las de trigger: `returns trigger` ya las hace
--     inalcanzables por RPC y se deja como margen de seguridad.
-- ============================================================================
commit;

-- ###########################################################################
-- Archivo consolidado: reactivar-politicas.sql
-- ###########################################################################
-- ============================================================================
-- REACTIVAR LAS REGLAS (RLS) Y LAS POLITICAS
--
-- PARA QUE SIRVE
-- -------------
-- Si las reglas de la base quedaron desactivadas (por ejemplo con el boton de
-- RLS del dashboard), la app no da ningun error raro: simplemente no guarda, o
-- peor, deja ver y escribir tablas que deberian estar cerradas. Este archivo
-- vuelve a encender RLS en todas las tablas y repone las 54 politicas tal como
-- estan definidas en este mismo archivo, que desde ahora es el unico.
--
-- NO TOCA: ninguna tabla, ninguna columna, ningun dato. Solo RLS y politicas.
-- Por eso corre limpio sobre una base que ya tiene todo aplicado.
--
-- COMO CORRERLO
-- -------------
--   1. Pegar el archivo entero en el SQL Editor de Supabase y dale Run.
--   2. Tiene que salir sin errores (esta en una transaccion: o entra todo o nada).
--   3. Despues correr 'validar-politicas.sql', que es solo lectura, y mandarme
--      el resultado. Alli se ve, fila por fila, si quedo algo sin regla.
--
-- ES IDEMPOTENTE
-- --------------
-- Cada politica va con su 'drop policy if exists' antes, asi que se puede correr
-- las veces que haga falta sin acumular duplicados ni fallar.
--
-- De donde sale el texto: las politicas estan copiadas de los archivos del repo,
-- y un test (politicas-sql.test.ts) falla si alguna queda sin copiar. Para
-- cambiar una politica se cambia en su archivo de origen, no aca.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) RLS encendido en todas las tablas de public
-- ----------------------------------------------------------------------------
-- Con RLS apagado la tabla queda abierta para anon y para cualquiera con sesion.
-- Esto va primero y sin lista: si maÃ±ana se agrega una tabla y se olvida
-- actualizar el archivo, queda cerrada igual (fallo visible) en vez de abierta
-- sin que nadie se entere (fallo invisible).
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2) Las 54 politicas
-- ----------------------------------------------------------------------------

-- public.asignaciones (2 polÃ­ticas)
alter table public.asignaciones enable row level security;
drop policy if exists "asignaciones_select" on public.asignaciones;
create policy asignaciones_select on public.asignaciones for select using (auth.uid() = evaluador_id or public.es_lider());
drop policy if exists "asignaciones_lider" on public.asignaciones;
create policy asignaciones_lider on public.asignaciones for all using (public.es_lider()) with check (public.es_lider());

-- public.asignaciones_modulos (2 polÃ­ticas)
alter table public.asignaciones_modulos enable row level security;
drop policy if exists "asignaciones_modulos_select" on public.asignaciones_modulos;
create policy asignaciones_modulos_select on public.asignaciones_modulos for select using (auth.uid() = evaluador_id or public.es_lider());
drop policy if exists "asignaciones_modulos_lider" on public.asignaciones_modulos;
create policy asignaciones_modulos_lider on public.asignaciones_modulos for all using (public.es_lider()) with check (public.es_lider());

-- public.evaluaciones (4 polÃ­ticas)
alter table public.evaluaciones enable row level security;
drop policy if exists "evaluaciones_select" on public.evaluaciones;
create policy evaluaciones_select on public.evaluaciones for select using (public.puede_ver_evaluacion(evaluaciones));
drop policy if exists "evaluaciones_insert" on public.evaluaciones;
create policy evaluaciones_insert on public.evaluaciones for insert with check (public.es_lider());
drop policy if exists "evaluaciones_update" on public.evaluaciones;
create policy evaluaciones_update on public.evaluaciones for update using (public.es_lider()) with check (public.es_lider());
drop policy if exists "evaluaciones_delete" on public.evaluaciones;
create policy evaluaciones_delete on public.evaluaciones for delete using (public.es_lider());

-- public.fotos (2 polÃ­ticas)
alter table public.fotos enable row level security;
drop policy if exists "fotos_select" on public.fotos;
create policy fotos_select on public.fotos for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);
drop policy if exists "fotos_insert" on public.fotos;
create policy fotos_insert on public.fotos for insert with check (public.puede_responder(evaluacion_id, item_id));

-- public.incidencias (3 polÃ­ticas)
alter table public.incidencias enable row level security;
drop policy if exists "incidencias_select" on public.incidencias;
create policy incidencias_select on public.incidencias
  for select using (public.puede_ver_incidencia(evaluacion_id));
drop policy if exists "incidencias_insert" on public.incidencias;
create policy incidencias_insert on public.incidencias
  for insert with check (
    auth.uid() = evaluador_id
    and public.puede_reportar_incidencia(evaluacion_id, modulo_id)
  );
drop policy if exists "incidencias_update" on public.incidencias;
create policy incidencias_update on public.incidencias
  for update using (auth.uid() = evaluador_id) with check (auth.uid() = evaluador_id);

-- public.instancias_grupo (4 polÃ­ticas)
alter table public.instancias_grupo enable row level security;
drop policy if exists "instancias_grupo_select" on public.instancias_grupo;
create policy instancias_grupo_select on public.instancias_grupo for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);
drop policy if exists "instancias_grupo_insert" on public.instancias_grupo;
create policy instancias_grupo_insert on public.instancias_grupo for insert with check (
  public.puede_manejar_instancia(evaluacion_id, item_id)
);
drop policy if exists "instancias_grupo_update" on public.instancias_grupo;
create policy instancias_grupo_update on public.instancias_grupo for update
  using (public.puede_manejar_instancia(evaluacion_id, item_id))
  with check (public.puede_manejar_instancia(evaluacion_id, item_id));
drop policy if exists "instancias_grupo_delete" on public.instancias_grupo;
create policy instancias_grupo_delete on public.instancias_grupo for delete using (
  public.puede_manejar_instancia(evaluacion_id, item_id)
);

-- public.invitaciones (1 polÃ­tica)
alter table public.invitaciones enable row level security;
drop policy if exists "invitaciones_lider" on public.invitaciones;
create policy invitaciones_lider on public.invitaciones for all using (public.es_lider()) with check (public.es_lider());

-- public.items (2 polÃ­ticas)
alter table public.items enable row level security;
drop policy if exists "items_select" on public.items;
create policy items_select on public.items for select to authenticated using (true);
drop policy if exists "items_lider" on public.items;
create policy items_lider on public.items for all using (public.es_lider()) with check (public.es_lider());

-- public.marcajes (2 polÃ­ticas)
alter table public.marcajes enable row level security;
drop policy if exists "marcajes_select" on public.marcajes;
create policy marcajes_select on public.marcajes
  for select using (true);
drop policy if exists "marcajes_lider" on public.marcajes;
create policy marcajes_lider on public.marcajes
  for all using (public.es_lider()) with check (public.es_lider());

-- public.modulos (2 polÃ­ticas)
alter table public.modulos enable row level security;
drop policy if exists "modulos_select" on public.modulos;
create policy modulos_select on public.modulos for select to authenticated using (true);
drop policy if exists "modulos_lider" on public.modulos;
create policy modulos_lider on public.modulos for all using (public.es_lider()) with check (public.es_lider());

-- public.profiles (2 polÃ­ticas)
alter table public.profiles enable row level security;
drop policy if exists "profiles_select" on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_lider" on public.profiles;
create policy profiles_lider on public.profiles for all using (public.es_lider()) with check (public.es_lider());

-- public.proyectos (2 polÃ­ticas)
alter table public.proyectos enable row level security;
drop policy if exists "proyectos_select" on public.proyectos;
create policy proyectos_select on public.proyectos
  for select using (true);
drop policy if exists "proyectos_lider" on public.proyectos;
create policy proyectos_lider on public.proyectos
  for all using (public.es_lider()) with check (public.es_lider());

-- public.respuestas (3 polÃ­ticas)
alter table public.respuestas enable row level security;
drop policy if exists "respuestas_select" on public.respuestas;
create policy respuestas_select on public.respuestas for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);
drop policy if exists "respuestas_insert" on public.respuestas;
create policy respuestas_insert on public.respuestas for insert with check (
  public.puede_responder(evaluacion_id, item_id)
  and (respondido_por = auth.uid() or public.es_lider())
);
drop policy if exists "respuestas_update" on public.respuestas;
create policy respuestas_update on public.respuestas for update
  using (public.puede_responder(evaluacion_id, item_id))
  with check (public.puede_responder(evaluacion_id, item_id)
    and (respondido_por = auth.uid() or public.es_lider()));

-- public.sucursal_items (2 polÃ­ticas)
alter table public.sucursal_items enable row level security;
drop policy if exists "sucursal_items_select" on public.sucursal_items;
create policy sucursal_items_select on public.sucursal_items for select to authenticated using (true);
drop policy if exists "sucursal_items_lider" on public.sucursal_items;
create policy sucursal_items_lider on public.sucursal_items for all using (public.es_lider()) with check (public.es_lider());

-- public.sucursal_modulos (2 polÃ­ticas)
alter table public.sucursal_modulos enable row level security;
drop policy if exists "sucursal_modulos_select" on public.sucursal_modulos;
create policy sucursal_modulos_select on public.sucursal_modulos for select to authenticated using (true);
drop policy if exists "sucursal_modulos_lider" on public.sucursal_modulos;
create policy sucursal_modulos_lider on public.sucursal_modulos for all using (public.es_lider()) with check (public.es_lider());

-- public.sucursal_opciones (2 polÃ­ticas)
alter table public.sucursal_opciones enable row level security;
drop policy if exists "sucursal_opciones_select" on public.sucursal_opciones;
create policy sucursal_opciones_select on public.sucursal_opciones for select to authenticated using (true);
drop policy if exists "sucursal_opciones_lider" on public.sucursal_opciones;
create policy sucursal_opciones_lider on public.sucursal_opciones for all using (public.es_lider()) with check (public.es_lider());

-- public.departamento_modulos / _items / _opciones (2 politicas cada una)
alter table public.departamento_modulos enable row level security;
drop policy if exists "departamento_modulos_select" on public.departamento_modulos;
create policy departamento_modulos_select on public.departamento_modulos for select to authenticated using (true);
drop policy if exists "departamento_modulos_lider" on public.departamento_modulos;
create policy departamento_modulos_lider on public.departamento_modulos for all using (public.es_lider()) with check (public.es_lider());
alter table public.departamento_items enable row level security;
drop policy if exists "departamento_items_select" on public.departamento_items;
create policy departamento_items_select on public.departamento_items for select to authenticated using (true);
drop policy if exists "departamento_items_lider" on public.departamento_items;
create policy departamento_items_lider on public.departamento_items for all using (public.es_lider()) with check (public.es_lider());
alter table public.departamento_opciones enable row level security;
drop policy if exists "departamento_opciones_select" on public.departamento_opciones;
create policy departamento_opciones_select on public.departamento_opciones for select to authenticated using (true);
drop policy if exists "departamento_opciones_lider" on public.departamento_opciones;
create policy departamento_opciones_lider on public.departamento_opciones for all using (public.es_lider()) with check (public.es_lider());

-- public.sucursales (2 polÃ­ticas)
alter table public.sucursales enable row level security;
drop policy if exists "sucursales_select" on public.sucursales;
create policy sucursales_select on public.sucursales for select to authenticated using (true);
drop policy if exists "sucursales_lider" on public.sucursales;
create policy sucursales_lider on public.sucursales for all using (public.es_lider()) with check (public.es_lider());

-- public.departamentos_centralizados (2 politicas)
alter table public.departamentos_centralizados enable row level security;
drop policy if exists "departamentos_centralizados_select" on public.departamentos_centralizados;
create policy departamentos_centralizados_select on public.departamentos_centralizados for select to authenticated using (true);
drop policy if exists "departamentos_centralizados_lider" on public.departamentos_centralizados;
create policy departamentos_centralizados_lider on public.departamentos_centralizados for all using (public.es_lider()) with check (public.es_lider());

-- storage.objects (11 políticas: 7 acá y 4 de la pre-entrega)
-- (storage.objects ya tiene RLS; solo se reponen sus polÃ­ticas)
drop policy if exists "evidencias_select" on storage.objects;
create policy "evidencias_select" on storage.objects for select to authenticated using (bucket_id = 'evidencias');
drop policy if exists "evidencias_insert" on storage.objects;
create policy "evidencias_insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'evidencias'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo and p.rol in ('EVALUADOR','LIDER'))
);
-- Marcar fotos de evidencia (re-graba el mismo path): misma regla que arriba.
drop policy if exists "evidencias_update" on storage.objects;
create policy "evidencias_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'evidencias'
    and name like 'ev/%'
    and exists (
      select 1 from public.evaluaciones e
      where e.id::text = split_part(storage.objects.name, '/', 2)
        and public.puede_ver_evaluacion(e)
    )
  )
  with check (
    bucket_id = 'evidencias'
    and name like 'ev/%'
    and exists (
      select 1 from public.evaluaciones e
      where e.id::text = split_part(storage.objects.name, '/', 2)
        and public.puede_ver_evaluacion(e)
    )
  );
drop policy if exists "storage_incidencias_insert" on storage.objects;
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
drop policy if exists "storage_incidencias_update" on storage.objects;
create policy storage_incidencias_update on storage.objects
  for update to authenticated
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
  )
  with check (
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
drop policy if exists "storage_incidencias_select" on storage.objects;
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
drop policy if exists "storage_incidencias_delete" on storage.objects;
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

-- ----------------------------------------------------------------------------
-- 3) Permisos de ejecucion de las funciones
-- ----------------------------------------------------------------------------
-- En Postgres los permisos son ADITIVOS. Por eso no alcanza con revocar de
-- PUBLIC: el proyecto de Supabase deja un permiso propio de 'anon' (trae un
-- 'grant all on all functions in schema public' inicial), y quitar el de PUBLIC
-- deja el de anon intacto. Cada revoke quita PUBLIC y el rol, y despues se vuelve
-- a dar solo lo que corresponde.

-- Trigger functions. Son 'returns trigger', asi que por RPC no se pueden
-- llamar igual; se les saca el acceso de anon para que no figuren como
-- exposures. Se les DEJA el de authenticated a proposito: son security definer
-- (el trigger corre como dueno) y no se juega a que Postgres no vuelva a
-- verificar el permiso al disparar.
revoke execute on function public.validar_registro() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.validar_modulo_compartido() from public, anon;
revoke execute on function public.validar_unico_evaluador_modulo() from public, anon;

-- Excepcion: esta NO es security definer, asi que el trigger corre como el rol
-- que escribe (el Lider) y si necesita el permiso. Sin el grant, editar un
-- item falla con 'permission denied for function'.
revoke execute on function public.validar_suma_puntaje_items() from public, anon;
grant  execute on function public.validar_suma_puntaje_items() to authenticated;

-- Solo para quien tiene sesion. Los cuerpos ya se autoprotegen:
-- 'desbloquear_usuario' exige que auth.uid() sea un Lider activo y
-- 'registrar_sync' escribe en 'where id = auth.uid()'.
revoke execute on function public.desbloquear_usuario(uuid, text) from public, anon;
grant  execute on function public.desbloquear_usuario(uuid, text) to authenticated;

revoke execute on function public.registrar_sync() from public, anon;
grant  execute on function public.registrar_sync() to authenticated;

-- La pantalla de login corre SIN sesion: necesita anon y no necesita
-- authenticated (ver src/context/AuthContext.tsx, se llaman antes de
-- signInWithPassword).
revoke execute on function public.intento_login(text, text) from public, authenticated;
grant  execute on function public.intento_login(text, text) to anon;

revoke execute on function public.email_por_usuario(text) from public, authenticated;
grant  execute on function public.email_por_usuario(text) to anon;

-- ----------------------------------------------------------------------------
-- 3b) Las 7 tablas que se leian sin sesion, cerradas a `anon`
-- ----------------------------------------------------------------------------
-- `profiles` (correos, roles), `items` (la rubrica completa con puntajes y
-- umbrales), `modulos`, `sucursales` (nombres, branch_id, gerente_id) y las tres
-- de configuracion por sucursal. Con la politica de lectura a `authenticated` y
-- estos revoke, quien no inicio sesion no puede leer ninguna: la politica por el
-- lado RLS, el revoke por el lado del permiso (que es aditivo y por si solo
-- habria bastado para saltarse la politica).
--
-- Las dos funciones del login siguen funcionando: son security definer, asi que
-- corren como dueno y no les aplica ni la politica ni el revoke.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'sucursales', 'modulos', 'items',
    'sucursal_modulos', 'sucursal_items', 'sucursal_opciones'
  ] loop
    execute format('revoke select on public.%I from anon', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3c) Ni tablas ni ayudantes para `anon`
-- ----------------------------------------------------------------------------
-- Estas dos cosas van juntas. La segunda depende de la primera: las politicas RLS
-- se evaluan con los privilegios de quien consulta, asi que una funcion llamada
-- desde un `using (...)` necesita EXECUTE de ese rol. Con `anon` teniendo
-- permiso de tabla, llegaba a evaluar politicas y `es_lider()` le era
-- indispensable; quitarle el EXECUTE ahi rompia la app con "permission denied
-- for function".
--
-- Sin permiso de tabla, Postgres revisa el permiso ANTES que las politicas, asi
-- que `anon` ya no llega a evaluarlas y nunca las llama. Por eso los ayudantes
-- le sobran a `anon` y no a `authenticated`: TODAS las consultas de la app van
-- con sesion, y ahi las politicas los necesitan.
--
-- El revoke de tablas va mas alla de las 7 de la seccion 3b: `anon` tambien
-- tenia INSERT, UPDATE y DELETE sobre todo el schema, y eso solo lo frenaba
-- RLS. Con las dos capas, un `disable row level security` accidental no abre.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

revoke execute on function public.es_lider() from public, anon;
grant  execute on function public.es_lider() to authenticated;

revoke execute on function public.puede_ver_evaluacion(public.evaluaciones) from public, anon;
grant  execute on function public.puede_ver_evaluacion(public.evaluaciones) to authenticated;

revoke execute on function public.puede_responder(uuid, uuid) from public, anon;
grant  execute on function public.puede_responder(uuid, uuid) to authenticated;

revoke execute on function public.puede_manejar_instancia(uuid, uuid) from public, anon;
grant  execute on function public.puede_manejar_instancia(uuid, uuid) to authenticated;

revoke execute on function public.puede_reportar_incidencia(uuid, uuid) from public, anon;
grant  execute on function public.puede_reportar_incidencia(uuid, uuid) to authenticated;

revoke execute on function public.puede_ver_incidencia(uuid) from public, anon;
grant  execute on function public.puede_ver_incidencia(uuid) to authenticated;

-- Invoker, asi que el advisor de Supabase no la marca (sus avisos son solo de
-- security definer) y a `permisos-funcion.sql` se le quedo afuera. Corre con los
-- privilegios de quien llama, asi que sin permiso de tabla no escribe nada.
-- La app la llama por RPC desde src/lib/offline/sync.ts, siempre con sesion.
revoke execute on function public.upsert_respuestas(jsonb) from public, anon;
grant  execute on function public.upsert_respuestas(jsonb) to authenticated;

-- `intento_login` y `email_por_usuario` NO entran aqui: son security definer, no
-- dependen de ningun permiso de tabla, y la pantalla de login corre sin sesion.
-- ============================================================================
commit;


-- ###########################################################################
-- Archivo consolidado: crear-lider.sql
-- ###########################################################################
-- ============================================================================
-- CREAR EL PRIMER USUARIO LIDER (mÃ©todo CORRECTO)
--
-- NO se inserta manualmente en auth.users (eso corrompe el login, 500).
-- En su lugar se crea una INVITACIÃ“N ACTIVA y el usuario se registra por
-- goTrue (igual que cualquier invitado), lo que le da perfil LIDER.
--
-- ANTES DE EJECUTAR: cambia EMAIL, USUARIO y luego registra la contraseÃ±a
-- desde el enlace generado (o el register en la app).
-- ============================================================================

-- 0) Limpiar cualquier usuario LIDER manual corrupto (borra cascade identity+profile) ----
-- OJO: este delete es sólo para el bootstrap inicial (auth.users insertado a mano,
-- que rompe el login con 500). Si se ejecuta con un LIDER ya creado por registro,
-- lo borra a él y a su perfil en cascada. Por eso ahora sólo borra cuando el
-- usuario NO tiene un perfil LIDER activo: re-ejecutar schema.sql ya no puede
-- eliminar un líder que funciona.
delete from auth.users u
where lower(u.email) = 'lider@evaluxor.com'
  and not exists (
    select 1
    from public.profiles p
    where p.id = u.id
      and p.rol = 'LIDER'
      and p.activo
  );

-- 1) InvitaciÃ³n activa para el futuro LIDER -----------------------------
-- Si ya existe una invitaciÃ³n no usada, la reactivamos; si no, la creamos.
update public.invitaciones
set usado = false
where lower(email) = 'lider@evaluxor.com'
  and rol = 'LIDER';

insert into public.invitaciones (email, usuario, rol, sucursal_id, token, created_by)
select 'lider@evaluxor.com', 'lider', 'LIDER', null, 'bootstrap-lider', null
where not exists (select 1 from public.profiles where rol = 'LIDER')
  and not exists (select 1 from public.invitaciones where lower(email) = 'lider@evaluxor.com' and usado = false)
on conflict (token) do nothing
returning id, email, usuario, rol, token;

-- 2) Obtener el enlace de registro (cambia el dominio por el tuyo) -------
-- Abre en el navegador:
--   https://TU_DOMINIO/registro?token=bootstrap-lider&email=lider@evaluxor.com&usuario=lider
-- o desde local:
--   http://localhost:5173/registro?token=bootstrap-lider&email=lider@evaluxor.com&usuario=lider
-- AhÃ­ defines la contraseÃ±a. La cuenta se crea con rol LIDER.

-- VerificaciÃ³n posterior: debe mostrar el LIDER con su usuario
-- select id, usuario, email, rol, activo from public.profiles where rol = 'LIDER';

-- ###########################################################################
-- Archivo consolidado: diagnostico-guardado.sql
-- ###########################################################################
-- DiagnÃ³stico: por quÃ© el servidor rechaza el guardado de un evaluador
-- =====================================================================
-- La app antes mostraba "No se pudo sincronizar, revisÃ¡ tu conexiÃ³n" para
-- CUALQUIER error. Casi nunca era la conexiÃ³n: era el servidor rechazando el
-- guardado por las polÃ­ticas de RLS. Esta consulta lista las causas
-- concretas, para no adivinar.
--
-- CÃ³mo usarlo:
--   1. Reemplazar 'USUARIO' por el usuario, nombre o correo del telÃ©fono afectado.
--   2. Correr en el SQL Editor de Supabase.
--   3. Si no devuelve filas, no hay bloqueos por polÃ­tica: el problema es otro
--      (red, caÃ­da del servidor, o falta aplicar parte del schema.sql) y la
--      app ahora muestra el detalle tÃ©cnico en pantalla.
--
-- La regla que aplica el servidor (funciÃ³n puede_responder) exige, para un
-- EVALUADOR, las cuatro cosas a la vez:
--   1. que la evaluaciÃ³n estÃ© en estado ACTIVA;
--   2. que el Ã­tem estÃ© activo;
--   3. que el mÃ³dulo estÃ© asignado al evaluador con asignaciones_modulos.activa;
--   4. que el mÃ³dulo estÃ© habilitado para esa sucursal (sucursal_modulos.activa).
--
-- Los registros de secciÃ³n repetible (`instancias_grupo`) los governs
-- puede_manejar_instancia, que pide lo mismo SALVO el punto 2: un Ã­tem
-- desactivado no impide guardar sus registros, solo sus respuestas. Por eso la
-- columna `bloquea` dice a quÃ© tabla aplica cada problema, para no ir a buscar
-- al lugar equivocado.
--
-- Las cuatro aparecen abajo. `sucursal_items` NO aparece porque no bloquea el
-- guardado: RLS no lo consulta (sÃ­ afecta quÃ© Ã­tems se muestran en la app).
-- ============================================================================

with objetivo as (
  select p.id, p.nombre, p.usuario
  from public.profiles p
  where p.usuario ilike '%USUARIO%'
     or p.nombre ilike '%USUARIO%'
     or p.email ilike '%USUARIO%'
  limit 1
),

-- 1. Evaluaciones que le impedirÃ­an guardar: no ACTIVA (CERRADA, PROGRAMADA...).
evaluaciones_bloqueadas as (
  select distinct ev.id, ev.sucursal_id, s.nombre as sucursal, ev.fecha, ev.estado
  from public.evaluaciones ev
  join public.sucursales s on s.id = ev.sucursal_id
  join public.asignaciones_modulos am on am.evaluador_id = (select id from objetivo)
  where ev.estado <> 'ACTIVA'
    and exists (
      select 1
      from public.sucursal_modulos sm
      where sm.sucursal_id = ev.sucursal_id and sm.modulo_id = am.modulo_id and sm.activa
    )
)

-- 1.
select 'EVALUACION NO ACTIVA' as problema,
       'bloquea respuestas e instancias_grupo Â· estado = ' || ev.estado as detalle,
       ev.sucursal || ' Â· ' || to_char(ev.fecha, 'DD/MM/YYYY') as donde
from evaluaciones_bloqueadas ev

union all

-- 2.
select 'ASIGNACION DADA DE BAJA',
       'bloquea respuestas e instancias_grupo Â· el mÃ³dulo "' || m.nombre || '" ya no le estÃ¡ asignado (activa = false)',
       coalesce(o.nombre, o.usuario)
from public.asignaciones_modulos am
join public.modulos m on m.id = am.modulo_id
join objetivo o on o.id = am.evaluador_id
where not am.activa

union all

-- 3. El Ã­tem se llama `texto` en la tabla items (no tiene columna `nombre`).
select 'ITEM DESACTIVADO',
       'bloquea SOLO respuestas (las instancias sÃ­ se guardan) Â· ' || m.nombre || ' â†’ ' || left(i.texto, 60) || ' (items.activo = false)',
       coalesce(o.nombre, o.usuario)
from public.items i
join public.modulos m on m.id = i.modulo_id
join public.asignaciones_modulos am on am.modulo_id = m.id and am.activa
join objetivo o on o.id = am.evaluador_id
where not i.activo

union all

-- 4. El mÃ³dulo no estÃ¡ habilitado en una sucursal que SÃ tiene otros mÃ³dulos
--    activos: el `exists` de puede_responder no lo encuentra y bloquea.
select 'MODULO NO APLICA A LA SUCURSAL',
       'bloquea respuestas e instancias_grupo Â· ' || m.nombre || ' â†’ ' || b.sucursal || ' (tiene ' || b.bloqueadas || ' mÃ³dulo/s activo/s, no este)',
       coalesce(o.nombre, o.usuario)
from public.asignaciones_modulos am
join public.modulos m on m.id = am.modulo_id
join objetivo o on o.id = am.evaluador_id
join lateral (
  select s.nombre as sucursal, count(*)::int as bloqueadas
  from public.sucursales s
  where exists (
          select 1 from public.sucursal_modulos sm
          where sm.sucursal_id = s.id and sm.activa
        )
    and not exists (
          select 1 from public.sucursal_modulos sm
          where sm.sucursal_id = s.id and sm.modulo_id = m.id and sm.activa
        )
  group by s.nombre
) b on true
where am.activa

order by 1, 2;


-- ###########################################################################
-- Archivo consolidado: diagnostico-permisos.sql
-- ###########################################################################
-- ============================================================================
-- DIAGNOSTICO DE PERMISOS DE LAS FUNCIONES (solo lectura)
--
-- Por que existe: el linter de Supabase dice "cualquiera puede ejecutar esta
-- funcion por /rest/v1/rpc/<nombre>". Eso es cierto, pero no dice SI DEBE.
-- Este archivo muestra quien puede en realidad y por que.
--
-- Correlo cuando quieras: no modifica nada.
-- ============================================================================

-- Ejecuta este bloque y mandame el resultado si algo no cuadra con lo esperado.
select
  p.proname                                        as funcion,
  p.prosecdef                                      as security_definer,
  coalesce(p.proconfig::text, '(sin search_path)')  as search_path,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado_puede,
  -- CASE buscado: cada rama es una condición, no un valor contra `proname`.
  case
    -- Se invocan desde las politicas RLS (`using (public.es_lider())`). Revocar
    -- EXECUTE no es endurecimiento: rompe toda la base con "permission denied".
    when p.proname in ('es_lider','puede_ver_evaluacion','puede_responder',
             'puede_manejar_instancia','puede_reportar_incidencia',
             'puede_ver_incidencia')
      then 'ayudante de politica RLS -> NO revocar'
    -- Pantalla de login: corre antes de autenticar, necesita anon.
    when p.proname in ('intento_login','email_por_usuario')
      then 'login sin sesion -> anon OK, authenticated innecesario'
    -- Solo un usuario con sesion (y para desbloquear, ademas un Lider).
    when p.proname in ('desbloquear_usuario','registrar_sync')
      then 'solo authenticated'
    -- Trigger: `returns trigger` ya impide llamarla por RPC.
    else 'trigger -> sin uso por RPC'
  end                                              as por_que,
  case
    when p.proname = 'validar_suma_puntaje_items'
      and not (coalesce(p.proconfig::text, '') like '%search_path%')
      then 'FALTA search_path'
    when p.proname in ('desbloquear_usuario','registrar_sync')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'anon todavia puede llamarla'
    when p.proname in ('validar_registro','handle_new_user',
                       'validar_modulo_compartido','validar_unico_evaluador_modulo')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'anon todavia puede llamarla'
    when p.proname in ('intento_login','email_por_usuario')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      then 'authenticated no hace falta'
    else 'ok'
  end                                              as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'validar_suma_puntaje_items','validar_registro','handle_new_user',
    'validar_modulo_compartido','validar_unico_evaluador_modulo',
    'desbloquear_usuario','registrar_sync','es_lider','puede_ver_evaluacion',
    'puede_responder','puede_manejar_instancia','puede_reportar_incidencia',
    'puede_ver_incidencia','intento_login','email_por_usuario'
  )
order by (p.proname in ('es_lider','puede_ver_evaluacion','puede_responder',
                        'puede_manejar_instancia','puede_reportar_incidencia',
                        'puede_ver_incidencia')), p.proname;

-- ----------------------------------------------------------------------------
-- Por que `revoke ... from anon` NO alcanza (el error del primer intento)
-- ----------------------------------------------------------------------------
-- Postgres da EXECUTE al rol PUBLIC en cada funcion nueva, y ademas los
-- proyectos de Supabase traen un `grant all on all functions in schema public`
-- inicial que deja un permiso EXPLICITO para anon y authenticated.
--
-- Los permisos son ADITIVOS. Por eso:
--   revoke ... from public   ->  quita el de PUBLIC, pero anon conserva el suyo
--   revoke ... from anon     ->  quita el de anon, pero PUBLIC sigue sirviendo
-- Hay que quitar AMBOS (y volver a dar solo lo que corresponda).
--
-- Comprobacion rapida del ACL crudo de una funcion:
--
-- select p.proname, p.proacl
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'registrar_sync';
--
-- While p.proacl -> hay permiso heredado de PUBLIC.
-- X,X=.../postgres  -> hay permiso explicito para algun rol.

-- ###########################################################################
-- Archivo consolidado: validar-politicas.sql
-- ###########################################################################
-- ============================================================================
-- VALIDAR LAS REGLAS (solo lectura: este archivo no modifica nada)
--
-- Para que sirve: correr 'reactivar-politicas.sql' y despues este, para
-- comprobar tabla por tabla que quedo todo cerrado como debe ser.
--
-- Son cuatro consultas independientes. Se pueden correr de a una o todas juntas;
-- cada una se lee sola. Lo que hay que mirar es la columna 'estado': tiene que
-- decir 'ok'. Cualquier otra cosa es un problema y esta escrito por que.
--
--   1) RLS encendido en cada tabla y con al menos una politica.
--   2) Las 64 politicas del repo, una por fila, marcando las que falten.
--   3) Que los helpers de RLS conserven EXECUTE para authenticated.
--   4) Que las funciones con datos no hayan quedado abiertas a anon.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) RLS encendido en todas las tablas
-- ----------------------------------------------------------------------------
-- Con RLS apagado la tabla esta abierta para anon y para cualquiera con sesion:
-- eso no da error, simplemente deja ver y escribir lo que deberia estar cerrado.
-- Con RLS encendido y cero politicas pasa lo contrario: tampoco da error, pero
-- no devuelve nada. Son dos fallos distintos y por eso dos columnas.
select
  n.nspname || '.' || c.relname as tabla,
  case when c.relrowsecurity then 'ok' else 'FALTA RLS' end as rls,
  (select count(*)::int
   from pg_policies pp
   where pp.schemaname = n.nspname and pp.tablename = c.relname) as politicas,
  case
    when not c.relrowsecurity
      then 'abierta para todos: correr reactivar-politicas.sql'
    when not exists (select 1 from pg_policies pp
                    where pp.schemaname = n.nspname and pp.tablename = c.relname)
      then 'RLS ok pero sin politicas: no devuelve nada, falta reponerlas'
    else 'ok'
  end as que_pasa
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relrowsecurity, n.nspname || '.' || c.relname;

-- Si TODAS las filas dicen 'ok' en las tres primeras columnas, esta parte esta bien.


-- ----------------------------------------------------------------------------
-- 2) Las politicas del repo, una por fila
-- ----------------------------------------------------------------------------
-- Si esta consulta NO devuelve filas, estan las 64. Cada fila que aparezca es
-- una politica que falta: se creo la tabla pero no su regla, y queda abierta o
-- inaccesible segun el caso.
with esperadas (politica, tabla) as (
  values
    ('asignaciones_lider', 'public.asignaciones'),
    ('asignaciones_select', 'public.asignaciones'),
    ('asignaciones_modulos_lider', 'public.asignaciones_modulos'),
    ('asignaciones_modulos_select', 'public.asignaciones_modulos'),
    ('evaluaciones_compartidas_lider', 'public.evaluaciones_compartidas'),
    ('evaluaciones_compartidas_select', 'public.evaluaciones_compartidas'),
    ('evaluaciones_delete', 'public.evaluaciones'),
    ('evaluaciones_insert', 'public.evaluaciones'),
    ('evaluaciones_select', 'public.evaluaciones'),
    ('evaluaciones_update', 'public.evaluaciones'),
    ('fotos_insert', 'public.fotos'),
    ('fotos_select', 'public.fotos'),
    ('incidencias_insert', 'public.incidencias'),
    ('incidencias_select', 'public.incidencias'),
    ('incidencias_update', 'public.incidencias'),
    ('instancias_grupo_delete', 'public.instancias_grupo'),
    ('instancias_grupo_insert', 'public.instancias_grupo'),
    ('instancias_grupo_select', 'public.instancias_grupo'),
    ('instancias_grupo_update', 'public.instancias_grupo'),
    ('invitaciones_lider', 'public.invitaciones'),
    ('items_lider', 'public.items'),
    ('items_select', 'public.items'),
    ('marcajes_lider', 'public.marcajes'),
    ('marcajes_select', 'public.marcajes'),
    ('modulos_lider', 'public.modulos'),
    ('modulos_select', 'public.modulos'),
    ('profiles_lider', 'public.profiles'),
    ('profiles_select', 'public.profiles'),
    ('proyectos_lider', 'public.proyectos'),
    ('proyectos_select', 'public.proyectos'),
    ('respuestas_insert', 'public.respuestas'),
    ('respuestas_select', 'public.respuestas'),
    ('respuestas_update', 'public.respuestas'),
    ('sucursal_items_lider', 'public.sucursal_items'),
    ('sucursal_items_select', 'public.sucursal_items'),
    ('sucursal_modulos_lider', 'public.sucursal_modulos'),
    ('sucursal_modulos_select', 'public.sucursal_modulos'),
    ('sucursal_opciones_lider', 'public.sucursal_opciones'),
    ('sucursal_opciones_select', 'public.sucursal_opciones'),
    ('sucursales_lider', 'public.sucursales'),
    ('sucursales_select', 'public.sucursales'),
    ('evidencias_insert', 'storage.objects'),
    ('evidencias_select', 'storage.objects'),
    ('evidencias_update', 'storage.objects'),
    ('storage_incidencias_delete', 'storage.objects'),
    ('storage_incidencias_insert', 'storage.objects'),
    ('storage_incidencias_select', 'storage.objects'),
    ('storage_incidencias_update', 'storage.objects'),
    ('departamentos_centralizados_lider', 'public.departamentos_centralizados'),
    ('departamentos_centralizados_select', 'public.departamentos_centralizados'),
    ('departamento_items_lider', 'public.departamento_items'),
    ('departamento_items_select', 'public.departamento_items'),
    ('departamento_modulos_lider', 'public.departamento_modulos'),
    ('departamento_modulos_select', 'public.departamento_modulos'),
    ('departamento_opciones_lider', 'public.departamento_opciones'),
    ('departamento_opciones_select', 'public.departamento_opciones'),
    ('revision_pre_entrega_delete', 'public.revision_pre_entrega'),
    ('revision_pre_entrega_insert', 'public.revision_pre_entrega'),
    ('revision_pre_entrega_select', 'public.revision_pre_entrega'),
    ('revision_pre_entrega_update', 'public.revision_pre_entrega'),
    ('storage_pre_entrega_delete', 'storage.objects'),
    ('storage_pre_entrega_insert', 'storage.objects'),
    ('storage_pre_entrega_select', 'storage.objects'),
    ('storage_pre_entrega_update', 'storage.objects')
)
select
  e.tabla,
  e.politica,
  'FALTA' as estado,
  case
    when e.tabla like 'storage.%' then 'fotos e incidencias: sin esta politica la foto no se sube ni se ve'
    else 'sin esta politica la tabla no se puede usar como la espera la app'
  end as por_que_importa
from esperadas e
where not exists (
  select 1
  from pg_policies pp
  where pp.schemaname || '.' || pp.tablename = e.tabla
    and pp.policyname = e.politica
)
order by e.tabla, e.politica;


-- ----------------------------------------------------------------------------
-- 3) Los helpers de RLS siguen siendo ejecutables por authenticated
-- ----------------------------------------------------------------------------
-- Si a estos se les saca EXECUTE, el error no dice 'no tenes permiso': dice
-- 'permission denied for function' en cada select, insert y update, y parece que
-- se rompiÃ³ la app entera. Ojo: los permisos en Postgres son aditivos, asi que
-- revocar de PUBLIC no los saca si el rol tiene un permiso propio.
select
  p.proname as funcion,
  case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
       then 'ok'
       else 'SIN EXECUTE: la app no va a poder leer ni guardar nada'
  end as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'es_lider', 'puede_ver_evaluacion', 'puede_responder',
    'puede_manejar_instancia', 'puede_reportar_incidencia', 'puede_ver_incidencia'
  )
order by p.proname;


-- ----------------------------------------------------------------------------
-- 4) Funciones con datos que NO pueden quedar abiertas a anon
-- ----------------------------------------------------------------------------
-- 'intento_login' y 'email_por_usuario' si van abiertas: son la pantalla de
-- login, que corre antes de autenticar, y por ahi no se puede evitar.
-- 'ver_conciliacion_compartida' tambien, y es la tercera y ultima: es el
-- enlace publico de conciliacion (`/compartir/:token`). Es SECURITY DEFINER,
-- con search_path fijo y con el token como unica autorizacion; ver
-- `compartir-evaluacion.sql`.
-- Las demas deberian dar 'ok' (cerradas para anon).
select
  p.proname as funcion,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
  case
    when p.proname in ('intento_login', 'email_por_usuario', 'ver_conciliacion_compartida')
      then 'permitido sin sesion'
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'ABIERTA A ANON: correr reactivar-politicas.sql'
    else 'ok'
  end as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'validar_suma_puntaje_items', 'validar_registro', 'handle_new_user',
    'validar_modulo_compartido', 'validar_unico_evaluador_modulo',
    'desbloquear_usuario', 'registrar_sync',
    'intento_login', 'email_por_usuario', 'ver_conciliacion_compartida',
    'mergear_conciliacion', 'puede_usar_revision_pre_entrega',
    'previsualizar_departamentos', 'aplicar_departamentos'
  )
order by p.proname;
