-- Lista de productos conciliados que todavía NO tienen departamento.
--
-- Corrérsela en el Supabase SQL Editor y exportar el resultado como CSV a
-- `scripts/productos-conciliados.csv`. De ahí se alimenta
-- `scripts/backfill-departamentos.mjs`, que consulta la API de precios por cada
-- código de barras y arma el mapa.
--
-- Solo lectura: no modifica nada.
--
-- `shop_id` sale de la sucursal de la evaluación porque la API de precios lo pide
-- para resolver el catálogo. Un mismo código puede aparecer en varias sucursales;
-- el script consulta una vez por combinación código + tienda.
--
-- Ojo: si la sucursal no tiene `shop_id` cargado, `shop_id` sale vacío y el
-- código queda con `shop_id` en blanco en el CSV. NO se filtran esas filas a
-- propósito: el script las consulta con la tienda por defecto, porque el
-- departamento del producto es del catálogo y no de la tienda. Para ver cuántos
-- productos quedan así, la consulta devuelve el código con shop_id vacío y el
-- script avisa en pantalla.
--
-- El filtro `producto->>'sku' ~ '^[0-9]+$'` descarta lo que no sea un código de
-- barras: la API solo entiende números, y un `sku` escrito a mano no va a
-- devolver nada.
with productos as (
  select
    nullif(btrim(s.shop_id), '') as shop_id,
    btrim(prod->>'sku') as sku
  from public.respuestas r
  join public.evaluaciones e on e.id = r.evaluacion_id
  join public.sucursales s on s.id = e.sucursal_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(r.valor->'productos') = 'array' then r.valor->'productos'
      else '[]'::jsonb
    end
  ) as t(prod)
  where jsonb_typeof(r.valor->'productos') = 'array'
    and (prod->>'sku') ~ '^[0-9]+$'
)
select distinct shop_id, sku
from productos
order by sku nulls last, shop_id nulls last;
