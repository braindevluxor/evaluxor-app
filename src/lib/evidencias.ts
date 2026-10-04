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
