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

/** Evidencia de una CONCILIACIÓN: las fotos viven arriba del valor, no por opción. Solo las ya subidas (paths del bucket). */
export function pathsEvidenciaConciliacion(valor: unknown): string[] {
  const v = valor as { productos?: unknown; paths?: unknown } | null
  if (!v || typeof v !== 'object' || !Array.isArray(v.productos)) return []
  if (!Array.isArray(v.paths)) return []
  return Array.from(new Set(v.paths.filter((p): p is string => typeof p === 'string')))
}
