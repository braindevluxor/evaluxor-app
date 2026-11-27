# EvaLuxor — Evaluaciones 360 de Supermercados

PWA responsive en 2 vistas:

- **Móvil** (`/evaluar`): el evaluador completa evaluaciones in-situ, con **soporte offline** (borradores y fotos en IndexedDB; se sincronizan al recuperar conexión).
- **Escritorio** (`/dashboard`): indicadores de gestión para gerentes (KPIs, ranking de sucursales, evolución mensual, matriz módulo×sucursal, fotos recientes y comparativas).

## Stack

Vite + React 19 + TypeScript, Tailwind CSS (color primario azul oscuro `#0B2545`), Supabase (Auth, Postgres + RLS, Storage), Recharts, IndexedDB (`idb`) para offline, `vite-plugin-pwa`.

## Roles

| Rol | Describe |
|---|---|
| `LIDER` | Gestiona usuarios, sucursales, módulos/ítems, asignaciones, los bonos por desempeño y ve el dashboard global. |
| `EVALUADOR` | Evalúa solo las sucursales asignadas, con la vista móvil. |
| `GERENTE_S` | Gerente de sucursal: ve sólo los resultados de su sucursal, consulta el menú de su tienda en **sólo lectura** (lo edita el Líder), no entra a los proyectos de Gran Cosecha y en la Mesa de Ayuda su dashboard es **sólo de su tienda** (sin el gráfico que compara sucursales). |
| `GERENTE_C` | Gerente corporativo: ve todas las sucursales. |
| `GERENTE_TH` | Talento Humano: ve todas las tiendas y gestiona los bonos por desempeño. |
| `GERENTE_TI` | Gerente de TI: atiende la Mesa de Ayuda —asigna casos, cambia estados y prioridad, escribe notas internas— y administra el equipo de técnicos. Su consola es sólo la Mesa de Ayuda. |
| `TECNICO_TI` | Técnico de TI: atiende los casos —los toma, cambia el estado, responde en el chat como TI y deja notas internas—, pero no administra el equipo de técnicos. Su consola es sólo la Mesa de Ayuda. |
| `COOR_ACU` | Coordinador de Acuerdos: crea y gestiona los acuerdos comerciales —espacios del plano, proveedores, acuerdos y bajas—. Su consola es sólo Acuerdos Comerciales. |
| `AUD_EX` | Auditor de Acuerdos: registra los cobros, sube los comprobantes (PDF o imagen) y marca la mora. Su consola es sólo Acuerdos Comerciales. |

### Flujo de creación de usuarios
1. El **Líder** crea la cuenta desde `/config/usuarios` → **Crear usuario** (nombre opcional + correo + **usuario de acceso** + contraseña + rol + sucursal). La cuenta se crea en el acto: no hay enlace que la persona tenga que abrir.
2. Al terminar, la pantalla muestra las **credenciales** (usuario, correo y contraseña) con su botón de copiar, para mandárselas a esa persona.
3. Esa persona entra con esas credenciales y **cambia su contraseña** cuando quiera desde *Configuración → Cambiar contraseña*.
4. El **login usa el usuario de acceso** (el correo queda como respaldo interno; Supabase resuelve usuario→correo en segundo plano).

> El registro SIN autorización sigue bloqueado en base de datos (trigger `validar_registro`): sólo el Líder crea usuarios. Internamente el alta genera la fila de `invitaciones` que ese trigger exige — la tabla quedó como mecanismo de autorización, no como flujo visible—.

**Congelar / descongelar**: en cada fila de `/config/usuarios`, el botón de la nieve apaga el `activo` del usuario (lo mismo que el checkbox de *Editar usuario*). Un usuario congelado **no puede entrar** —`intento_login` ya no lo encuentra— y **su sesión se cierra en el próximo movimiento** (recarga o refresco de token), que es lo que hace `cargarPerfil` en `AuthContext`. «Descongelar» lo vuelve activo con toda su configuración intacta.

## Bonos por desempeño

Módulo en el menú de la consola (`/config/bonos`), para `LIDER` y `GERENTE_TH`:

