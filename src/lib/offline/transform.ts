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

function isChecklistValor(valor: unknown): Record<string, string[]> | null {
  const v = valor as { selected?: string[]; evidencias?: Record<string, { photoIds?: unknown } | null> } | null
  if (!v || !Array.isArray(v.selected)) return null
  const evs = v.evidencias
  if (!evs || typeof evs !== 'object' || Array.isArray(evs)) return null
  const out: Record<string, string[]> = {}
  for (const [optId, e] of Object.entries(evs)) {
    const ids = e && Array.isArray(e.photoIds) ? e.photoIds.filter((x) => typeof x === 'string') : []
    if (ids.length) out[optId] = ids
  }
  return out
}

// Versión del valor sin fotos, para el auto-guardado en vivo del borrador
// (las fotos se suben cuando el evaluador envía la evaluación).
export function valorSinFotos(valor: unknown): unknown {
  const cumple = isCumpleValor(valor)
  if (cumple) {
    const v = valor as { value?: boolean | null; evidencias?: { comentario?: string }[]; informativo?: boolean }
    const out: Record<string, unknown> = {
      value: v.value ?? null,
      evidencias: (v.evidencias ?? []).map((e) => ({ comentario: e.comentario ?? '' }))
    }
    if (v.informativo) out.informativo = true
    return out
  }
  const checklist = isChecklistValor(valor)
  if (checklist) {
    const v = valor as { selected?: string[]; informativos?: string[]; evidencias?: unknown }
    const out: Record<string, unknown> = { selected: v.selected ?? [] }
    if ((v.informativos ?? []).length) out.informativos = v.informativos
    return out
  }
  if (isFotoValor(valor)) return { photoIds: [] }
  return valor
}

export function extraerPhotoIds(valor: unknown): string[] {
  const directos = isFotoValor(valor)
  if (directos) return directos
  const checklist = isChecklistValor(valor)
  if (checklist) return Object.values(checklist).flat()
  return isCumpleValor(valor)?.flat() ?? []
}

export function convertirValor(valor: unknown, map: Map<string, string>): unknown {
  const ids = isFotoValor(valor)
  if (ids) return { paths: ids.map((id) => map.get(id) ?? `.local/${id}`) }
  const cumpleIds = isCumpleValor(valor)
  if (cumpleIds) {
    const v = valor as { value?: boolean | null; evidencias?: { photoIds?: string[]; comentario?: string }[]; informativo?: boolean }
    const out: Record<string, unknown> = {
      value: v.value ?? null,
      evidencias: (v.evidencias ?? []).map((e, i) => ({
        comentario: e.comentario ?? '',
        paths: (cumpleIds[i] ?? []).map((id) => map.get(id) ?? `.local/${id}`)
      }))
    }
    if (v.informativo) out.informativo = true
    return out
  }
  const checklistIds = isChecklistValor(valor)
  if (checklistIds) {
    const v = valor as { selected?: string[]; informativos?: string[]; evidencias?: Record<string, { photoIds?: string[] } | null> }
    const evidencias: Record<string, unknown> = {}
    for (const [optId, ids] of Object.entries(checklistIds)) {
      evidencias[optId] = { paths: ids.map((id) => map.get(id) ?? `.local/${id}`) }
    }
    const out: Record<string, unknown> = {
      selected: v.selected ?? [],
      evidencias
    }
    if ((v.informativos ?? []).length) out.informativos = v.informativos
    return out
  }
  return valor
}