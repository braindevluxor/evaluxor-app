-- ----------------------------------------------------------------------------
-- DEPARTAMENTO DE LOS PRODUCTOS QUE YA ESTABAN ESCANEADOS (backfill)
-- ----------------------------------------------------------------------------
-- `departamento` (el `department.name` de la API de precios) se empezó a guardar
-- después de que muchas conciliaciones ya estuvieran escaneadas, así que sus
-- productos quedaron sin el campo y salen todos juntos en el grupo "Sin
-- departamento".
--
-- Estas funciones lo rellenan a partir de un mapa {"<código de barras>": "<departamento>"}
-- sin tocar ningún otro dato de la respuesta. El mapa lo arma
-- `scripts/backfill-departamentos.mjs`, que consulta la API de precios una vez por
-- código de barras distinto. La consulta que exporta la lista está en
-- `scripts/exportar-productos-conciliados.sql`.
--
-- CÓMO SE USA
-- -----------
--   1. Corré este archivo una vez (crea las dos funciones).
--   2. Pegá el `departamentos.sql` que generó el script, empezando por el
--      preview, para ver a cuántos productos le va a poner departamento.
--   3. Después corré los `select public.aplicar_departamentos(...)`.
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
-- respuestas van a quedar tocados. El `departamentos.sql` que genera el script trae
-- una llamada a esta función por lote antes de la que aplica.
create or replace function public.previsualizar_departamentos(mapa jsonb)
returns table (
  codigo text,
  nombre text,
  evaluacion uuid,
  departamento_nuevo text
)
language sql
stable
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