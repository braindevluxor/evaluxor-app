# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Principal: **Líder / administrador** de la cadena de supermercados. Configura sucursales, departamentos, módulos, ítems y usuarios; es quien revisa resultados, detecta desvíos y hace seguimiento. Es el rol que manda cuando hay que priorizar.

Audiencias secundarias confirmadas (mismas credenciales, otra pantalla):

- **EVALUADOR**: completa evaluaciones in-situ en el pasillo, con el celular, contra el tiempo y con conectividad intermitente.
- **GERENTE_S**: ve sólo los resultados de su sucursal.
- **GERENTE_C** y **GERENTE_TH**: ven todas las sucursales.
- **Invitado con enlace público**: sólo lectura de la conciliación, sin cuenta y sin permiso de tabla.

## Product Purpose

EvaLuxor centraliza la evaluación 360 de las sucursales de la cadena: levantamiento en la tienda con evidencia fotográfica, conciliación de stock y precios contra el sistema, y tableros de indicadores por sucursal, módulo y cargo.

Éxito = la cadena detecta y corrige desvíos por sucursal y por cargo **antes del próximo ciclo**, con datos levantados en el pasillo y sin depender de la conectividad.

## Positioning

Es el sistema propio de la cadena, no una herramienta comprada: su mecanismo no es copiable por un vecino de categoría porque nace de la operación real.

- La evaluación se hace en el pasillo, en el celular, y funciona **offline**: se guarda en IndexedDB y se sincroniza sola al recuperar red (cola idempotente con `offline_uuid`).
- Cada punto no cumplido queda **atribuido a un cargo concreto** (responsable), no a una persona suelta, lo que permite seguir a cada cargo a lo largo del tiempo.
- El catálogo de cargos viene de la nómina real por branch (edge function `listar-colaboradores`), no de una lista escrita a mano en la app.

## Operating Context

- Dos escenas de uso: en tienda (pasillo/góndola, un solo mano, celular) y en escritorio (revisión de indicadores y configuración).
- PWA instalable y 100% estática: `npm run build` produce `dist/` que se sube por FTP a cPanel. Sin servidor propio de aplicaciones.
- Datos en Supabase: Auth, Postgres con RLS y Storage (bucket `evidencias`, privado). Toda la lectura/escritura pasa por `src/lib/data/*`.
- Registro sólo por invitación del Líder (trigger `validar_registro`); el login usa *usuario de acceso*, no el correo.
- Enlaces públicos de sólo lectura para compartir la conciliación con gente sin cuenta.
- Idioma de la interfaz y de los datos: español.

## Capabilities and Constraints

