/**
 * Markdown mínimo para la descripción de un ítem (`items.descripcion`).
 *
 * Sólo lo que hace falta para escribir ayuda de campo: **negrita**, *cursiva*,
 * listas con viñetas (y numeradas) y tablas GFM con pipes. No se acepta HTML:
 * el texto se guarda tal cual y acá se convierte en un AST de nodos que React
 * pinta como elementos, así que un `<script>` pegado en la descripción sale
 * como texto en pantalla, no como código. Sin dependencias, sin sanitizer y
 * testeable en node (el parser es puro).
 */

export type InlineMD =
  | { t: 'texto'; v: string }
  | { t: 'negrita'; hijos: InlineMD[] }
  | { t: 'cursiva'; hijos: InlineMD[] }

export type BloqueMD =
  | { t: 'parrafo'; hijos: InlineMD[] }
  | { t: 'lista'; ordenada: boolean; items: InlineMD[][] }
  | { t: 'tabla'; cabecera: InlineMD[][]; filas: InlineMD[][][] }

const VIÑETA = /^\s*[-*+]\s+(.*)$/
const NUMERADA = /^\s*\d+[.)]\s+(.*)$/
const FILA_TABLA = /^\s*\|.*\|\s*$/
const SEPARADOR_TABLA = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

/** ¿La línea `idx` abre una tabla: fila con pipes y la siguiente es el separador? */
function esInicioTabla(lineas: string[], idx: number): boolean {
  const actual = lineas[idx] ?? ''
  const siguiente = lineas[idx + 1] ?? ''
  return FILA_TABLA.test(actual) && SEPARADOR_TABLA.test(siguiente) && siguiente.includes('-')
}