- **Cargos**: qué cargos gozan de bono, con su monto, su nota mínima (umbral, 70 por defecto) y su periodicidad (mensual o trimestral, elegida por cargo). Cada fila puede llevar un **nombre a mostrar** opcional —«Gerente de mercado (Tienda tipo A)»— para distinguir cargos iguales; sólo cambia lo que se ve en pantalla, el cruce con la nómina sigue usando el cargo tal cual. Cada cargo acota su **alcance**: sin sucursales marcadas aplica a **todas** con el monto base; marcadas, sólo a **ese conjunto** y cada sucursal puede traer su propio monto (montos distintos por tipo de tienda, sin tocar umbral ni periodicidad). También puede acotarse por **departamento** (la nómina trae `department_name` por persona): «Comprador/a» de Compras no se junta con «Comprador/a» de Servicios Generales. El mismo cargo puede repetirse en otra fila **si sus sucursales no se cruzan** y sus áreas son distintas: si comparten una (o si una es «todas»), el guardado rechaza el alta con el listado de las que chocan. La tabla muestra por cada cargo la cantidad de **ocupantes** (nómina activa de su alcance y departamento) y su **gasto total proyectado** = monto × ocupantes, con su fila de total; el modal repite esa estimación en vivo mientras se arma. Y el modal de ocupantes se abre en **dos pestañas** —**Incluidos** (los que cuentan y cobran) y **Excluidos**—: desde la primera se **excluyen personas puntuales** —«hay 5, pero sólo 3 cobran»—: no cuentan, no generan pago (los pendientes se limpian al regenerar) y desde la segunda se reincorporan con un clic. El mismo modal permite lo contrario: **agregar un ocupante por excepción**, para quien está apoyando o preparándose para ocupar ese cargo y todavía figura con otro en la nómina. Se busca **por cédula (o nombre) entre los trabajadores** ya cargados, se elige en qué sucursal del alcance cobra y queda como ocupante de pleno derecho —cuenta en el conteo, en el gasto proyectado y genera su fila de pago—; si su cargo en la nómina ya coincide con el del bono, la app avisa que no hace falta agregarlo. Cada excepción se quita con un clic (y al quitarla se limpian sus pagos pendientes del cargo). Dos papeles en PDF cierran el ciclo: desde la cabecera de la pestaña, **«Relación para firmar»** descarga la relación **Cargo · Sucursal · Monto** de los cargos activos —una fila por tienda; «Todas las sucursales», las que no tienen alcance— con el renglón de firma de **Presidencia**; y cada ocupante por excepción lleva un ícono de impresión en el modal que descarga su **autorización** —persona, cargo que figura en la nómina, tienda, monto y firmas de Presidencia y ocupante—, como soporte del permiso.
- **Pagos**: por período, se generan las filas con la nómina **actual** de las sucursales (API de trabajadores, sólo personas activas —«Nuevo ingreso» cuenta, «Retirado» no—) y después se carga la nota de cada persona **a mano**. La regla: por debajo del umbral no se paga nada (69 o menos con umbral 70); desde el umbral en adelante se paga el porcentaje obtenido, es decir `monto × nota / 100`.

Los datos viven en `supabase/schema.sql`, bloque `bonos.sql` (tablas `bonos_cargo`, `bonos_cargo_sucursal` y `bonos_pago`, con RLS sobre la función `puede_bonos`): hay que pegarlo en el SQL Editor de Supabase una vez. Es idempotente, se puede volver a correr.

**Nómina espejo**: los ocupantes se leen de la tabla `trabajadores_nomina` —el registro **crudo** de la API, porque la normalización (activo, área, estado) vive sólo en el cliente—, que refresca la Edge Function `actualizar-nomina` todos los días a las 05:00 con `pg_cron` + `pg_net`. Si la tabla está vacía (o el bloque no está aplicado) la app cae a la API en vivo, y la pantalla avisa de dónde salió la nómina, cuánto hace que se actualizó y ofrece «Actualizar ahora». Si una tienda no responde, **sus filas no se borran**: se queda el último estado bueno. Para programarlo: habilitar `pg_cron` y `pg_net` (Database → Extensions), desplegar la función, aplicar el bloque `nomina-trabajadores.sql`, cargar la configuración y llamar `select public.programar_nomina_cron();` (el detalle está en la cabecera del bloque).

