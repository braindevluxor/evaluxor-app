alter table public.items add column if not exists colaboradores_filtro text;
alter table public.items drop constraint if exists items_colaboradores_filtro_check;
alter table public.items add constraint items_colaboradores_filtro_check check (colaboradores_filtro in ('ACTIVOS','INACTIVOS','TODOS'));