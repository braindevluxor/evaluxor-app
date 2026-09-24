-- EvaLuxor - Realtime de respuestas
-- Permite que el LIDER vea en vivo lo que cada evaluador va registrando
-- (el detalle de la evaluación se actualiza solo). Idempotente.
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'respuestas'
  ) then
    alter publication supabase_realtime add table public.respuestas;
  end if;
end $$;