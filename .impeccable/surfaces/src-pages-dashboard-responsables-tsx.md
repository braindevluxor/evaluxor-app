---
version: 1
slug: "src-pages-dashboard-responsables-tsx"
primary_target: "src/pages/dashboard/Responsables.tsx"
related_targets: ["src/lib/data/indicadores.ts","src/components/layouts/ConsoleLayout.tsx","src/App.tsx"]
---

## Direction contract

### THESIS

Una matriz densa **cargo × sucursal**: filas = cargos, columnas = sucursales, celda = **la nota en %** que sacó ese cargo en esa sucursal, acumulada sobre todo el histórico. El color señala dónde está la nota más baja —no dónde hay más incidencias— y una celda pulsada abre el detalle concreto (módulo, ítem, sucursal, evaluación) con la lista de lo que le está quitando nota. El Líder ve qué cargo está quedando atrás, en qué sucursal, y cae al ítem que lo explica: **un renglón por ítem** con las veces que cayó y, si es una lista de chequeo, **el nombre de cada check con su conteo** —«sin EPP completo — 3 veces»—, no el título genérico del ítem.

La matriz mide **rendimiento**, no volumen de fallas: «87%» se compara solo con cualquier otro número de la tabla, mientras que «14 puntos» depende de cuántos ítems tenga ese cargo. Las incidencias no desaparecen, quedan como el drill-down.

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
2. La franja azul muestra: nota promedio (ponderada sobre todo el histórico), cargos evaluados, sucursales con datos, cargos sin hallazgos.
3. La matriz se ordena por nota: el cargo más bajo arriba, la sucursal con la nota más baja a la izquierda del bloque de columnas. Los cargos que nunca se midieron **cierran** la lista: sin nota no se puede decir que son los peores.
4. La celda más baja de la matriz —y sólo si está por debajo de 80%— es el único punto al que la mirada tiene que ir sin buscar: rojo sólido con cifra blanca.
5. Pulsar una celda (o el total de la fila) **despliega el detalle dentro de la tabla**, justo debajo de la fila del cargo elegido: la nota que se pulsó arriba y debajo, agrupado por módulo, **un renglón por ítem** con las veces que cayó, los checks concretos con su conteo y en qué unidades pasó. No vive en un card aparte al final de la página, porque ahí el usuario tendría que ir a buscarlo y perdería de vista la matriz que lo seleccionó.
6. Búsqueda por cargo y orden (nota / cobertura / A-Z) filtran la matriz; las notas por columna se recalculan sobre lo visible —ponderando logrado y posible, nunca promediando porcentajes— para que el pie cierre.

### FIRST VIEWPORT

A 1440×900, sin scroll: barra lateral de consola (Resultados → Indicadores / Seguimiento por cargo / Historial), título «Seguimiento por cargo» + subtítulo, franja azul de 4 KPIs, y el card de la matriz con su leyenda de escala y chip de alcance. El detalle NO ocupa el primer viewport: aparece debajo al pulsar. Referencia del boceto elegido: `.impeccable/mocks/decision/matriz.html`.

### FORM

- Tabla `border-separate border-spacing-1`, columna de cargo `sticky left-0` en blanco para que la matriz se desplace en horizontal en pantallas angostas (`min-w-[760px]`).
- Celda: cifra en `font-black tabular-nums` **con su `%`**, fondo de banda. Escala **absoluta** y no relativa al pico: un porcentaje tiene valor propio —79% es malo el día que el resto está en 95 y también el día que está en 60—, así que pintarlo de verde porque sea el mejor de la tabla sería mentirle al Líder justo cuando peor está. Bandas: ≥90% → `green-50`; ≥80% → `amber-100`; <80% → `red-100`; la más baja de la matriz, y sólo si es <80% → `red-700` con cifra blanca (el ancla).
- Celda **sin nota** = «—» **sin ser botón** (no se lo evaluó en esa sucursal; un 0% diría lo contrario): con muchas sucursales serían cientos de tabulaciones para llegar a la única celda que importa. Texto `sr-only` para lectores de pantalla.
- La nota de una fila o de una columna se **pondera** con logrado y posible acumulados en crudo. Promediar los porcentajes de las celdas daría otro número —una sucursal con un ítem pesaría igual que otra con cuarenta— y el pie no cerraría con la matriz.
- Cabecera de columna en `bg-primary-900` con el nombre y el total; fila de pie en `bg-primary-50` / `bg-primary-100`.
- Detalle: **fila expandida dentro de `<tbody>`** (`<td colSpan={unidades.length + 2}>`), con `<Fragment>` por fila para poder insertarla justo debajo de la elegida. Panel tonal `bg-slate-50` — blanco no se vería sobre la card blanca—, con cabeceras de módulo `bg-white` dentro. Tope de 40 renglones con «Ver más»; el subtotal del módulo se calcula sobre el total, no sobre lo mostrado.
- Los hallazgos se **agrupan por ítem** (`resumirFallasPorItem`) y no por evaluación: una fila por evaluación son cientos de renglones iguales y nadie cuenta a mano cuántas veces se cayó lo mismo. Cada ítem trae veces, unidades y —si es de checks— el nombre de cada check caído con su conteo (`checks` de `checksFallados`, que va aparte de `fallasDeResponsable` porque ése sólo nombra si le computa puntos, y una respuesta vieja sin selección por check igual tiene nombres). Orden por veces: lo que más se repite es lo primero que se puede corregir.
- Sin sombras ni bordes añadidos: la selección se marca con `border-2 border-primary` (los `<button>` escapan al aplanado de CSS, que sólo alcanza a `div/section/article/aside/nav/li/a`).

### FINISH

- **Estado de error explícito**: si la consulta falla se dice «No se pudieron cargar los datos» con botón Reintentar; nunca se juran ceros que no se verificaron. (En Indicadores y ModuloDashboard el `catch` se traga y cae en «sin datos» — ésta pantalla no repite ese error.)
- Estados cubiertos: carga (`SkeletonFilas`), vacío, sin resultados por búsqueda, error, selección.
- Tabla accesible: `<caption class="sr-only">`, `scope="col"` / `scope="row"`, `aria-pressed` y `aria-label` descriptivos en las celdas clicable.
- Contraste ≥4.5:1 en todo el texto corrido (verificado: verde-700 sobre verde-50, ámbar-800 sobre ámbar-100, rojo-700 sobre rojo-100, blanco sobre rojo-700, blanco sobre primary-900).
- Estado nunca sólo por color: toda celda lleva su número y su etiqueta accesible.
- Movimiento: sólo `transition-colors`; nada que no respete `prefers-reduced-motion`.
