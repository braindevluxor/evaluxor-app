-- EvaLuxor - Nuevo tipo de ítem: LISTA_COLABORADORES
-- Listado de colaboradores de la tienda (API talento humano) con un checklist
-- compartido por cada colaborador (por ejemplo: recaudos del expediente físico,
-- cumplimiento de indumentaria/uniforme).
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar.
-- Idempotente.

alter table public.items drop constraint if exists items_tipo_check;
alter table public.items add constraint items_tipo_check check (tipo in (
  'CHECKLIST','CUMPLE_NO_CUMPLE','CONCILIACION','LISTA_COLABORADORES'
));