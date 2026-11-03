export function pathsEvidenciaOpcion(valor: unknown): string[] {
  const v = valor as { paths?: unknown; photoIds?: unknown } | null
  const paths = Array.isArray(v?.paths) ? v.paths : Array.isArray(v?.photoIds) ? v.photoIds : []
  return paths.filter((path): path is string => typeof path === 'string')
}

export function pathsEvidenciaCumple(valor: unknown): string[] {
  const evidencias = (valor as { evidencias?: unknown } | null)?.evidencias
  if (!Array.isArray(evidencias)) return []
  return Array.from(new Set(evidencias.flatMap(pathsEvidenciaOpcion)))
}

export function pathsEvidenciaChecklist(valor: unknown): string[] {
  const evidencias = (valor as { evidencias?: unknown } | null)?.evidencias
  if (!evidencias || typeof evidencias !== 'object' || Array.isArray(evidencias)) return []
  return Array.from(new Set(Object.values(evidencias).flatMap(pathsEvidenciaOpcion)))
}

/**
 * Evidencia de **un producto** de una conciliación: las fotos están casadas al
 * SKU, adentro de `productos[i]`. Solo las ya subidas (`paths` del bucket): los
 * `photoIds` son ids locales de un teléfono y no son rutas.
 */
export function pathsEvidenciaProducto(producto: unknown): string[] {
  if (!producto || typeof producto !== 'object' || Array.isArray(producto)) return []
  const paths = (producto as { paths?: unknown }).paths
  if (!Array.isArray(paths)) return []
  return Array.from(new Set(paths.filter((p): p is string => typeof p === 'string')))
}

/**
 * Toda la evidencia de una CONCILIACIÓN: la suma de la de cada producto
 * escaneado (más `paths` de nivel valor si quedara alguna de una versión vieja).
 */
export function pathsEvidenciaConciliacion(valor: unknown): string[] {
  const v = valor as { productos?: unknown; paths?: unknown } | null
  if (!v || typeof v !== 'object' || !Array.isArray(v.productos)) return []
  const heredadas = Array.isArray(v.paths)
    ? v.paths.filter((p): p is string => typeof p === 'string')
    : []
  return Array.from(new Set([...heredadas, ...v.productos.flatMap(pathsEvidenciaProducto)]))
}

/**
 * TODAS las fotos que le corresponden a UNA FALLA: las del punto que le
 * fallaron a ese responsable, no las del ítem entero.
 *
 * POR QUÉ NO ES «LAS DEL ÍTEM» (a diferencia de la fila del detalle)
 * ------------------------------------------------------------------
 * En los ítems de lista cada punto tiene su propio responsable y su propia foto:
 * `valor.evidencias[idDelPunto]`. Si se juntaran las del ítem, el reporte de un
 * cargo le imprimiría evidencia de puntos que no le pertenecen — la foto de un
 * punto que falló otro — y perdería la única razón de existir del reporte por
 * cargos: lo que SÍ le toca a cada uno.
 *
 * Por eso, en tipos por punto (`CHECKLIST`, `LISTA_COLABORADORES`,
 * `UNIDAD_CHECKLIST`) sólo se leen las fotos de los `checkIds` que fallaron y
 * que ya vienen atribuidos a este responsable (`FallaResponsable.checkIds`), y
 * NO las de la tabla `fotos`: esa tabla guarda la foto contra el `item_id` y
 * no sabe de qué punto es.
 *
 * En los tipos de ítem completo (CUMPLE_NO_CUMPLE, CONCILIACION, PLANO_XY…) la
 * atribución es del ítem entero, así que entran todas, como las pinta la
 * pantalla: la de la tabla más las guardadas en el valor.
 *
 * `respuestas` puede venir vacío (un ítem sin respuestas tiene sólo sus fotos
 * de tabla) y `pathsDeTabla` también.
 */
