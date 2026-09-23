-- Después de esta migración existe public.items.responsables jsonb default '[]'
-- (lista de responsables configurable por ítem; cada punto usa opciones[i].responsable).
alter table public.items add column if not exists responsables jsonb not null default '[]'::jsonb;