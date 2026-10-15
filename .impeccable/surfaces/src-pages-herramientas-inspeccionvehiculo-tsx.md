# Surface: `src/pages/herramientas/InspeccionVehiculo.tsx`

## Direction contract

### THESIS

Una **hoja única de inspección de vehículo particular**, en el orden en que se recorre el carro — Estética → Mecánica → Sistema de gas vehicular (GNV) → dictamen —, donde cada punto se responde con checks y admite foto o incidencia con comentario. La pantalla no calcula un puntaje: termina en un **PDF firmado** con las bandas de sección, las evidencias con su pie y la firma del propietario. Es la máquina de la Revisión Pre-Entrega (registro local → cola de subida → bucket) reaprovechada, con otra ficha y otro módulo.

Carta ganadora del usuario (decisión explícita): **menú en la consola**, **catálogo como módulo configurable en la base** (semilla `supabase/inspeccion-vehiculo.sql`, después editable desde Ítems de evaluación) y **subida a Supabase + PDF** (no sólo local).

### OWN-WORLD

Mundo heredado, no reemplazado: pantalla nueva dentro del `ConsoleLayout` existente.

- Superficies blancas **sin borde ni sombra** sobre página `#f1f5f9`; la estructura la dan el padding y los paneles tonales (`bg-primary-50` para las cabeceras de sección, `bg-slate-50`/`bg-amber-50` para avisos). La regla de CSS que aplana `border`/`shadow` es un rasgo del mundo.
- Lato 400/700/900, cifras en `tabular-nums`, iconos lucide de trazo fino (`Car` en el menú, `FolderOpen` en las cabeceras de sección).
- Componentes del design system (`Card`, `Field`, `Input`, `Select`, `Button`, `EmptyState`, `Spinner`, `Textarea`, `FirmaCanvas`, `ItemRenderer`): ninguna pieza nueva de UI.
- El PDF reutiliza el exportador de la pre-entrega, que a su vez reutiliza la marca al pie de los informes (`logoPie`), para que los tres reportes se lean como una familia.

### STORY

1. El evaluador o el Líder entra por **Herramientas → Inspección de vehículo** en el menú lateral de la consola (el menú se oculta a quien la ruta no deja entrar).
2. Elige la sucursal, escribe la placa (consulta la API por placa; si no aparece, carga marca/modelo/año/color/kilometraje a mano) y marca el **sistema de combustible** — ahí está el GNV.
3. Carga al propietario (cédula/RIF, nombre, apellido, teléfono) y su firma, que es **opcional**: la inspección puede hacerse sin el dueño presente.
4. Recorre las tres secciones; cada punto deja foto o incidencia con comentario. Las cabeceras de sección muestran su propio avance.
5. «Generar PDF de la inspección» exporta la hoja con evidencias y firma, marca el registro `FINALIZADA` y lo sube si hay señal; sin señal, la cola lo sube sola. El botón cambia a **Nueva inspección** para seguir con el próximo vehículo.

### FIRST VIEWPORT

A 1440×900, sin scroll: barra lateral de consola, título «Inspección de vehículo» + subtítulo (`titulosVista`), y dentro de la columna el resumen («módulo · N puntos a revisar» + avance), la tarjeta de sucursal y el arranque de la de vehículo. El checklist queda a un scroll, agrupado por sección.

### FORM

- Columna única `max-w-3xl mx-auto`: es una ficha que se llena de arriba abajo, no un tablero.
- Cabecera de sección en `bg-primary-50` con icono y contador `n/m` de la sección; los ítems son los `ItemRenderer` de siempre.
- **Barra de acción pegada abajo** (`sticky bottom-0` sobre la página `#f1f5f9`): sincronizar + generar PDF. Sin firma ni acciones flotantes sobre el contenido.
- El aviso de resultado (verde/ámbar) y el de sin-conexión van arriba, en tonal, no como toasts: en el campo hay que poder releerlos.
- El PDF abré una **banda de sección** (`colspan="2"`, teal-100 en mayúsculas) cada vez que cambia `grupo`, e imprime las fotos en una grilla de tres columnas con el pie «Ítem · Opción · incidencia».

### FINISH

- Estados cubiertos: carga, **sin módulo configurado** (con la semilla SQL que hay que correr), **perfil sin sucursal** (el selector se muestra igual y la inspección se abre al elegir —un Líder no tiene sucursal—; nunca con sucursal vacía, porque la cola sube el registro por su cuenta y el servidor exige el id), sin sucursales configuradas, borrador retomado, sin conexión, PDF generado con/sin señal, export incompleto.
- La firma es opcional **a propósito**; el PDF imprime «Sin firma» en vez de bloquear la salida.
- El borrador se retoma **filtrando por `modulo_id`**: un borrador de otra herramienta en el mismo equipo no se cuela en esta pantalla.
- Las fotos se resuelven de las dos procedencias (IndexedDB con `getPhotos`, bucket con `createSignedUrls`) y todas las `blob:` URL se revocan al terminar; una foto marcada `.local/` (nunca subida) se descarta en vez de romper el PDF con un 404.
- Pruebas: `src/lib/inspeccionVehiculo.test.ts` (agrupación de secciones y pies de evidencia, lógica pura) y `src/pages/herramientas/inspeccionVehiculo.test.ts` (cableado: clave, ruta, menú, borrador, PDF — pruebas de fuente, por el mismo motivo que `ItemRenderer.test.tsx`).
