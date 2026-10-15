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