-- ============================================================================
-- VALIDAR LAS REGLAS (solo lectura: este archivo no modifica nada)
--
-- Para que sirve: correr 'reactivar-politicas.sql' y despues este, para
-- comprobar tabla por tabla que quedo todo cerrado como debe ser.
--
-- Son cuatro consultas independientes. Se pueden correr de a una o todas juntas;
-- cada una se lee sola. Lo que hay que mirar es la columna 'estado': tiene que
-- decir 'ok'. Cualquier otra cosa es un problema y esta escrito por que.
--
--   1) RLS encendido en cada tabla y con al menos una politica.
--   2) Las 45 politicas del repo, una por fila, marcando las que falten.
--   3) Que los helpers de RLS conserven EXECUTE para authenticated.
--   4) Que las funciones con datos no hayan quedado abiertas a anon.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) RLS encendido en todas las tablas
-- ----------------------------------------------------------------------------
-- Con RLS apagado la tabla esta abierta para anon y para cualquiera con sesion:
-- eso no da error, simplemente deja ver y escribir lo que deberia estar cerrado.
-- Con RLS encendido y cero politicas pasa lo contrario: tampoco da error, pero
-- no devuelve nada. Son dos fallos distintos y por eso dos columnas.
select
  n.nspname || '.' || c.relname as tabla,
  case when c.relrowsecurity then 'ok' else 'FALTA RLS' end as rls,
  (select count(*)::int
   from pg_policies pp
   where pp.schemaname = n.nspname and pp.tablename = c.relname) as politicas,
  case
    when not c.relrowsecurity
      then 'abierta para todos: correr reactivar-politicas.sql'
    when not exists (select 1 from pg_policies pp
                    where pp.schemaname = n.nspname and pp.tablename = c.relname)
      then 'RLS ok pero sin politicas: no devuelve nada, falta reponerlas'
    else 'ok'
  end as que_pasa
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relrowsecurity, n.nspname || '.' || c.relname;

-- Si TODAS las filas dicen 'ok' en las tres primeras columnas, esta parte esta bien.


-- ----------------------------------------------------------------------------
-- 2) Las 45 politicas del repo, una por fila
-- ----------------------------------------------------------------------------
-- Si esta consulta NO devuelve filas, estan las 45. Cada fila que aparezca es una
-- politica que falta: se creo la tabla pero no su regla, y queda abierta o
-- inaccesible segun el caso.
with esperadas (politica, tabla) as (
  values
('asignaciones_lider', 'public.asignaciones'),
    ('asignaciones_select', 'public.asignaciones'),
    ('asignaciones_modulos_lider', 'public.asignaciones_modulos'),
    ('asignaciones_modulos_select', 'public.asignaciones_modulos'),
    ('evaluaciones_delete', 'public.evaluaciones'),
    ('evaluaciones_insert', 'public.evaluaciones'),
    ('evaluaciones_select', 'public.evaluaciones'),
    ('evaluaciones_update', 'public.evaluaciones'),
    ('fotos_insert', 'public.fotos'),
    ('fotos_select', 'public.fotos'),
    ('incidencias_insert', 'public.incidencias'),
    ('incidencias_select', 'public.incidencias'),
    ('incidencias_update', 'public.incidencias'),
    ('instancias_grupo_delete', 'public.instancias_grupo'),
    ('instancias_grupo_insert', 'public.instancias_grupo'),
    ('instancias_grupo_select', 'public.instancias_grupo'),
    ('instancias_grupo_update', 'public.instancias_grupo'),
    ('invitaciones_lider', 'public.invitaciones'),
    ('items_lider', 'public.items'),
    ('items_select', 'public.items'),
    ('marcajes_lider', 'public.marcajes'),
    ('marcajes_select', 'public.marcajes'),
    ('modulos_lider', 'public.modulos'),
    ('modulos_select', 'public.modulos'),
    ('profiles_lider', 'public.profiles'),
    ('profiles_select', 'public.profiles'),
    ('proyectos_lider', 'public.proyectos'),
    ('proyectos_select', 'public.proyectos'),
    ('respuestas_insert', 'public.respuestas'),
    ('respuestas_select', 'public.respuestas'),
    ('respuestas_update', 'public.respuestas'),
    ('sucursal_items_lider', 'public.sucursal_items'),
    ('sucursal_items_select', 'public.sucursal_items'),
    ('sucursal_modulos_lider', 'public.sucursal_modulos'),
    ('sucursal_modulos_select', 'public.sucursal_modulos'),
    ('sucursal_opciones_lider', 'public.sucursal_opciones'),
    ('sucursal_opciones_select', 'public.sucursal_opciones'),
    ('sucursales_lider', 'public.sucursales'),
    ('sucursales_select', 'public.sucursales'),
    ('evidencias_insert', 'storage.objects'),
    ('evidencias_select', 'storage.objects'),
    ('storage_incidencias_delete', 'storage.objects'),
    ('storage_incidencias_insert', 'storage.objects'),
    ('storage_incidencias_select', 'storage.objects'),
    ('storage_incidencias_update', 'storage.objects')
)
select
  e.tabla,
  e.politica,
  'FALTA' as estado,
  case
    when e.tabla like 'storage.%' then 'fotos e incidencias: sin esta politica la foto no se sube ni se ve'
    else 'sin esta politica la tabla no se puede usar como la espera la app'
  end as por_que_importa
from esperadas e
where not exists (
  select 1
  from pg_policies pp
  where pp.schemaname || '.' || pp.tablename = e.tabla
    and pp.policyname = e.politica
)
order by e.tabla, e.politica;


-- ----------------------------------------------------------------------------
-- 3) Los helpers de RLS siguen siendo ejecutables por authenticated
-- ----------------------------------------------------------------------------
-- Si a estos se les saca EXECUTE, el error no dice 'no tenes permiso': dice
-- 'permission denied for function' en cada select, insert y update, y parece que
-- se rompió la app entera. Ojo: los permisos en Postgres son aditivos, asi que
-- revocar de PUBLIC no los saca si el rol tiene un permiso propio.
select
  p.proname as funcion,
  case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
       then 'ok'
       else 'SIN EXECUTE: la app no va a poder leer ni guardar nada'
  end as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'es_lider', 'puede_ver_evaluacion', 'puede_responder',
    'puede_manejar_instancia', 'puede_reportar_incidencia', 'puede_ver_incidencia'
  )
order by p.proname;


-- ----------------------------------------------------------------------------
-- 4) Funciones con datos que NO pueden quedar abiertas a anon
-- ----------------------------------------------------------------------------
-- 'intento_login' y 'email_por_usuario' si van abiertas: son la pantalla de
-- login, que corre antes de autenticar, y por ahi no se puede evitar.
-- Las demas deberian dar 'ok' (cerradas para anon).
select
  p.proname as funcion,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede,
  case
    when p.proname in ('intento_login', 'email_por_usuario')
      then 'permitido sin sesion'
    when has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'ABIERTA A ANON: correr reactivar-politicas.sql'
    else 'ok'
  end as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'validar_suma_puntaje_items', 'validar_registro', 'handle_new_user',
    'validar_modulo_compartido', 'validar_unico_evaluador_modulo',
    'desbloquear_usuario', 'registrar_sync',
    'intento_login', 'email_por_usuario'
  )
order by p.proname;
