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
