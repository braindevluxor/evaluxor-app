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
