-- ============================================================================
-- Parche: la CONCILIACION tambien conserva sus fotos de evidencia
-- ============================================================================
--
-- Problema: en produccion `upsert_respuestas` fusiona dos escrituras de la misma
-- conciliacion con `mergear_conciliacion`, y esa funcion arrancaba desde el valor
-- entrante (`coalesce(entrante, '{}'::jsonb)`). Si el que subia no traia las
-- fotos (otro telefono, o una re-sincronizacion), la evidencia que ya estaba en
-- la nube se pisaba: el merge de conciliacion era el unico tipo al que NO se le
-- aplicaba `fusionar_fotos`.
--
-- La evidencia de la conciliacion no es general: esta casada a cada producto
-- escaneado (`productos[i].paths`, el sku es la llave del merge). Arreglo
-- (misma filosofia que para el resto de tipos: las fotos solo se agregan, nunca
-- se borran):
--   * base del valor = `previo || entrante`: lo que sube manda por clave y lo que
--     solo estaba en la nube se conserva (responsables, informativo, ...).
--   * por cada sku, `paths` final = union de las de la nube con las que suben,
--     sin repetir.
--   * `photoIds` (ids locales de un telefono) se descartan: no son rutas del
--     bucket y guardarlos a medias deja ids huerfanos en el valor.
--   * `productos` sigue fusionandose por sku y `responsablesGerente` sigue
--     prefiriendo el previo, tal cual como hasta ahora. En esa fusion por sku
--     tambien se conserva ahora `apiId`, el "id" del producto en la API
--     ("id": 100006130): `jsonb_build_object` solo deja pasar los campos que
--     listan, asi que sin agregarlo el merge lo tiraba y la fila quedaba sin el
--     ID con el que se cruza el producto contra el sistema. Igual con
--     `escaneadoPor` (quien midio el producto primero), sin el cual la lista deja
--     de poder avisar que el producto ya lo conto otra persona.
--
-- Como correrlo: pegar tal cual en el SQL Editor de Supabase y ejecutar. Es
-- idempotente (create or replace), se puede correr mas de una vez: si ya se
-- corrio una version anterior de este parche, hay que volver a correrlo para
-- que tome el `apiId`.
--
-- Firmas y privilegios intactos: `upsert_respuestas` es security invoker y la
-- llama con los permisos de quien sube, asi que se le devuelve el execute a
-- `authenticated` y se revoca de PUBLIC/anon.
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
  viejos as (
    select value as p, value->>'sku' as sku
    from jsonb_array_elements(previo->'productos') value
    where previo ? 'productos'
      and value->>'sku' is not null and value->>'sku' <> ''
  ),
  nuevos as (
    select value as p, value->>'sku' as sku
    from jsonb_array_elements(entrante->'productos') value
    where entrante ? 'productos'
      and value->>'sku' is not null and value->>'sku' <> ''
  ),
  unidos as (
    select p, sku, 'n' as o from nuevos
    union all
    select p, sku, 'v' from viejos
  ),
  -- Evidencia por producto: la union de las `paths` de la nube con las que suben,
  -- casada al sku. Solo strings (un valor viejo con algo raro se ignora).
  fotos_por_sku as (
    select u.sku,
           coalesce(jsonb_agg(distinct t.e order by t.e), '[]'::jsonb) as arr
    from unidos u
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(u.p -> 'paths') = 'array' then u.p -> 'paths' else '[]'::jsonb end
    ) as t(e) on true
    where t.e is null or jsonb_typeof(t.e) = 'string'
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
      -- El id del producto en la API ("id": 100006130). Sin esta linea lo mismo
      -- pasa con jsonb_build_object: solo deja pasar los campos de abajo, asi
      -- que el merge tiraba el ID y la fila quedaba para siempre sin el dato con
      -- el que se cruza contra el sistema. Solo digitos: cualquier otra cosa se
      -- guarda como null y no como un string disfrazado.
      'apiId', case when a.api_id ~ '^[0-9]+$' then a.api_id::bigint else null end,
      -- Quien midio el producto primero (nombre del evaluador). Sin esta linea el
      -- merge lo tiraba y la lista dejaba de poder avisar que el producto ya lo
      -- conto otra persona.
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
      -- Evidencia del producto: unida por sku y sin photoIds (jsonb_build_object
      -- solo toma los campos de abajo, asi que cualquier id local se cae solo).
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
      then jsonb_set(con_gerente.v, '{paths}', (select arr from paths_union), true)
    else con_gerente.v
  end
  from con_gerente;
$$;

-- Privilegios como los del resto de helpers internos de `upsert_respuestas`.
revoke execute on function public.mergear_conciliacion(jsonb, jsonb, text) from public, anon;
grant  execute on function public.mergear_conciliacion(jsonb, jsonb, text) to authenticated;

-- ============================================================================
-- Verificacion (opcional): correr despues del parche.
-- ============================================================================
-- Las fotos estan casadas al producto: se prueban dentro de `productos`.
--
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1,"paths":["ev/e/i/f1.jpg"]}]}'::jsonb,
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1,"informativo":false}]}'::jsonb,
--   'SOH'
-- );
-- Esperado: el producto A conserva paths = ["ev/e/i/f1.jpg"] (la foto de la nube
-- no desaparece aunque el que subio no traiga ninguna).
--
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A","paths":["ev/e/i/f1.jpg"]},{"sku":"B"}]}'::jsonb,
--   '{"productos":[{"sku":"A","paths":["ev/e/i/f2.jpg","ev/e/i/f1.jpg"]},{"sku":"B","paths":["ev/e/i/b.jpg"]}]}'::jsonb
-- );
-- Esperado: A con ["ev/e/i/f1.jpg","ev/e/i/f2.jpg"] (union, sin repetir) y B con
-- ["ev/e/i/b.jpg"].
--
-- select public.mergear_conciliacion(
--   null,
--   '{"productos":[{"sku":"A","photoIds":["local-1"],"paths":["ev/e/i/f2.jpg"]}]}'::jsonb
-- );
-- Esperado: el producto queda con paths = ["ev/e/i/f2.jpg"] y sin photoIds.
--
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A","nombre":"Pan","apiId":100006130,"escaneadoPor":"Maria"}]}'::jsonb,
--   '{"productos":[{"sku":"A","teorica":2,"fisica":2}]}'::jsonb,
--   'SOH'
-- );
-- Esperado: el producto A conserva apiId = 100006130 (numero, no texto) y
-- escaneadoPor = "Maria".
