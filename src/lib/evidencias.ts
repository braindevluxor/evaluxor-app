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