- Cinco roles con permisos cortados por RLS: `LIDER`, `EVALUADOR`, `GERENTE_S`, `GERENTE_C`, `GERENTE_TH`.
- Rutas principales: `/evaluar` (móvil, offline), `/dashboard` (escritorio), `/dashboard/responsables` (seguimiento por cargo, sólo Líder), `/config/*` (sólo Líder), `/biblioteca`, `/proyectos`, `/herramientas/inspeccion-vehiculo` (Líder y evaluador), `/compartir/:token` (invitado).
- Conciliación contra `SOH` (stock) o `FINAL_BASE` (precio de venta); la pérdida se valoriza al PVP.
- **Responsables = cargos**: texto libre guardado por ítem y por opción (`responsables: string[]`), con selección por check y respaldo en el gerente de la sucursal. Catálogo agrupado por departamento, deduplicado con clave normalizada (sin acentos ni mayúsculas).
- **Seguimiento por cargo**: matriz cargo × sucursal con el **promedio porcentual de la nota de cada cargo**, acumulado sobre todo el histórico (evaluaciones cerradas), con drill-down al módulo/ítem/sucursal concreto —los hallazgos siguen estando, pero agrupados: un renglón por ítem con las veces que cayó y, en los checklists, el nombre de cada check caído con su conteo, que es lo que explica la nota—. La nota es logrado sobre posible, ponderada con los mismos pesos que el resto de la app, así un 87% acá es el mismo 87% de EvaluacionDetalle; sin base de cálculo la celda es «—», nunca 0%. Agrupa por clave normalizada, así «Encargado de turno» y «encargado de Turno» son una sola fila; una evaluación de departamento entra como unidad propia, no como sucursal sin nombre.
- **Inspección de vehículo particular** (`/herramientas/inspeccion-vehiculo`, Líder y evaluador): módulo-herramienta `INSPECCION_VEHICULO` —el módulo y sus ítems se crean con `supabase/inspeccion-vehiculo.sql` y de ahí en adelante se editan desde Ítems de evaluación— con tres secciones (Estética, Mecánica y Sistema de gas vehicular **GNV**) y dictamen final. Cada punto admite foto o incidencia con comentario; la ficha lleva placa (consulta por API con carga manual de respaldo), datos del vehículo, **sistema de combustible** y propietario con firma. Se guarda en el dispositivo y sube a `revision_pre_entrega` distinguiéndose por `modulo_id`, reutilizando RLS y storage de la pre-entrega; la semilla trae ese andamiaje (columna `modulos.herramienta`, tabla y políticas) con guardas `if not exists`, así que basta con correrla aunque `revision-pre-entrega.sql` nunca se haya aplicado. Sale a PDF con las bandas de sección, las evidencias con su pie y la firma.
- Offline: borradores de evaluación, fotos comprimidas y cola de subida idempotente; barra de sincronización visible.
- Decisión abierta: el nivel concreto de accesibilidad exigido (ver *Accessibility & Inclusion*).

## Brand Commitments

- Nombre **EvaLuxor** y color primario **azul oscuro `#0B2545`**: marca fija, declarada también en el README.
- Logotipo e isotipo reales en `public/` (`logo.webp`, `isotipo.webp`, `completo.webp` + PNG e iconos PWA). No inventar marcas ni isotipos alternativos.
- Sin manual de voz, tipografía de marca ni paleta extendida confirmados: no hay una decisión de marca que haya que respetar más allá del nombre y el azul.

## Evidence on Hand

- `README.md`: roles, flujo de creación de usuarios, estrategia offline, despliegue y migración futura.
- `supabase/schema.sql`: esquema completo, triggers, RLS y bootstrap del primer Líder (idempotente).
- Assets reales en `public/` (logo, isotipo, favicon, iconos PWA).
- Suite de tests con `vitest`: scoring, transform de fotos, indicadores, conciliación, permisos, tiempo.
- **Ausencias que no se deben fabricar**: no hay testimonios, clientes, casos de estudio, precios ni métricas publicables — es un sistema de uso interno. Tampoco hay capturas ni goldens de regresión visual en el repo, así que ninguna pantalla puede citar "antes/después" sin capturarlo.

## Product Principles

1. **El Líder decide.** Cuando dos caminos chocan, gana el que le hace más simple administrar la red y controlar quién responde por qué.
2. **La verdad se levanta en la tienda.** Si la red falla, la evaluación sigue y se sincroniza después; nunca se pierde un conteo por conectividad.
3. **Todo punto no cumplido tiene dueño.** Un desvío sin cargo asignado es un hallazgo que nadie corrige: la atribución es parte del dato, no un comentario.
4. **La pantalla sirve para operar.** Claridad, cifras verificables y jerarquía antes que efectos; el usuario está trabajando, no navegando.

## Accessibility & Inclusion

- **Requisito específico confirmado por el usuario: sí.** La norma y el nivel exacto (p. ej. WCAG 2.1 AA) están **pendientes de confirmar** — decisión abierta, no se asume ninguno.
- Mientras tanto aplica el piso del propio proyecto: contraste ≥4.5:1 en texto corrido, objetivos táctiles grandes y foco visible, porque el uso real mezcla tienda con luz fuerte y escritorio.
- (Inferido del contexto de uso, no confirmado por el usuario: lectura en tienda con luz fuerte y una sola mano libre.)