## Acuerdos comerciales

Módulo en el menú (sección **Comercial**, ruta `/acuerdos`) para `COOR_ACU`, `AUD_EX` y `LÍDER` (que **sólo ve**):

- **Planos**: la imagen del piso de venta de cada sucursal con sus espacios —cabezal, góndola, checkout, verificador de precios, pantalla, publiposte, valla, exhibidor, microperforado…— posicionados en porcentaje, con un **semáforo de estado**: **rojo** si está disponible, **verde** si está ocupado y al día con sus cobros, **amarillo** si está ocupado pero con cobros vencidos sin pagar.
- **Proveedores**: registro con color asignado solo; es el que marca al proveedor en la lista y a su espacio en el plano.
- **Acuerdos**: espacio + proveedor + fechas + **monto en USD** + frecuencia (quincenal, mensual, trimestral, semestre) + tipo de pago (nota de crédito o factura) + **contrato adjunto** (PDF o imagen, en el bucket privado; se ve desde la tabla con un clip). Los selectores **pueden crear la opción que falte** y el solape de fechas en un mismo espacio se rechaza al guardar.
- **Calendario**: las fechas de cobro salen de `fecha_inicio + frecuencia`; lo vencido sin cobrar se pinta de **rojo (mora)**, lo cobrado queda verde con su **comprobante** (PDF o imagen), y sólo el Auditor registra cobros. Trae el dinero recaudado y las cuentas pendientes por cobrar.
- **Dashboard**: indicadores de hoy; % rentado de cada sucursal vs. disponible en **barras verticales**, **torta** con el rentado por tipo de espacio, y con **filtro de mes en la barra superior** un **medidor curvo de cuatro anillos**: negociado, recaudado, facturas y notas de crédito, cada uno con su % y su monto.
- **Historial**: las rentas que existieron por espacio y su cumplimiento, con filtros por sucursal, proveedor y estado.

Los datos viven en `supabase/schema.sql`, bloque `acuerdos-comerciales.sql` (las tablas `acuerdo_*`, el bucket privado `acuerdos` para planos y comprobantes y las tres funciones de permiso). Se pega en el SQL Editor y es idempotente.

## Riegos de Gran Cosecha (para Academia Luxor y Desarrollo Luxor)

Un usuario de los **portales hermanos** puede *regar* un proyecto participante de la Gran Cosecha: es el «me gusta» del concurso, con regadera de jardín en vez de pulgar. **Una sola vez por usuario y proyecto** —como un post de Facebook— y la landing pública **`/gran-cosecha.html`** lo muestra en cada tarjeta de la sección **EQUIPOS PARTICIPANTES** (campo `riegos` de `participantes`, que arma `ver_contenido_gran_cosecha` con los proyectos REGISTRADOS en `/gran-cosecha/proyectos`).

La invariante no vive en el código: la tabla `gran_cosecha_riego` tiene por PRIMARY KEY `(proyecto_id, usuario)`, así que un riego repetido no crea fila. Esa tabla está **cerrada** (sin privilegios para `anon` ni `authenticated`, RLS sin políticas): sólo se entra por DOS puertas, y ninguna es un `insert` desde el cliente.

**También se riega desde EvaLuxor**: en `/gran-cosecha/proyectos`, la tarjeta de cada proyecto y su detalle traen el chip de conteo y el botón «Regar». Pasa por dos RPC con `grant ... to authenticated` — `regar_proyecto(uuid)` (escribe; guarda el `usuario` de la **sesión**, sin parámetro de identidad posible) y `riegos_de_la_cosecha()` (lee el mapa `{"<pid>": {"riegos": n, "mio": bool}}`; nunca devuelve quién regó).

