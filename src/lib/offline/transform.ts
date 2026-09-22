export function photoPath(offlineUuid: string, itemId: string, photoId: string): string {
  return `ev/${offlineUuid}/${itemId}/${photoId}.jpg`
}

function isFotoValor(valor: unknown): string[] | null {
  if (Array.isArray(valor)) return valor.filter((v) => typeof v === 'string') as string[]
  const v = valor as { photoIds?: string[] } | null
  if (v && Array.isArray(v.photoIds) && v.photoIds.every((x) => typeof x === 'string')) return v.photoIds
  return null
}

function isCumpleValor(valor: unknown): string[][] | null {
  const v = valor as { value?: boolean | null; evidencias?: { photoIds?: unknown; comentario?: unknown }[] } | null
  if (!v || typeof v.value !== 'boolean' || !Array.isArray(v.evidencias)) return null
  return v.evidencias.map((e) => (Array.isArray(e.photoIds) ? e.photoIds.filter((x) => typeof x === 'string') : []))
}

export function extraerPhotoIds(valor: unknown): string[] {
  const directos = isFotoValor(valor)
  if (directos) return directos
  return isCumpleValor(valor)?.flat() ?? []
}

export function convertirValor(valor: unknown, map: Map<string, string>): unknown {
  const ids = isFotoValor(valor)
  if (ids) return { paths: ids.map((id) => map.get(id) ?? `.local/${id}`) }
  const cumpleIds = isCumpleValor(valor)
  if (cumpleIds) {
    const v = valor as { value?: boolean | null; evidencias?: { photoIds?: string[]; comentario?: string }[] }
    return {
      value: v.value ?? null,
      evidencias: (v.evidencias ?? []).map((e, i) => ({
        comentario: e.comentario ?? '',
        paths: (cumpleIds[i] ?? []).map((id) => map.get(id) ?? `.local/${id}`)
      }))
    }
  }
  return valor
}