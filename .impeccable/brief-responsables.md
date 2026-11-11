## Direction contract

### THESIS

Una matriz densa **cargo × sucursal**: filas = cargos, columnas = sucursales, celda = puntos no cumplidos acumulados en todo el histórico. El color de la celda concentra la mirada donde hay que intervenir y una celda pulsada abre el detalle concreto (módulo, ítem, sucursal, evaluación). El Líder detecta el cargo que acumula, ve en qué sucursal se le acumula, y cae al punto sin cumplir que lo explica.

Carta ganadora: `matriz cargo × sucursal` (ronda de concept-seed, `--scope surface --mode operate`, roll `aa6d48ce`). Estructuras repartidas: tabla maestra + panel lateral, barras apiladas + hallazgos, matriz cargo × sucursal. Ganó la matriz.

### OWN-WORLD

Mundo heredado, no reemplazado: es una pantalla nueva dentro del dashboard de indicadores existente. La identidad vive en el código (`src/index.css`), no en un DESIGN.md.

- Superficies blancas **sin borde ni sombra** sobre página `#f1f5f9`; la estructura la dan el padding y los paneles interiores tonales (`bg-slate-50`, `bg-primary-50`, estados rojo/ámbar). La regla de CSS que aplana `border`/`shadow` es un rasgo del mundo, no un error: no se la debe contradecir.
- Tipografía Lato autohospedada 400/700/900, con Poppins detrás del mismo nombre para 500/600/800. Las **cifras van en 900 tabular**.
- Paleta: `--color-primary` #28315F y su escala 50..900 (#0b2545 el 900). Estados: #16a34a / #d97706 / #dc2626 (`src/lib/diseno.ts`).
- Micro-etiquetas en mayúscula con `tracking-wider`; chips redondos de estado; iconos lucide de trazo fino.
- La franja azul de KPIs la pinta `BarraKpis` desde el layout; la pantalla sólo publica los números con `setKpisGlobal`.

### STORY

1. El Líder entra por el item «Seguimiento por cargo» de la consola (rol `LIDER` sólo).
2. La franja azul muestra: puntos no cumplidos, cargos con desvío, sucursales con desvío, cargos sin hallazgos.
3. La matriz se ordena por puntos acumulados: el peor cargo arriba, la peor sucursal a la izquierda del bloque de columnas.
4. El pico de la escala (rojo sólido, cifra blanca) es el único punto al que la mirada tiene que ir sin buscar.
5. Pulsar una celda (o el total de la fila) **despliega el detalle dentro de la tabla**, justo debajo de la fila del cargo elegido: hallazgos agrupados por módulo, con sucursal y fecha. No vive en un card aparte al final de la página, porque ahí el usuario tendría que ir a buscarlo y perdería de vista la matriz que lo seleccionó.
6. Búsqueda por cargo y orden (puntos / cobertura / A-Z) filtran la matriz; los totales por columna se recalculan sobre lo visible para que el pie cierre.

### FIRST VIEWPORT

A 1440×900, sin scroll: barra lateral de consola (Resultados → Indicadores / Seguimiento por cargo / Historial), título «Seguimiento por cargo» + subtítulo, franja azul de 4 KPIs, y el card de la matriz con su leyenda de escala y chip de alcance. El detalle NO ocupa el primer viewport: aparece debajo al pulsar. Referencia del boceto elegido: `.impeccable/mocks/decision/matriz.html`.

### FORM

- Tabla `border-separate border-spacing-1`, columna de cargo `sticky left-0` en blanco para que la matriz se desplace en horizontal en pantallas angostas (`min-w-[760px]`).
- Celda: número en `font-black tabular-nums`, fondo de banda. Escala relativa al pico de la propia matriz (no a un número fijo): 0 → `slate-50`; ≤34% → `green-50`; ≤67% → `amber-100`; <100% → `red-100`; pico → `red-700` con cifra blanca.
- Celda vacía = «—» **sin ser botón**: con muchas sucursales serían cientos de tabulaciones para llegar a la única celda que importa. Texto `sr-only` para lectores de pantalla.
- Cabecera de columna en `bg-primary-900` con el nombre y el total; fila de pie en `bg-primary-50` / `bg-primary-100`.
- Detalle: **fila expandida dentro de `<tbody>`** (`<td colSpan={unidades.length + 2}>`), con `<Fragment>` por fila para poder insertarla justo debajo de la elegida. Panel tonal `bg-slate-50` — blanco no se vería sobre la card blanca—, con cabeceras de módulo `bg-white` dentro. Tope de 40 renglones con «Ver más»; el subtotal del módulo se calcula sobre el total, no sobre lo mostrado.
- Sin sombras ni bordes añadidos: la selección se marca con `border-2 border-primary` (los `<button>` escapan al aplanado de CSS, que sólo alcanza a `div/section/article/aside/nav/li/a`).

### FINISH

- **Estado de error explícito**: si la consulta falla se dice «No se pudieron cargar los datos» con botón Reintentar; nunca se juran ceros que no se verificaron. (En Indicadores y ModuloDashboard el `catch` se traga y cae en «sin datos» — ésta pantalla no repite ese error.)
- Estados cubiertos: carga (`SkeletonFilas`), vacío, sin resultados por búsqueda, error, selección.
- Tabla accesible: `<caption class="sr-only">`, `scope="col"` / `scope="row"`, `aria-pressed` y `aria-label` descriptivos en las celdas clicable.
- Contraste ≥4.5:1 en todo el texto corrido (verificado: verde-700 sobre verde-50, ámbar-800 sobre ámbar-100, rojo-700 sobre rojo-100, blanco sobre rojo-700, blanco sobre primary-900).
- Estado nunca sólo por color: toda celda lleva su número y su etiqueta accesible.
- Movimiento: sólo `transition-colors`; nada que no respete `prefers-reduced-motion`.