export function pathsDeFotosFalla(
  tipoItem: string | undefined,
  checkIds: string[],
  respuestas: { valor: unknown }[],
  pathsDeTabla: string[]
): string[] {
  const esPorPunto = tipoItem === 'CHECKLIST' || tipoItem === 'LISTA_COLABORADORES' || tipoItem === 'UNIDAD_CHECKLIST'
  if (esPorPunto) {
    const porCheck = respuestas.flatMap((r) => {
      const ev = (r.valor as { evidencias?: unknown } | null)?.evidencias
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return []
      const record = ev as Record<string, unknown>
      return checkIds.flatMap((id) => pathsEvidenciaOpcion(record[id]))
    })
    return Array.from(new Set(porCheck))
  }

  const guardados = respuestas.flatMap((r) =>
    tipoItem === 'CUMPLE_NO_CUMPLE'
      ? pathsEvidenciaCumple(r.valor)
      : tipoItem === 'CONCILIACION'
        ? pathsEvidenciaConciliacion(r.valor)
        : []
  )
  return Array.from(new Set([...pathsDeTabla, ...guardados]))
}

/**
 * Lo que el reporte imprime POR PUNTO de un pendiente: sus fotos y la
 * observación que el evaluador dejó pegada a ese punto.
 *
 * Es la misma información que `pathsDeFotosFalla`, pero agrupada y con el
 * texto al lado: el informe general ya muestra la observación de cada punto
 * (columna «Comentario» del check list, «Comentarios» de trabajadores y
 * unidades, y los `•` de las evidencias) y el reporte por cargos no imprimía
 * ninguna. Acá se resuelven las DOS orillas —foto y observación— juntas,
 * porque las dos viven en el mismo punto y separarlas haría que el documento
 * pusiera una foto debajo de una observación que no le pertenece.
 *
 * Dos formas según el tipo de ítem, igual que en el resto de la app:
 *
 *  * **Por punto** (check list, unidad check list, listado de trabajadores):
 *    un bloque por cada `checkId` que falló, con SU foto y SU observación.
 *    La observación está en `valor.comentarios[id]` y, en los dos tipos que
 *    se responden por unidad o por trabajador, en el diccionario de cada una
 *    de ellas (varias pueden decir lo mismo del mismo punto: se unen con `|`).
 *  * **Ítem entero** (cumple/no cumple, conciliación…): la falla es el ítem,
 *    así que cada fila de `evidencias` es un bloque con SU observación y SUS
 *    fotos —que es exactamente como las arma la pantalla (`EvidenciasEditor`:
 *    foto + comentario)— y las fotos de la tabla `fotos`, que no saben de qué
 *    evidencia son, van en un bloque propio sin observación.
 *
 * El orden de `fotos` planas es el de siempre (tabla primero, después las
 * evidencias): `pathsDeFotosFalla` se mantiene como la vista aplanada de
 * éste y sus pruebas siguen cubriendo la selección por tipo.
 */
export interface EvidenciaPunto {
  /** Id de la opción (el punto); null cuando la falla es del ítem entero. */
  checkId: string | null
  /** Nombre del punto, tal como lo muestra el detalle. Vacío si no hay con qué nombrarlo. */
  punto: string
  /** Observación adjunta al punto; vacío si no dejó ninguna. */
  comentario: string
  /** Fotos de ESTE punto, sin repetir. */
  fotos: string[]
}

export interface EvidenciasDeFalla {
  /** Tipo del ítem, para elegir dónde mirar. */
  tipo: string | undefined
  /** Ids de los puntos que fallaron a este responsable (los de `FallaResponsable`). */
  checkIds: string[]
  /** Los MISMOS puntos por nombre, en el mismo orden, para poder imprimirlos. */
  checks: string[]
  /** Respuestas del ítem (puede venir vacío: un ítem sin respuesta no tiene evidencia). */
  respuestas: { valor: unknown }[]
  /** Fotos de la tabla `fotos`, que se guardan contra el ítem y no contra un punto. */
  pathsDeTabla: string[]
}

