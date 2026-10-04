export function photoPath(evaluacionId: string, itemId: string, photoId: string): string {
  return `ev/${evaluacionId}/${itemId}/${photoId}.jpg`
}

function isFotoValor(valor: unknown): string[] | null {
  if (Array.isArray(valor)) return valor.filter((v) => typeof v === 'string') as string[]
  const v = valor as { photoIds?: string[] } | null
  if (v && Array.isArray(v.photoIds) && v.photoIds.every((x) => typeof x === 'string')) return v.photoIds
  return null
}

function isCumpleValor(valor: unknown): string[][] | null {
  const v = valor as { value?: boolean | null; evidencias?: { photoIds?: unknown; comentario?: unknown }[] } | null
  if (!v || (v.value != null && typeof v.value !== 'boolean') || !Array.isArray(v.evidencias)) return null
  return v.evidencias.map((e) => (Array.isArray(e.photoIds) ? e.photoIds.filter((x) => typeof x === 'string') : []))
}

function isPlanoValor(valor: unknown): { planos: { photoIds?: unknown }[] } | null {
  const v = valor as { planos?: unknown } | null
  if (!v || !Array.isArray(v.planos)) return null
  return v as { planos: { photoIds?: unknown }[] }
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

// Proyección sin IDs de fotos locales, para consumidores que explícitamente no
// deban incluir evidencias. El auto-guardado normal las sube y guarda sus rutas.
export function valorSinFotos(valor: unknown): unknown {
  const plano = isPlanoValor(valor)
  if (plano) {
    const v = valor as { planos: { id: string; nombre: string; photoIds?: string[] }[]; puntos?: unknown; informativo?: boolean }
    return {
      planos: v.planos.map((p) => ({ id: p.id, nombre: p.nombre, photoIds: [] })),
      puntos: v.puntos ?? [],
      ...(v.informativo ? { informativo: true } : {})
    }
  }
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
    const v = valor as { selected?: string[]; informativos?: string[]; valores?: Record<string, number>; evidencias?: unknown }
    const out: Record<string, unknown> = { selected: v.selected ?? [] }
    if ((v.informativos ?? []).length) out.informativos = v.informativos
    if (v.valores && Object.keys(v.valores).length) out.valores = v.valores
    return out
  }
  if (isFotoValor(valor)) return { photoIds: [] }
  return valor
}

export function extraerPhotoIds(valor: unknown): string[] {
  const plano = isPlanoValor(valor)
  if (plano) return plano.planos.flatMap((p) => (Array.isArray(p.photoIds) ? p.photoIds.filter((x) => typeof x === 'string') : []))
  const directos = isFotoValor(valor)
  if (directos) return directos
  const checklist = isChecklistValor(valor)
  if (checklist) return Object.values(checklist).flat()
  return isCumpleValor(valor)?.flat() ?? []
}

export function idsFotosRespuesta(
  respuestas: { valor: unknown }[],
  idsGuardados: string[] = []
): string[] {
  return Array.from(new Set([...idsGuardados, ...respuestas.flatMap((respuesta) => extraerPhotoIds(respuesta.valor))]))
}

export function convertirValor(valor: unknown, map: Map<string, string>): unknown {
  const plano = isPlanoValor(valor)
  if (plano) {
    const v = valor as { planos: { id: string; nombre: string; photoIds?: string[] }[]; puntos?: unknown; informativo?: boolean; responsables?: string[]; responsablesGerente?: string | null }
    const out: Record<string, unknown> = {
      planos: v.planos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        // La imagen del plano se sube al bucket como evidencia: al pintarle los pines
        // el evaluador carga el layout real de la sucursal, así que es su foto.
        paths: (p.photoIds ?? []).map((id) => map.get(id) ?? `.local/${id}`)
      })),
      puntos: v.puntos ?? []
    }
    if (v.informativo) out.informativo = true
    if (v.responsables?.length) out.responsables = v.responsables
    if (v.responsablesGerente !== undefined) out.responsablesGerente = v.responsablesGerente
    return out
  }
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
    const v = valor as { selected?: string[]; informativos?: string[]; valores?: Record<string, number>; evidencias?: Record<string, { photoIds?: string[] } | null> }
    const evidencias: Record<string, unknown> = {}
    for (const [optId, ids] of Object.entries(checklistIds)) {
      evidencias[optId] = { paths: ids.map((id) => map.get(id) ?? `.local/${id}`) }
    }
    const out: Record<string, unknown> = {
      selected: v.selected ?? [],
      evidencias
    }
    if ((v.informativos ?? []).length) out.informativos = v.informativos
    if (v.valores && Object.keys(v.valores).length) out.valores = v.valores
    return out
  }
  return valor
}