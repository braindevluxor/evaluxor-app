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