export function evidenciasDeFalla(datos: EvidenciasDeFalla): EvidenciaPunto[] {
  const { tipo, checkIds, checks, respuestas, pathsDeTabla } = datos
  const esPorPunto = tipo === 'CHECKLIST' || tipo === 'LISTA_COLABORADORES' || tipo === 'UNIDAD_CHECKLIST'
  const bloques: EvidenciaPunto[] = []

  if (esPorPunto) {
    // Los nombres van en el MISMO orden que los ids (`FallaResponsable` lo
    // documenta así). Si alguna vez las dos listas no vienen alineadas —un
    // punto con el mismo nombre que otro hace que `checks` venga más corta—
    // se imprime SIN rótulo: una foto debajo del nombre de otro punto sería
    // peor que una foto sin nombre.
    const alineados = checks.length === checkIds.length
    for (const [i, id] of checkIds.entries()) {
      const fotos: string[] = []
      const observaciones: string[] = []
      for (const r of respuestas) {
        fotos.push(...pathsDeFotosFalla(tipo, [id], [r], []))
        observaciones.push(...comentariosDelPunto(tipo, r.valor, id))
      }
      bloques.push({
        checkId: id,
        punto: alineados ? (checks[i] ?? '') : '',
        comentario: unir(observaciones),
        fotos: sinRepetir(fotos)
      })
    }
    return sinFotosRepetidas(bloques)
  }

  // Ítem entero: primero las de la tabla (como siempre se imprimieron) y
  // después, una por fila, las de cada evidencia con su observación.
  if (pathsDeTabla.length) {
    bloques.push({ checkId: null, punto: '', comentario: '', fotos: sinRepetir(pathsDeTabla) })
  }

  let huboEvidencias = false
  for (const r of respuestas) {
    const lista = (r.valor as { evidencias?: unknown } | null)?.evidencias
    if (!Array.isArray(lista)) continue
    for (const ev of lista) {
      huboEvidencias = true
      bloques.push({
        checkId: null,
        punto: '',
        comentario: comentarioDeEvidencia(ev),
        fotos: pathsEvidenciaOpcion(ev)
      })
    }
  }

  // Tipos sin evidencias por fila (conciliación): sus fotos viven en otra
  // parte del valor y salen todas juntas, como hasta ahora.
  if (!huboEvidencias) {
    const juntas = respuestas.flatMap((r) =>
      tipo === 'CONCILIACION' ? pathsEvidenciaConciliacion(r.valor) : []
    )
    if (juntas.length) bloques.push({ checkId: null, punto: '', comentario: '', fotos: juntas })
  }

  return sinFotosRepetidas(bloques)
}

/** La observación de una fila de `evidencias` (el «Comentario de la evidencia…»). */
function comentarioDeEvidencia(ev: unknown): string {
  const texto = (ev as { comentario?: unknown } | null)?.comentario
  return typeof texto === 'string' ? texto.trim() : ''
}

/** Las observaciones de UN punto, según dónde se guarden en ese tipo de ítem. */
function comentariosDelPunto(tipo: string | undefined, valor: unknown, id: string): string[] {
  const leer = (comentarios: unknown): string[] => {
    if (!comentarios || typeof comentarios !== 'object' || Array.isArray(comentarios)) return []
    const texto = (comentarios as Record<string, unknown>)[id]
    return typeof texto === 'string' && texto.trim() ? [texto.trim()] : []
  }
  const v = valor as
    | {
        comentarios?: unknown
        unidades?: { comentarios?: unknown }[]
        colaboradores?: { comentarios?: unknown }[]
      }
    | null
  if (!v) return []
  if (tipo === 'UNIDAD_CHECKLIST') {
    return Array.isArray(v.unidades) ? v.unidades.flatMap((u) => leer(u?.comentarios)) : []
  }
  if (tipo === 'LISTA_COLABORADORES') {
    return Array.isArray(v.colaboradores) ? v.colaboradores.flatMap((c) => leer(c?.comentarios)) : []
  }
  return leer(v.comentarios)
}

/** Textos distintos, sin vacíos, en una sola línea. */
function unir(textos: string[]): string {
  return Array.from(new Set(textos.map((t) => t.trim()).filter(Boolean))).join(' | ')
}

/** Rutas distintas, conservando el orden de aparición. */
function sinRepetir(rutas: string[]): string[] {
  return Array.from(new Set(rutas))
}

/**
 * La misma foto no puede salir dos veces: si está en la tabla `fotos` y
 * también en la evidencia del ítem, un bloque la llevaría y el otro también.
 */
function sinFotosRepetidas(bloques: EvidenciaPunto[]): EvidenciaPunto[] {
  const vistas = new Set<string>()
  return bloques.map((bloque) => ({
    ...bloque,
    fotos: bloque.fotos.filter((ruta) => {
      if (vistas.has(ruta)) return false
      vistas.add(ruta)
      return true
    })
  }))
}
