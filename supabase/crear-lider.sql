-- ============================================================================
-- CREAR EL PRIMER USUARIO LIDER (método CORRECTO)
--
-- NO se inserta manualmente en auth.users (eso corrompe el login, 500).
-- En su lugar se crea una INVITACIÓN ACTIVA y el usuario se registra por
-- goTrue (igual que cualquier invitado), lo que le da perfil LIDER.
--
-- ANTES DE EJECUTAR: cambia EMAIL, USUARIO y luego registra la contraseña
-- desde el enlace generado (o el register en la app).
-- ============================================================================

-- 0) Limpiar cualquier usuario LIDER manual corrupto (borra cascade identity+profile) ----
delete from auth.users where lower(email) = 'lider@evaluxor.com';

-- 1) Invitación activa para el futuro LIDER -----------------------------
-- Si ya existe una invitación no usada, la reactivamos; si no, la creamos.
update public.invitaciones
set usado = false
where lower(email) = 'lider@evaluxor.com'
  and rol = 'LIDER';

insert into public.invitaciones (email, usuario, rol, sucursal_id, token, created_by)
select 'lider@evaluxor.com', 'lider', 'LIDER', null, 'bootstrap-lider', null
where not exists (select 1 from public.profiles where rol = 'LIDER')
  and not exists (select 1 from public.invitaciones where lower(email) = 'lider@evaluxor.com' and usado = false)
on conflict (token) do nothing
returning id, email, usuario, rol, token;

-- 2) Obtener el enlace de registro (cambia el dominio por el tuyo) -------
-- Abre en el navegador:
--   https://TU_DOMINIO/registro?token=bootstrap-lider&email=lider@evaluxor.com&usuario=lider
-- o desde local:
--   http://localhost:5173/registro?token=bootstrap-lider&email=lider@evaluxor.com&usuario=lider
-- Ahí defines la contraseña. La cuenta se crea con rol LIDER.

-- Verificación posterior: debe mostrar el LIDER con su usuario
-- select id, usuario, email, rol, activo from public.profiles where rol = 'LIDER';