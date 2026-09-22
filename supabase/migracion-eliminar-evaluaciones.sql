-- ============================================================================
-- EvaLuxor - Migración: permitir ELIMINAR evaluaciones
-- Ejecutar en: Dashboard Supabase -> SQL Editor -> pegar y ejecutar
-- Idempotente: puede re-ejecutarse sin errores.
-- Quién puede eliminar: el LÍDER (cualquiera) o el propio evaluador (las suyas).
-- respuestas y fotos se eliminan en cascada; los archivos del bucket 'evidencias'
-- se borran desde la app.
-- ============================================================================

drop policy if exists evaluaciones_delete on public.evaluaciones;
create policy evaluaciones_delete on public.evaluaciones for delete using (
  exists (
    select 1 from public.profiles p
      where p.id = auth.uid() and p.activo
        and (p.rol = 'LIDER' or p.id = evaluador_id)
  )
);