function celdasDe(fila: string): string[] {
  return fila
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** `**negrita**` gana sobre `*cursiva*`: se parte primero por los dos asteriscos.
 *  El contenido es perezoso y puede traer asteriscos sueltos adentro, así que
 *  `**muy *importante***` se lee como negrita con cursiva y no se corta. */
function parsearInline(txt: string): InlineMD[] {
  const nodos: InlineMD[] = []
  txt.split(/\*\*([\s\S]+?)\*\*/g).forEach((parte, i) => {
    if (!parte) return
    if (i % 2 === 1) nodos.push({ t: 'negrita', hijos: parsearCursiva(parte) })
    else nodos.push(...parsearCursiva(parte))
  })
  return nodos
}

function parsearCursiva(txt: string): InlineMD[] {
  const nodos: InlineMD[] = []
  txt.split(/\*([^*]+)\*/g).forEach((parte, i) => {
    if (!parte) return
    if (i % 2 === 1) nodos.push({ t: 'cursiva', hijos: [{ t: 'texto', v: parte }] })
    else nodos.push({ t: 'texto', v: parte })
  })
  return nodos
}

export function parsearMarkdown(md: string): BloqueMD[] {
  const lineas = md.replace(/\r\n?/g, '\n').split('\n')
  const bloques: BloqueMD[] = []
  let i = 0

  while (i < lineas.length) {
    if (!lineas[i].trim()) {
      i++
      continue
    }

    // Tabla: fila de encabezado + fila separadora (`| --- |`) + filas de datos.
    if (esInicioTabla(lineas, i)) {
      const filas: string[][] = []
      while (i < lineas.length && FILA_TABLA.test(lineas[i])) {
        filas.push(celdasDe(lineas[i]))
        i++
      }
      const [, , ...cuerpo] = filas
      bloques.push({
        t: 'tabla',
        cabecera: (filas[0] ?? []).map(parsearInline),
        filas: cuerpo.map((fila) => fila.map(parsearInline))
      })
      continue
    }

    const esLista = VIÑETA.test(lineas[i]) || NUMERADA.test(lineas[i])
    if (esLista) {
      const ordenada = NUMERADA.test(lineas[i])
      const items: InlineMD[][] = []
      while (i < lineas.length) {
        const m = ordenada ? NUMERADA.exec(lineas[i]) : VIÑETA.exec(lineas[i])
        if (!m) break
        items.push(parsearInline(m[1]))
        i++
      }
      bloques.push({ t: 'lista', ordenada, items })
      continue
    }

    // Párrafo: se junta todo lo que siga hasta una línea en blanco, otra
    // lista o el inicio de una tabla. Los saltos de línea se conservan y el
    // render los pinta (antes el campo era un textarea con `pre-line`).
    const parrafo: string[] = []
    while (
      i < lineas.length &&
      lineas[i].trim() &&
      !esInicioTabla(lineas, i) &&
      !VIÑETA.test(lineas[i]) &&
      !NUMERADA.test(lineas[i])
    ) {
      parrafo.push(lineas[i])
      i++
    }
    if (parrafo.length) bloques.push({ t: 'parrafo', hijos: parsearInline(parrafo.join('\n')) })
  }

  return bloques
}

function planoDe(hijos: InlineMD[]): string {
  return hijos
    .map((h) => (h.t === 'texto' ? h.v : planoDe(h.hijos)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Los nodos en línea en texto corrido, para celdas de tabla y cualquier sitio
 * donde el formato no quepa (el PDF, `title`, `aria-label`).
 */
export function aTextoPlanoNodos(hijos: InlineMD[]): string {
  return planoDe(hijos)
}

/**
 * El mismo contenido en una línea, para lugares donde el formato no cabe:
 * la fila de Config → Ítems (que corta con `line-clamp`), `title` o `aria-label`.
 */
export function aTextoPlano(md: string): string {
  return parsearMarkdown(md)
    .map((b) => {
      if (b.t === 'parrafo') return planoDe(b.hijos)
      if (b.t === 'lista') return `• ${b.items.map((it) => planoDe(it)).join(' · ')}`
      return [
        b.cabecera.map(planoDe).join(' / '),
        ...b.filas.map((fila) => fila.map(planoDe).join(' / '))
      ].join(' · ')
    })
    .filter(Boolean)
    .join(' · ')
}

/* ------------------------------------------------------------------ *
 * Edición con los botones del editor. Todo puro: recibe el texto y la
 * selección y devuelve el texto nuevo con el cursor a ubicar, así se
 * prueba sin DOM y el componente sólo tiene que aplicar el resultado.
 * ------------------------------------------------------------------ */

export type Edicion = { texto: string; inicio: number; fin: number }

/**
 * Botón «Negrita»: envuelve la selección en `**…**` (o abre y cierra `****`
 * si no hay selección).
 *
 * La línea `[[Tabla N]]` queda fuera: si la selección la cruza, se envuelve
 * cada trozo de texto por separado, para que envolver en negrita no se lleve
 * la tabla puesta.
 */
export function envolverNegrita(texto: string, inicio: number, fin: number): Edicion {
  if (inicio === fin) {
    if (esMarcadorDeTabla(lineaEn(texto, inicio))) return { texto, inicio, fin }
    return {
      texto: `${texto.slice(0, inicio)}****${texto.slice(inicio)}`,
      inicio: inicio + 2,
      fin: inicio + 2
    }
  }

  const trozos = trozosSinMarcador(texto, inicio, fin)
  if (!trozos.length) return { texto, inicio, fin }

  let salida = texto
  // De atrás hacia adelante para no desfasar las posiciones ya calculadas.
  for (const t of [...trozos].reverse()) {
    salida = `${salida.slice(0, t.i)}**${salida.slice(t.i, t.f)}**${salida.slice(t.f)}`
  }
  const primero = trozos[0]
  const ultimo = trozos[trozos.length - 1]
  return {
    texto: salida,
    inicio: primero.i + 2,
    // 2 por la apertura de cada trozo y 2 por el cierre de cada uno menos
    // el último, que es donde termina la selección.
    fin: ultimo.f + 4 * trozos.length - 2
  }
}

/** Trozos de la selección que no son la línea de una tabla (con sus bordes). */
function trozosSinMarcador(texto: string, inicio: number, fin: number): { i: number; f: number }[] {
  const trozos: { i: number; f: number }[] = []
  let pos = 0
  for (const linea of lineasDe(texto)) {
    const finLinea = pos + linea.length
    if (pos < fin && finLinea > inicio && !esMarcadorDeTabla(linea)) {
      const i = Math.max(inicio, pos)
      const f = Math.min(fin, finLinea)
      if (f > i) trozos.push({ i, f })
    }
    pos = finLinea + 1
  }
  return trozos
}

/**
 * Botón «Viñeta»: prefija cada línea de la selección con `- ` (sin duplicar
 * el marcador si ya lo tiene). Sin selección sobre una línea vacía inserta
 * el marcador justo en el cursor.
 */
export function prefijarViñetas(texto: string, inicio: number, fin: number): Edicion {
  const desdeLinea = texto.lastIndexOf('\n', inicio - 1) + 1
  const finDeLinea = texto.indexOf('\n', fin)
  const hastaLinea = finDeLinea === -1 ? texto.length : finDeLinea
  const seleccion = texto.slice(desdeLinea, hastaLinea)

  if (!seleccion.trim()) {
    const nuevo = `${texto.slice(0, inicio)}- ${texto.slice(fin)}`
    return { texto: nuevo, inicio: inicio + 2, fin: inicio + 2 }
  }

  const marcadas = seleccion
    .split('\n')
    .map((l) => {
      if (!l.trim()) return l
      // La línea de la tabla no se toca: viñetearla la sacaría del formato
      // marcador y el texto se quedaría sin su tabla.
      if (esMarcadorDeTabla(l)) return l
      if (/^\s*([-*+]\s|\d+[.)]\s)/.test(l)) return l
      return `- ${l.replace(/^\s+/, '')}`
    })
    .join('\n')

  const nuevo = texto.slice(0, desdeLinea) + marcadas + texto.slice(hastaLinea)
  return { texto: nuevo, inicio: desdeLinea, fin: desdeLinea + marcadas.length }
}

/* ------------------------------------------------------------------ *
 * Tablas: modelo editable (la grilla del editor) ↔ líneas markdown.
 * El Líder nunca escribe pipes: llena la grilla y estos helpers serializan
 * el bloque dentro del texto y lo vuelven a leer para seguir editándolo.
 * ------------------------------------------------------------------ */

/** Celdas en crudo (sin formato) de una tabla, tal como las pide la grilla. */
export type ModeloTabla = { cabecera: string[]; filas: string[][] }

export function columnasDeTabla(m: ModeloTabla): number {
  return Math.max(1, m.cabecera.length, ...m.filas.map((f) => f.length))
}

/** Grilla nueva con encabezados «Columna N» y filas de datos vacías. */
export function nuevaTabla(columnas: number, filas: number): ModeloTabla {
  const cols = Math.max(1, Math.round(columnas))
  return {
    cabecera: Array.from({ length: cols }, (_, i) => `Columna ${i + 1}`),
    filas: Array.from({ length: Math.max(0, Math.round(filas)) }, () => Array.from({ length: cols }, () => ''))
  }
}

/** Tope de la grilla: filas y columnas que admiten los contadores. */
export const MAX_FILAS_TABLA = 100
export const MAX_COLUMNAS_TABLA = 8

function lineasDe(md: string): string[] {
  return md.replace(/\r\n?/g, '\n').split('\n')
}

/** Escribe el modelo como líneas GFM: encabezado, separador y filas de datos. */
export function serializarTabla(m: ModeloTabla): string[] {
  const cols = columnasDeTabla(m)
  // Un `|` dentro de una celda rompería el renglón al volver a leerlo: se
  // limpia acá al serializar y la grilla lo filtra al tipear.
  const celda = (v: string) => (v ?? '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
  const renglon = (celdas: string[]) =>
    `| ${Array.from({ length: cols }, (_, i) => celda(celdas[i] ?? '')).join(' | ')} |`
  return [
    renglon(m.cabecera),
    `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`,
    ...m.filas.map(renglon)
  ]
}

/**
 * Todas las tablas del texto con el rango de líneas que ocupan (0-based,
 * incluyendo la última). Ese rango es lo que permite reemplazar el bloque
 * entero desde la grilla sin tener que buscar los pipes en el texto.
 */
export function tablasDe(md: string): { desde: number; hasta: number; modelo: ModeloTabla }[] {
  const lineas = lineasDe(md)
  const salida: { desde: number; hasta: number; modelo: ModeloTabla }[] = []
  for (let i = 0; i < lineas.length; i++) {
    if (!esInicioTabla(lineas, i)) continue
    const desde = i
    while (i < lineas.length && FILA_TABLA.test(lineas[i])) i++
    const cuerpo = lineas.slice(desde, i).map(celdasDe)
    const [, , ...filas] = cuerpo
    salida.push({ desde, hasta: i - 1, modelo: { cabecera: cuerpo[0] ?? [], filas } })
  }
  return salida
}

/** Reescribe la tabla que ocupa `desde`…`hasta` con el modelo de la grilla. */
export function reemplazarTabla(md: string, desde: number, hasta: number, modelo: ModeloTabla): string {
  const lineas = lineasDe(md)
  return [...lineas.slice(0, desde), ...serializarTabla(modelo), ...lineas.slice(hasta + 1)].join('\n')
}

export function quitarTabla(md: string, desde: number, hasta: number): string {
  const lineas = lineasDe(md)
  return [...lineas.slice(0, desde), ...lineas.slice(hasta + 1)].join('\n')
}

/** Cambia una celda: `fila` 0 es el encabezado, 1..n las filas de datos. */
export function conCelda(m: ModeloTabla, fila: number, col: number, valor: string): ModeloTabla {
  const renglones = [m.cabecera, ...m.filas]
  if (fila < 0 || fila >= renglones.length || col < 0) return m
  const objetivo = [...renglones[fila]]
  while (objetivo.length <= col) objetivo.push('')
  objetivo[col] = valor
  renglones[fila] = objetivo
  return { cabecera: renglones[0], filas: renglones.slice(1) }
}

/** Agrega o saca filas de datos (mínimo 1, hasta `MAX_FILAS_TABLA`). */
export function conFilas(m: ModeloTabla, filas: number): ModeloTabla {
  const n = Math.min(MAX_FILAS_TABLA, Math.max(1, Math.round(filas)))
  const ancho = columnasDeTabla(m)
  const salida = m.filas.slice(0, n)
  while (salida.length < n) salida.push(Array.from({ length: ancho }, () => ''))
  return { cabecera: [...m.cabecera], filas: salida }
}

/** Agrega o saca columnas en todas las filas (mínimo 1, máximo 8). Las
 *  columnas nuevas del encabezado nacen rotuladas «Columna N», como la tabla
 *  recién insertada; las de datos, vacías. */
export function conColumnas(m: ModeloTabla, columnas: number): ModeloTabla {
  const n = Math.min(8, Math.max(1, Math.round(columnas)))
  const ajustar = (celdas: string[], nueva: (i: number) => string) => {
    const salida = celdas.slice(0, n)
    while (salida.length < n) salida.push(nueva(salida.length))
    return salida
  }
  return {
    cabecera: ajustar(m.cabecera, (i) => `Columna ${i + 1}`),
    filas: m.filas.map((fila) => ajustar(fila, () => ''))
  }
}

/**
 * Botón «Tabla»: planta una grilla de 3 columnas y 2 filas en el cursor, con
 * línea en blanco alrededor —dos tablas pegadas sin blanco se leerían como una
 * sola—. `linea` es el índice de la primera línea insertada, para poder
 * enfocar la grilla recién creada.
 */
export function plantillaTabla(texto: string, inicio: number, fin: number): Edicion & { linea: number } {
  const antes = texto.slice(0, inicio)
  const despues = texto.slice(fin)
  const prefijo = antes ? (antes.endsWith('\n\n') ? '' : antes.endsWith('\n') ? '\n' : '\n\n') : ''
  const sufijo = despues ? (despues.startsWith('\n\n') ? '' : despues.startsWith('\n') ? '\n' : '\n\n') : ''
  const bloque = serializarTabla(nuevaTabla(3, 2)).join('\n')
  const desde = antes.length + prefijo.length
  return {
    texto: `${antes}${prefijo}${bloque}${sufijo}${despues}`,
    inicio: desde + 2,
    fin: desde + 2 + 'Columna 1'.length,
    linea: (antes + prefijo).split('\n').length - 1
  }
}

/* ------------------------------------------------------------------ *
 * Caja de texto: la tabla no se muestra con pipes, se muestra como un
 * marcador. El texto real (con las tablas escritas) es el que se guarda en
 * `items.descripcion` y el que leen la evaluación y el detalle; la caja es
 * sólo una vista de edición y en su lugar se edita la grilla.
 * ------------------------------------------------------------------ */

/** Línea que ocupa una tabla dentro de la caja de texto. */
export function marcadorDeTabla(n: number): string {
  return `[[Tabla ${n}]]`
}

const MARCADOR = /^\s*\[\[Tabla (\d+)\]\]\s*$/

/** Nº de tabla que representa esa línea de la caja (si es un marcador). */
export function numeroDeTabla(linea: string): number | null {
  const m = MARCADOR.exec(linea)
  return m ? Number(m[1]) : null
}

function esMarcadorDeTabla(linea: string): boolean {
  return MARCADOR.test(linea)
}

/** Línea (con sus bordes) que contiene a la posición `pos`. */
function lineaEn(texto: string, pos: number): string {
  const desde = texto.lastIndexOf('\n', pos - 1) + 1
  const hasta = texto.indexOf('\n', pos)
  return texto.slice(desde, hasta === -1 ? texto.length : hasta)
}

/**
 * La descripción tal como se pinta en la caja: cada bloque de tabla se
 * reemplaza por su marcador, así no se ve ni se tipea un solo pipe.
 */
export function conMarcadoresDeTabla(md: string): string {
  const lineas = lineasDe(md)
  const tablas = tablasDe(md)
  const salida: string[] = []
  let i = 0
  let n = 0
  while (i < lineas.length) {
    const t = tablas[n]
    if (t && t.desde === i) {
      salida.push(marcadorDeTabla(n + 1))
      i = t.hasta + 1
      n++
      continue
    }
    salida.push(lineas[i])
    i++
  }
  return salida.join('\n')
}

/**
 * De vuelta, al guardar lo que se escribió en la caja: cada marcador se
 * sustituye por su tabla. Si el marcador se borra, se borra la tabla; si se
 * duplica, se duplica. Un marcador huérfano (`[[Tabla 9]]` sin tabla) queda
 * como texto.
 */
export function sinMarcadoresDeTabla(textoCaja: string, tablas: ModeloTabla[]): string {
  return lineasDe(textoCaja)
    .flatMap((linea) => {
      const n = numeroDeTabla(linea)
      const tabla = n ? tablas[n - 1] : undefined
      return tabla ? serializarTabla(tabla) : [linea]
    })
    .join('\n')
}

/**
 * Índice de línea del texto real que corresponde a una línea de la caja:
 * un marcador de la caja ocupa varias líneas del texto, y esto devuelve
 * cuántas se pasaron por arriba. Sirve para insertar una tabla nueva en el
 * lugar correcto aunque la caja muestre marcadores.
 */
export function lineaEnValor(textoValor: string, lineaCaja: number): number {
  const tablas = tablasDe(textoValor)
  const caja = lineasDe(conMarcadoresDeTabla(textoValor))
  let valor = 0
  for (let ic = 0; ic < caja.length && ic < lineaCaja; ic++) {
    const numero = numeroDeTabla(caja[ic])
    const t = numero ? tablas[numero - 1] : undefined
    valor += t ? t.hasta - t.desde + 1 : 1
  }
  return valor
}

/** Índice de caracteres del final de la línea `i` (sin contar su `\n`). */
export function finDeLinea(texto: string, i: number): number {
  const lineas = texto.split('\n')
  if (i >= lineas.length) return texto.length
  let pos = 0
  for (let k = 0; k < i; k++) pos += lineas[k].length + 1
  return Math.min(pos + lineas[i].length, texto.length)
}

/** Índice de caracteres donde empieza la línea `i`. */
export function inicioDeLinea(texto: string, i: number): number {
  const lineas = texto.split('\n')
  if (i <= 0) return 0
  if (i >= lineas.length) return texto.length
  return Math.min(lineas.slice(0, i).join('\n').length + 1, texto.length)
}
