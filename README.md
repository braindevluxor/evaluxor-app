# EvaLuxor — Evaluaciones 360 de Supermercados

PWA responsive en 2 vistas:

- **Móvil** (`/evaluar`): el evaluador completa evaluaciones in-situ, con **soporte offline** (borradores y fotos en IndexedDB; se sincronizan al recuperar conexión).
- **Escritorio** (`/dashboard`): indicadores de gestión para gerentes (KPIs, ranking de sucursales, evolución mensual, matriz módulo×sucursal, fotos recientes y comparativas).

## Stack

Vite + React 19 + TypeScript, Tailwind CSS (color primario azul oscuro `#0B2545`), Supabase (Auth, Postgres + RLS, Storage), Recharts, IndexedDB (`idb`) para offline, `vite-plugin-pwa`.

## Roles

| Rol | Describe |
|---|---|
| `LIDER` | Gestiona usuarios/invitaciones, sucursales, módulos/ítems, asignaciones, los bonos por desempeño y ve el dashboard global. |
| `EVALUADOR` | Evalúa solo las sucursales asignadas, con la vista móvil. |
| `GERENTE_S` | Gerente de sucursal: ve solo los resultados de su sucursal. |
| `GERENTE_C` | Gerente corporativo: ve todas las sucursales. |
| `GERENTE_TH` | Talento Humano: ve todas las tiendas y gestiona los bonos por desempeño. |

### Flujo de creación de usuarios
1. El **Líder** genera una *invitación* (correo + **usuario de acceso** + rol + sucursal) desde `/config/usuarios`.
2. El invitado abre el enlace recibido, registra contraseña y queda habilitado; el **trigger** en Supabase le asigna rol/sucursal y usuario automáticamente.
3. El **login usa el usuario de acceso** (el correo queda como respaldo interno; Supabase resuelve usuario→correo en segundo plano).

> El registro SIN invitación está bloqueado en base de datos (trigger `validar_registro`): solo el Líder crea usuarios.

## Bonos por desempeño

Módulo en el menú de la consola (`/config/bonos`), para `LIDER` y `GERENTE_TH`:

- **Cargos**: qué cargos gozan de bono, con su monto, su nota mínima (umbral, 70 por defecto) y su periodicidad (mensual o trimestral, elegida por cargo). Cada cargo acota su **alcance**: sin sucursales marcadas aplica a **todas** con el monto base; marcadas, sólo a **ese conjunto** y cada sucursal puede traer su propio monto (montos distintos por tipo de tienda, sin tocar umbral ni periodicidad). También puede acotarse por **departamento** (la nómina trae `department_name` por persona): «Comprador/a» de Compras no se junta con «Comprador/a» de Servicios Generales. El mismo cargo puede repetirse en otra fila **si sus sucursales no se cruzan** y sus áreas son distintas: si comparten una (o si una es «todas»), el guardado rechaza el alta con el listado de las que chocan. La tabla muestra por cada cargo la cantidad de **ocupantes** (nómina activa de su alcance y departamento) y su **gasto total proyectado** = monto × ocupantes, con su fila de total; el modal repite esa estimación en vivo mientras se arma.
- **Pagos**: por período, se generan las filas con la nómina **actual** de las sucursales (API de trabajadores, sólo personas activas —«Nuevo ingreso» cuenta, «Retirado» no—) y después se carga la nota de cada persona **a mano**. La regla: por debajo del umbral no se paga nada (69 o menos con umbral 70); desde el umbral en adelante se paga el porcentaje obtenido, es decir `monto × nota / 100`.

Los datos viven en `supabase/schema.sql`, bloque `bonos.sql` (tablas `bonos_cargo`, `bonos_cargo_sucursal` y `bonos_pago`, con RLS sobre la función `puede_bonos`): hay que pegarlo en el SQL Editor de Supabase una vez. Es idempotente, se puede volver a correr.

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

3bis. **Crear el primer LÍDER**: `supabase/schema.sql` ya incluye el bootstrap del primer usuario LÍDER. Antes de ejecutarlo, edita correo, usuario y contraseña si hace falta. Registro posterior sale del menú `Usuarios` del Líder.

3ter. **Ejecuta la base completa una sola vez**: en Supabase se corre únicamente `supabase/schema.sql`. Ese archivo ya consolida el esquema base, incidencias, permisos, políticas RLS, biométrico, bootstrap del líder y controles de seguridad. Es idempotente: se puede volver a correr sin romper nada.

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