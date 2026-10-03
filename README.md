# EvaLuxor — Evaluaciones 360 de Supermercados

PWA responsive en 2 vistas:

- **Móvil** (`/evaluar`): el evaluador completa evaluaciones in-situ, con **soporte offline** (borradores y fotos en IndexedDB; se sincronizan al recuperar conexión).
- **Escritorio** (`/dashboard`): indicadores de gestión para gerentes (KPIs, ranking de sucursales, evolución mensual, matriz módulo×sucursal, fotos recientes y comparativas).

## Stack

Vite + React 19 + TypeScript, Tailwind CSS (color primario azul oscuro `#0B2545`), Supabase (Auth, Postgres + RLS, Storage), Recharts, IndexedDB (`idb`) para offline, `vite-plugin-pwa`.

## Roles

| Rol | Describe |
|---|---|
| `LIDER` | Gestiona usuarios/invitaciones, sucursales, módulos/ítems, asignaciones y ve el dashboard global. |
| `EVALUADOR` | Evalúa solo las sucursales asignadas, con la vista móvil. |
| `GERENTE_S` | Gerente de sucursal: ve solo los resultados de su sucursal. |
| `GERENTE_C` | Gerente corporativo: ve todas las sucursales. |
| `GERENTE_TH` | Talento Humano: ve todas las tiendas. |

### Flujo de creación de usuarios
1. El **Líder** genera una *invitación* (correo + **usuario de acceso** + rol + sucursal) desde `/config/usuarios`.
2. El invitado abre el enlace recibido, registra contraseña y queda habilitado; el **trigger** en Supabase le asigna rol/sucursal y usuario automáticamente.
3. El **login usa el usuario de acceso** (el correo queda como respaldo interno; Supabase resuelve usuario→correo en segundo plano).

> El registro SIN invitación está bloqueado en base de datos (trigger `validar_registro`): solo el Líder crea usuarios.

## Puesta en marcha

1. Clonar e instalar:
   ```
   npm install
   npm run dev
   ```
2. Configurar variables en `.env`:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
   (la anon key es pública por diseño; el `service_role`/password NO debe ir en el cliente).

3. **Crear el esquema**: pegar `supabase/schema.sql` en *Supabase Dashboard → SQL Editor → Run*. Crea tablas, triggers (bloqueo de registro sin invitación, rol por invitación), políticas RLS y el bucket `evidencias`.
   > Si el proyecto no está activo, reactívalo primero (pausas de más de 7 días lo suspenden).

3bis. **Crear el primer LÍDER**: ejecutar `supabase/crear-lider.sql` en el SQL Editor (antés edita correo, usuario y contraseña). Registro posterior sale del menú `Usuarios` del Líder.

3ter. **Cerrar los permisos** (también en una base recién creada): hay archivos que se corren aparte de `schema.sql`, todos idempotentes y en el SQL Editor. En este orden:

   | # | archivo | qué hace |
   |---|---------|----------|
   | 1 | `cerrar-lectura-anon.sql` | Cierra a quien no inició sesión la lectura de 7 tablas (`profiles`, `items`, `modulos`, `sucursales` y las 3 de configuración). **No depende de nada**: corré este primero. |
   | 2 | `incidencias.sql` | Crea la tabla de incidencias y sus políticas de Storage. |
   | 3 | `permisos-funcion.sql` | Ajusta los `EXECUTE` de las funciones. No toca los 6 helpers de RLS, y el archivo explica por qué. |
   | 4 | `reactivar-politicas.sql` | Vuelve a prender RLS y repone todas las políticas (trae el mismo fix de lectura anónima). Depende del 2. Va en transacción. |
   | 5 | `cerrar-permisos-anon.sql` | Saquetea a `anon`: le saca el permiso sobre todas las tablas y el `EXECUTE` de los 6 ayudantes de RLS. **Va después del 1**, porque una parte depende de la otra. |
   | 6 | `validar-politicas.sql` | 4 consultas de solo lectura. La columna `estado` tiene que decir `ok` en las cuatro. |

   Para entender por qué una tabla o una función quedan con un permiso y no con otro, está el motivo en prosa arriba de cada archivo. Vale la pena tener presente una cosa: **la primera llave es la política de RLS y la segunda es el `revoke`**, y hacen falta las dos porque los permisos de Postgres son aditivos (quitarle el permiso a un rol no alcanza si el de `PUBLIC` sigue sirviendo).

4. Iniciar sesión con el **usuario de acceso** y configurar: sucursales → asignaciones → módulos/ítems.

## Build / despliegue

```
npm run build   # genera dist/ (estático)
npm run preview # probar el build localmente
```

La app es 100% estática: `dist/` se sube a cualquier host (incluido cPanel por FTP). Es instalable como PWA desde el navegador del teléfono.

## Offline y sincronización

- El catálogo (sucursales, módulos, ítems, asignaciones) se cachea en IndexedDB al iniciar sesión.
- Cada cambio en una evaluación se guarda como borrador local.
- Al `Enviar`, la evaluación pasa a una **cola** con `offline_uuid` (único) + fotos comprimidas.
- Con conexión (evento `online` o botón *Sincronizar*), la cola sube: fotos a Storage → evaluación → respuestas → filas de fotos. Los `upsert` hacen el proceso idempotente.
- La barra superior muestra cuántas evaluaciones faltan por sincronizar.

## Migración futura a cPanel
Preparada desde el diseño:

- **Frontend**: SPA estática — `npm run build` produce `dist/` subible por FTP sin cambios.
- **Capa de datos aislada**: toda la base pasa por `src/lib/data/*` y el auth por `src/lib/auth` + `context/AuthContext`. Migrar a un backend PHP/MySQL en cPanel implica reimplementar esas capas (interfaces `supabase.ts`, `catalog.ts`, `indicadores.ts`, `usuarios.ts`) contra una API REST propia; la UI no necesita cambios porque consume respuestas tipadas (`src/lib/types.ts`).
- **Modelo relacional portable**: `supabase/schema.sql` usa tablas normalizadas (uuid como `char(36)`, `jsonb` como `JSON`, `auth.uid()` → sesión PHP). El mapeo tabla→tabla es 1:1.

## Scripts

- `npm run dev` — desarrollo
- `npm run build` — build de producción (tsc + vite)
- `npm run typecheck` — chequeo de tipos
- `npm run lint` — ESLint
- `npm test` — unit tests (scoring, transform de fotos)