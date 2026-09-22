export function photoPath(offlineUuid: string, itemId: string, photoId: string): string {
  return `ev/${offlineUuid}/${itemId}/${photoId}.jpg`
}

function isFotoValor(valor: unknown): string[] | null {
  if (Array.isArray(valor)) return valor.filter((v) => typeof v === 'string') as string[]
  const v = valor as { photoIds?: string[] } | null
  if (v && Array.isArray(v.photoIds) && v.photoIds.every((x) => typeof x === 'string')) return v.photoIds
  return null
}

export function extraerPhotoIds(valor: unknown): string[] {
  return isFotoValor(valor) ?? []
}

export function convertirValor(valor: unknown, map: Map<string, string>): unknown {
  const ids = isFotoValor(valor)
  if (ids) return { paths: ids.map((id) => map.get(id) ?? `.local/${id}`) }
  return valor
}