# AGENTS.md

EvaLuxor: PWA de evaluaciones 360 de supermercados. Vite + React 19 + TypeScript + Tailwind 4, datos en Supabase (Auth, Postgres con RLS, Storage), build 100 % estática en `dist/`.

**Todo en este repo vive en español**: comentarios de código, copy de UI, documentación. Escribí comentarios y textos de pantalla en español.

Fuentes de verdad del producto: `PRODUCT.md` (usuarios, capacidades, decisiones abiertas, marca: nombre EvaLuxor, azul primario `#0B2545`, logos reales en `public/` — no inventar marcas ni métricas) y `README.md` (roles, flujo de invitaciones, offline, despliegue). Si un doc y el código chocan, manda el código.

## Comandos

```
npm run dev          # dev server (requiere .env, ver abajo)
npm run build        # tsc -b && vite build -> dist/
npm run typecheck    # tsc -b --noEmit (también chequea los *.test.*)
npm run lint         # eslint .
npm test             # vitest run (suite completa, ~88 archivos)
npm test -- src/lib/scoring.test.ts   # un solo archivo (filtro por path)
```

- **No hay CI ni pre-commit**: la verificación es local, en este orden: `npm run lint` → `npm run typecheck` → `npm test`.
- En PowerShell de esta máquina el shim `npm` (`.ps1`) está bloqueado por la execution policy: usá `npm.cmd ...`.
- `.env` es obligatorio (hay `.env.example`): `src/lib/supabase.ts` lanza error al importar si faltan `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, y eso también rompe parte del test suite. Las claves de servidor (`PRECIOS_API_KEY`, `VEHICLES_API_KEY`, `COLABORADORES_API_KEY`) no llevan prefijo `VITE_` y sólo existen en Vercel / Supabase Functions.
- Si un test falla con `Cannot find package 'jsdom'`, `node_modules` quedó desincronizado de `package.json`: `npm install`.
- El baseline **no siempre está verde** (lint y test pueden traer fallos ya existentes). Antes de asumir que rompiste algo, compará contra el estado previo del árbol.

## Arquitectura (lo que los archivos no dicen)

- **El permiso real es RLS en `supabase/schema.sql`**; los guards de `src/components/guards.tsx` (`RequireRol`, `SoloLider`) sólo son UX. Cambiar quién ve qué = política nueva/cambiada en `schema.sql`.
- **`supabase/schema.sql` es el único archivo SQL.** Los `.sql` que había por funcionalidad fueron consolidados ahí con la marca `-- Archivo consolidado: <archivo>.sql`. Los tests extraen bloques con `bloqueSql('<archivo>.sql')` (`src/lib/supabaseSql.ts`) y **lanzan error si la marca no existe**: SQL nuevo va como bloque marcado dentro de `schema.sql`, que además es idempotente y se aplica pegándolo en el SQL Editor de Supabase.
- Cliente Supabase: singleton `src/lib/supabase.ts`; consultas de negocio en `src/lib/data/*`; tipos en `src/lib/types.ts`. (El README dice "todo pasa por `src/lib/data/*`", pero varios componentes importan `supabase` directo para Storage/RPC: no es una regla enforceada.)
- Offline: `src/lib/offline/` con IndexedDB (`idb`), borradores y cola de subida idempotente por `offline_uuid`.
- Backends ajenos: en dev `vite.config.ts` proxyea `/api/pricing` y `/api/flota`; en prod los mismos paths los resuelve `vercel.json` (rewrites) con `api/*.js` como edge functions de Vercel para esconder claves. Tocar un proxy implica tocar ambos archivos.
- Identidad de build: `vite.config.ts` inyecta `__APP_VERSION__` / `__BUILD_ID__` / `__BUILD_FECHA__` y publica `/version.json` (el service worker no lo cachea). La app lo consulta sin caché y ofrece actualización cuando el `buildId` cambia; el `version` de `package.json` es sólo lo que se muestra.
- `biometrico-bridge/` es un paquete Node aparte (servidor loopback `:8787` para el lector Anviz D100): `cd biometrico-bridge && npm start`, `MODO=demo` para datos de ejemplo. Se testea desde la suite raíz.

## Testing (peculiaridades)

- No hay config de vitest: corre sobre `vite.config.ts`. Ambiente por defecto `node`; un test que necesita DOM debe declararlo con `// @vitest-environment jsdom` (hoy sólo `src/components/SelectorResponsables.test.tsx`, que además usa `fake-indexeddb`).
- Varios tests leen **texto fuente** en vez de comportamiento: `*-sql.test.ts` parsean `supabase/schema.sql`; `version-integracion.test.ts` exige strings exactos en `vite.config.ts` y `src/lib/version.ts`. Cambiar esos strings o esa estructura rompe tests sin cambiar el comportamiento.
- Varias pruebas de SQL ejecutan el bloque contra **PostgreSQL real en memoria** (`@electric-sql/pglite`) sobre un espejo mínimo de tablas escrito a mano en cada test. Si cambia la forma real de una tabla, hay que actualizar el espejo — sin "arreglarlo" agregando columnas que la tabla real no tiene (algunas faltan a propósito).
- `src/lib/biometrico.test.ts` hace detección USB **real** de Windows (sin mock, timeout 5 s) vía `biometrico-bridge/lib/usb.js` y puede fallar por timeout en máquinas sin el lector: si es el único fallo, es el entorno, no tu cambio. Depende de `biometrico-bridge/data/marcajes.csv` (committeado).

## Convenciones

- Avisos/toasts: `avisar()` de `src/lib/aviso.ts`. No hay provider (el host vive en `App`); no inventes un sistema de toasts nuevo.
- ESLint trae `@typescript-eslint/no-explicit-any`, `react-hooks/purity` y `react-hooks/set-state-in-effect` apagados, y el repo ya acumula warnings `react-refresh/only-export-components` en contextos. No los "limpies" como parte de otro cambio.
- Despliegue: `dist/` es subible tal cual por FTP a cPanel, o a Vercel (usá `vercel.json` para cualquier rewrite nuevo). `dist/` está en `.gitignore`; `.agents/` y `.opencode/` también, `.impeccable/` sí se versiona.
