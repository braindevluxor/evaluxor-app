-- ============================================================================
-- Parche: la CONCILIACION tambien conserva sus fotos de evidencia
-- ============================================================================
--
-- Problema: en produccion `upsert_respuestas` fusiona dos escrituras de la misma
-- conciliacion con `mergear_conciliacion`, y esa funcion arrancaba desde el valor
-- entrante (`coalesce(entrante, '{}'::jsonb)`). Si el que subia no traia `paths`
-- (otro telefono, o una re-sincronizacion), las fotos que ya estaban en la nube
-- se pisaban: el merge de conciliacion era el unico tipo al que NO se le aplicaba
-- `fusionar_fotos`. Las fotos en la conciliacion podian vaciarse.
--
-- Arreglo (misma filosofia que para el resto de tipos: las fotos solo se agregan,
-- nunca se borran):
--   * base del valor = `previo || entrante`: lo que sube manda por clave y lo que
--     solo estaba en la nube se conserva (fotos, responsables, informativo...).
--   * `paths` final = union de las de la nube con las que suben, sin repetir.
--   * `photoIds` (ids locales de un telefono) se descartan: no son rutas del
--     bucket y guardarlos a medias deja ids huerfanos en el valor.
--   * `productos` sigue fusionandose por sku y `responsablesGerente` sigue
--     prefiriendo el previo, tal cual como hasta ahora.
--
-- Como correrlo: pegar tal cual en el SQL Editor de Supabase y ejecutar. Es
-- idempotente (create or replace), se puede correr mas de una vez.
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
      'sku', sku,
      'nombre', nombre,
      'teorica', teorica::numeric,
      'fisica', fisica_efectiva,
      'soh', soh::numeric,
      'lastSync', lastSync,
      'finalBase', finalBase::numeric,
      'finalTax', finalTax::numeric,
      'departamento', departamento,
      'sinHablador', (sinHablador = 'true'),
      'perdidaEstimada',
        case
          when contra_dato = 'SOH'
           and teorica::numeric is not null
           and fisica_efectiva is not null
           and finalBase::numeric is not null
          then greatest(0::numeric, teorica::numeric - fisica_efectiva)
               * (finalBase::numeric + coalesce(finalTax::numeric, 0))
          else null
        end
    ) order by sku), '[]'::jsonb) as arr
    from ajustados
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
  -- Evidencia: union de las `paths` de la nube con las que suben, sin repetir y
  -- sin depender de otros helpers (si este archivo se corre suelto, funciona).
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
-- select public.mergear_conciliacion(
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1}],"paths":["ev/e/i/f1.jpg"]}'::jsonb,
--   '{"productos":[{"sku":"A","teorica":2,"fisica":1}],"informativo":false}'::jsonb,
--   'SOH'
-- );
-- Esperado: paths = ["ev/e/i/f1.jpg"] (la foto de la nube no desaparece).
--
-- select public.mergear_conciliacion(
--   null,
--   '{"productos":[],"photoIds":["local-1"],"paths":["ev/e/i/f2.jpg"]}'::jsonb
-- );
-- Esperado: paths = ["ev/e/i/f2.jpg"] y sin photoIds.
