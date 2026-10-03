-- ============================================================================
-- REACTIVAR LAS REGLAS (RLS) Y LAS POLITICAS
--
-- PARA QUE SIRVE
-- -------------
-- Si las reglas de la base quedaron desactivadas (por ejemplo con el boton de
-- RLS del dashboard), la app no da ningun error raro: simplemente no guarda, o
-- peor, deja ver y escribir tablas que deberian estar cerradas. Este archivo
-- vuelve a encender RLS en todas las tablas y repone las 45 politicas tal como
-- estan definidas en schema.sql, incidencias.sql y proyectos-biometrico.sql.
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
-- Esto va primero y sin lista: si mañana se agrega una tabla y se olvida
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
-- 2) Las 45 politicas
-- ----------------------------------------------------------------------------

-- public.asignaciones (2 políticas)
alter table public.asignaciones enable row level security;
drop policy if exists "asignaciones_select" on public.asignaciones;
create policy asignaciones_select on public.asignaciones for select using (auth.uid() = evaluador_id or public.es_lider());
drop policy if exists "asignaciones_lider" on public.asignaciones;
create policy asignaciones_lider on public.asignaciones for all using (public.es_lider()) with check (public.es_lider());

-- public.asignaciones_modulos (2 políticas)
alter table public.asignaciones_modulos enable row level security;
drop policy if exists "asignaciones_modulos_select" on public.asignaciones_modulos;
create policy asignaciones_modulos_select on public.asignaciones_modulos for select using (auth.uid() = evaluador_id or public.es_lider());
drop policy if exists "asignaciones_modulos_lider" on public.asignaciones_modulos;
create policy asignaciones_modulos_lider on public.asignaciones_modulos for all using (public.es_lider()) with check (public.es_lider());

-- public.evaluaciones (4 políticas)
alter table public.evaluaciones enable row level security;
drop policy if exists "evaluaciones_select" on public.evaluaciones;
create policy evaluaciones_select on public.evaluaciones for select using (public.puede_ver_evaluacion(evaluaciones));
drop policy if exists "evaluaciones_insert" on public.evaluaciones;
create policy evaluaciones_insert on public.evaluaciones for insert with check (public.es_lider());
drop policy if exists "evaluaciones_update" on public.evaluaciones;
create policy evaluaciones_update on public.evaluaciones for update using (public.es_lider()) with check (public.es_lider());
drop policy if exists "evaluaciones_delete" on public.evaluaciones;
create policy evaluaciones_delete on public.evaluaciones for delete using (public.es_lider());

-- public.fotos (2 políticas)
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

-- public.incidencias (3 políticas)
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

-- public.instancias_grupo (4 políticas)
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

-- public.invitaciones (1 política)
alter table public.invitaciones enable row level security;
drop policy if exists "invitaciones_lider" on public.invitaciones;
create policy invitaciones_lider on public.invitaciones for all using (public.es_lider()) with check (public.es_lider());

-- public.items (2 políticas)
alter table public.items enable row level security;
drop policy if exists "items_select" on public.items;
create policy items_select on public.items for select to authenticated using (true);
drop policy if exists "items_lider" on public.items;
create policy items_lider on public.items for all using (public.es_lider()) with check (public.es_lider());

-- public.marcajes (2 políticas)
alter table public.marcajes enable row level security;
drop policy if exists "marcajes_select" on public.marcajes;
create policy marcajes_select on public.marcajes
  for select using (true);
drop policy if exists "marcajes_lider" on public.marcajes;
create policy marcajes_lider on public.marcajes
  for all using (public.es_lider()) with check (public.es_lider());

-- public.modulos (2 políticas)
alter table public.modulos enable row level security;
drop policy if exists "modulos_select" on public.modulos;
create policy modulos_select on public.modulos for select to authenticated using (true);
drop policy if exists "modulos_lider" on public.modulos;
create policy modulos_lider on public.modulos for all using (public.es_lider()) with check (public.es_lider());

-- public.profiles (2 políticas)
alter table public.profiles enable row level security;
drop policy if exists "profiles_select" on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_lider" on public.profiles;
create policy profiles_lider on public.profiles for all using (public.es_lider()) with check (public.es_lider());

-- public.proyectos (2 políticas)
alter table public.proyectos enable row level security;
drop policy if exists "proyectos_select" on public.proyectos;
create policy proyectos_select on public.proyectos
  for select using (true);
drop policy if exists "proyectos_lider" on public.proyectos;
create policy proyectos_lider on public.proyectos
  for all using (public.es_lider()) with check (public.es_lider());

-- public.respuestas (3 políticas)
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

-- public.sucursal_items (2 políticas)
alter table public.sucursal_items enable row level security;
drop policy if exists "sucursal_items_select" on public.sucursal_items;
create policy sucursal_items_select on public.sucursal_items for select to authenticated using (true);
drop policy if exists "sucursal_items_lider" on public.sucursal_items;
create policy sucursal_items_lider on public.sucursal_items for all using (public.es_lider()) with check (public.es_lider());

-- public.sucursal_modulos (2 políticas)
alter table public.sucursal_modulos enable row level security;
drop policy if exists "sucursal_modulos_select" on public.sucursal_modulos;
create policy sucursal_modulos_select on public.sucursal_modulos for select to authenticated using (true);
drop policy if exists "sucursal_modulos_lider" on public.sucursal_modulos;
create policy sucursal_modulos_lider on public.sucursal_modulos for all using (public.es_lider()) with check (public.es_lider());

-- public.sucursal_opciones (2 políticas)
alter table public.sucursal_opciones enable row level security;
drop policy if exists "sucursal_opciones_select" on public.sucursal_opciones;
create policy sucursal_opciones_select on public.sucursal_opciones for select to authenticated using (true);
drop policy if exists "sucursal_opciones_lider" on public.sucursal_opciones;
create policy sucursal_opciones_lider on public.sucursal_opciones for all using (public.es_lider()) with check (public.es_lider());

-- public.sucursales (2 políticas)
alter table public.sucursales enable row level security;
drop policy if exists "sucursales_select" on public.sucursales;
create policy sucursales_select on public.sucursales for select to authenticated using (true);
drop policy if exists "sucursales_lider" on public.sucursales;
create policy sucursales_lider on public.sucursales for all using (public.es_lider()) with check (public.es_lider());

-- storage.objects (6 políticas)
-- (storage.objects ya tiene RLS; solo se reponen sus políticas)
drop policy if exists "evidencias_select" on storage.objects;
create policy "evidencias_select" on storage.objects for select to authenticated using (bucket_id = 'evidencias');
drop policy if exists "evidencias_insert" on storage.objects;
create policy "evidencias_insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'evidencias'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo and p.rol in ('EVALUADOR','LIDER'))
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
    and exists (
      select 1
      from public.incidencias i
      where i.evaluador_id = auth.uid()
        and name like 'incidencias/' || i.id::text || '/%'
    )
  )
  with check (
    bucket_id = 'evidencias'
    and exists (
      select 1
      from public.incidencias i
      where i.evaluador_id = auth.uid()
        and name like 'incidencias/' || i.id::text || '/%'
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

-- A proposito NO se toca (revocarles EXECUTE ROMPE la app entera, con 'permission
-- denied for function' en cada select/insert/update):
--   es_lider, puede_ver_evaluacion, puede_responder, puede_manejar_instancia,
--   puede_reportar_incidencia, puede_ver_incidencia
-- Son las que invocan las politicas RLS. El cliente nunca las llama por RPC.
-- Sin sesion devuelven false igual, porque preguntan por auth.uid().
-- ============================================================================
commit;