**Las dos fotos del participante** —la imagen del proyecto (la cara de la tarjeta, siempre visible) y la foto del equipo (que la landing revela al tocarla)— **se cargan en el propio proyecto**, en el alta o la edición de `/gran-cosecha/proyectos`, y se guardan en `gran_cosecha_proyecto.imagen` / `.foto`. Suben al bucket `gran-cosecha` con ruta `proyectos/<uuid>.webp`: política propia del bucket para que cualquier sesión que pueda editar el proyecto cambie sus fotos, y sólo bajo ese prefijo. Vacías, la tarjeta usa la inicial del título.

**Endpoint**: Edge Function `registrar-riego`

```
https://<REF>.supabase.co/functions/v1/registrar-riego
```

Autorización: la API key compartida `RIEGO_API_KEY` en el header `x-riego-api-key` (o en `Authorization: Bearer <RIEGO_API_KEY>`). Si la función quedó desplegada con la verificación de JWT **encendida**, el gateway de Supabase exige además un JWT válido antes de dejar pasar: en ese caso manden `Authorization: Bearer <anon key>` (la anon key es pública) y dejen la API key en `x-riego-api-key`.

> **Así está desplegada hoy: verificación de JWT ENCENDIDA.** El gateway devuelve `UNAUTHORIZED_NO_AUTH_HEADER` si no hay `Authorization`, así que la llamada real lleva **DOS cabeceras** (`Authorization: Bearer <anon key>` + `x-riego-api-key`) — lo demás del contrato es igual. Si algún día se desactiva la verificación, basta `x-riego-api-key`.

### Regar un proyecto

```
POST /functions/v1/registrar-riego
Content-Type: application/json
x-riego-api-key: <RIEGO_API_KEY>

{ "proyecto_id": "uuid-del-proyecto", "usuario": "clave estable del usuario en su portal" }
```

```json
{ "ok": true, "status": 200,
  "data": { "proyecto_id": "…", "usuario": "…", "ya_regado": false, "riegos": 12 },
  "error": null }
```

- `ya_regado: true` → ese usuario ya lo había regado: no se duplica nada. La llamada es **idempotente**, un reintento de red no puede inflar el conteo.
- `riegos` → total de riegos del proyecto después de éste (el mismo número que después publica la landing).
- `usuario`: texto de 1 a 120 caracteres **sin espacios alrededor**. **Tiene que ser el MISMO valor del campo `usuario` de EvaLuxor** (el username con el que se entra a la app): es la identidad compartida — si un portal manda otra cosa (cédula, id propio), ese humano contaría DOS veces, uno por lado. EvaLuxor riega desde la consola con `regar_proyecto`, que guarda exactamente ese mismo valor, y esa unicidad vive en la PRIMARY KEY de la tabla.
- Los `uuid` de los proyectos salen de la **misma RPC pública de la landing**: `ver_contenido_gran_cosecha()` (sin sesión) devuelve en `participantes` el `id` y `titulo` de los proyectos del trimestre, con sus riegos. Los CANCELADOS no aparecen.

Errores: `400` cuerpo mal formado · `401` API key inválida · `404` proyecto inexistente · `409` proyecto CANCELADO (ya no participa) · `500` secretos faltantes en la función.

### Qué proyectos ya regó un usuario (para pintar sus botones)

```
GET /functions/v1/registrar-riego?usuario=<clave>
→ { "ok": true, "status": 200, "data": { "proyectos": ["uuid", "…"] }, "error": null }
```

Devuelve los `proyecto_id` que ese usuario ya regó (en TODOS los proyectos, sin importar período), para que el portal los pinte como regados antes de que nadie toque nada.

### Puesta en marcha

1. `supabase secrets set RIEGO_API_KEY=<valor largo y secreto>` (o Dashboard → Edge Functions → Secrets).
2. `supabase functions deploy registrar-riego`.
3. Aplicar `supabase/schema.sql` en el SQL Editor: trae `gran_cosecha_riego` y los `participantes` con `riegos` de `ver_contenido_gran_cosecha`. Es idempotente.
4. Pasar a cada portal la URL, la API key y el formato acordado de `usuario`.

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

3. **Crear el esquema**: pegar `supabase/schema.sql` en *Supabase Dashboard → SQL Editor → Run*. Crea tablas, triggers (bloqueo de registro sin autorización, perfil desde la invitación interna), políticas RLS y el bucket `evidencias`.
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