-- ============================================================================
-- EvaLuxor - Migración: bloqueo de usuario tras 5 intentos fallidos de login
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar
-- Idempotente: puede re-ejecutarse sin errores.
-- Comportamiento:
--   * 5 contraseñas incorrectas => usuario queda BLOQUEADO (ya no puede
--     intentar iniciar sesión).
--   * Solo el Líder desbloquea vía public.desbloquear_usuario(), asignando
--     una contraseña provisional (6+ caracteres).
--   * El login correcto reinicia el contador.
-- ============================================================================

-- La validación de contraseñas usa crypt()/gen_salt() de pgcrypto.
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) Columnas de control en PROFILES
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists intentos_fallidos int not null default 0;
alter table public.profiles add column if not exists bloqueado boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2) EMAIL_POR_USUARIO ignora a los bloqueados (defensa en profundidad:
--    a un usuario bloqueado el login de frente no lo deja pasar).
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3) INTENTO_LOGIN: valida la contraseña (contra auth.users) y lleva el
--    conteo. Se invoca SIN sesión (pantalla de login). Por eso es
--    security definer y ejecutable por anon.
--    Respuesta JSON: { ok, bloqueado, restantes }
--    - ok=true ......... contraseña correcta (reinicia contador)
--    - ok=false ........ contraseña incorrecta (incrementa; bloquea al 5º)
--    - bloqueado=true .. el usuario ya está bloqueado
--    Usuarios inactivos o inexistentes devuelven ok=false/restantes=5
--    (respuesta genérica para no revelar la existencia del usuario).
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4) DESBLOQUEAR_USUARIO: solo el Líder activo. Limpia el contador/bloqueo y
--    asigna una contraseña provisional (que el usuario deberá cambiar luego).
-- ----------------------------------------------------------------------------
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