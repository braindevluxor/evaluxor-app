-- ============================================================================
-- Inspección de vehículo (herramienta)
--
-- Inspección de vehículo PARTICULAR: estética, mecánica y sistema de gas
-- vehicular (GNV), con fotos/incidencias por punto y salida a PDF.
--
-- NO TOCA EL ESQUEMA. Reaprovecha las dos piezas que ya existen para la
-- Revisión Pre-Entrega (`supabase/revision-pre-entrega.sql`):
--
--   * `modulos.herramienta`  → marca este módulo como herramienta, así no
--     aparece nunca en /evaluar ni puntúa en ninguna evaluación.
--   * `revision_pre_entrega` → guarda la inspección. Es la misma tabla porque
--     la ficha es la misma (placa, vehículo, persona, respuestas jsonb, firma,
--     estado, sync) y porque así las políticas de RLS y de storage que ya
--     existen siguen cubriéndola sin escritura nueva. Lo que distingue una
--     inspección de una pre-entrega es `modulo_id`, que apunta a este módulo.
--     Las fotos suben a la misma carpeta `pre-entrega/<registro_id>/`.
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

comment on column public.modulos.herramienta is
  'Identifica un módulo como herramienta externa (ej. REVISION_PRE_ENTREGA, INSPECCION_VEHICULO). NULL = módulo normal de evaluación.';
