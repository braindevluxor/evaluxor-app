-- ============================================================================
-- Migración combinada:
--   1) El evaluador puede ver TODAS las respuestas/fotos de la evaluación en el
--      dashboard (no solo las suyas). La condición pasa a ser simplemente
--      "puede ver la evaluación" (puede_ver_evaluacion), que ya restringe por
--      rol, sucursal o módulos asignados.
--   2) Puntaje ponderado por ítem: cada ítem de un módulo puede tener puntos
--      asignados y la suma de puntos de los ítems de un mismo módulo no puede
--      superar 100.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) RLS: el evaluador ve todo el detalle de la evaluación
-- ----------------------------------------------------------------------------

drop policy if exists respuestas_select on public.respuestas;
create policy respuestas_select on public.respuestas for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);

drop policy if exists fotos_select on public.fotos;
create policy fotos_select on public.fotos for select using (
  exists (
    select 1 from public.evaluaciones e
    where e.id = evaluacion_id and public.puede_ver_evaluacion(e)
  )
);

-- ----------------------------------------------------------------------------
-- 2) Puntaje ponderado por ítem (máximo 100 por módulo)
-- ----------------------------------------------------------------------------

alter table public.items add column if not exists puntaje numeric not null default 0;
alter table public.items drop constraint if exists items_puntaje_check;
alter table public.items add constraint items_puntaje_check check (puntaje >= 0 and puntaje <= 100);

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