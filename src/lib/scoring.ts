const ETIQUETAS_TIPO: Record<string, string> = {
  CHECKLIST: 'Check list',
  CUMPLE_NO_CUMPLE: 'Cumple / No cumple',
  CONCILIACION: 'Conciliación',
  LISTA_COLABORADORES: 'Listado de colaboradores',
  UNIDAD_CHECKLIST: 'Unidad check list'
}

export function etiquetaTipo(tipo: string): string {
  return ETIQUETAS_TIPO[tipo] ?? tipo
}

export { ETIQUETAS_TIPO }

export interface ValorChecklist {
  selected: string[]
  informativos?: string[]
  evidencias?: Record<string, { photoIds: string[] }>
}
export interface EvidenciaCumple {
  photoIds: string[]
  comentario: string
}
export interface ValorCumple {
  value: boolean | null
  evidencias: EvidenciaCumple[]
  informativo?: boolean
}
export interface ValorConciliacion {
  productos: ProductoConciliacion[]
  informativo?: boolean
}
export interface ProductoConciliacion {
  sku: string
  nombre: string | null
  teorica: number | null
  fisica: number | null
}

export interface ColaboradorItem {
  dni: number
  nationality?: string
  name: string
  lastname: string
  role_id?: string
  role_name?: string
  branch_id?: number
  branch_name?: string
  active: boolean
  aplica: boolean
  selected: string[]
}

export interface ValorListaColaboradores {
  colaboradores: ColaboradorItem[]
  informativo?: boolean
  loadedAt?: number
}

export interface UnidadChecklist {
  codigo: string
  selected: string[]
}

export interface ValorUnidadChecklist {
  unidades: UnidadChecklist[]
  informativo?: boolean
}

export function colaboradorCumple(colab: ColaboradorItem, opciones: { id: string }[] | null | undefined): boolean {
  const opts = (opciones ?? []) as { id: string }[]
  if (!opts.length) return false
  return opts.every((o) => (colab.selected ?? []).includes(o.id))
}

export function unidadCumple(unidad: UnidadChecklist, opciones: { id: string }[] | null | undefined): boolean {
  const opts = (opciones ?? []) as { id: string }[]
  if (!opts.length) return false
  return opts.every((o) => (unidad.selected ?? []).includes(o.id))
}

function ratioConciliacion(t: number, f: number): number | null {
  if (!(t > 0)) return null
  const mayor = Math.max(t, f)
  if (!(mayor > 0)) return 0
  const menor = Math.min(t, f)
  return Math.round((menor / mayor) * 100 * 100) / 100
}

export function conciliacionPorcentaje(p: { teorica?: number | null; fisica?: number | null } | null | undefined): number | null {
  const t = p?.teorica
  const f = p?.fisica
  if (typeof t !== 'number' || typeof f !== 'number') return null
  return ratioConciliacion(t, f)
}

export function conciliacionTotal(v: ValorConciliacion | null | undefined): number | null {
  const ps = v?.productos ?? []
  const pcts = ps.map((p) => conciliacionPorcentaje(p)).filter((x): x is number => x !== null)
  if (!pcts.length) return null
  const suma = pcts.reduce((a, x) => a + x, 0)
  return Math.round((suma / pcts.length) * 100) / 100
}

export function valorBinario(item: { tipo: string; opciones?: string[] | { id: string }[] | null }, valor: unknown): boolean | null {
  if (item.tipo === 'CUMPLE_NO_CUMPLE') {
    const v = valor as ValorCumple | null
    if (v?.informativo) return null
    return typeof v?.value === 'boolean' ? v.value : null
  }
  if (item.tipo === 'CONCILIACION') {
    const v = valor as ValorConciliacion | null
    if (v?.informativo) return null
    const ps = v?.productos ?? []
    if (!ps.length) return null
    for (const p of ps) {
      if (typeof p.teorica !== 'number' || typeof p.fisica !== 'number' || !(p.teorica > 0)) return null
      if (p.fisica !== p.teorica) return false
    }
    return true
  }
if (item.tipo === 'CHECKLIST') {
    const opts = ((item.opciones ?? []) as { id: string }[]).filter((o) => !((valor as ValorChecklist | null)?.informativos ?? []).includes(o.id))
    const sel = (valor as ValorChecklist | null)?.selected ?? []
    if (!opts.length || sel.length === 0) return null
    return opts.every((o) => sel.includes(o.id))
  }
  if (item.tipo === 'LISTA_COLABORADORES') {
    const v = valor as ValorListaColaboradores | null
    if (v?.informativo) return null
    const aplican = (v?.colaboradores ?? []).filter((c) => c.aplica)
    if (!aplican.length) return null
    const opts = (item.opciones ?? []) as { id: string }[]
    if (!opts.length) return null
    return aplican.every((c) => colaboradorCumple(c, opts))
  }
  if (item.tipo === 'UNIDAD_CHECKLIST') {
    const v = valor as ValorUnidadChecklist | null
    if (v?.informativo) return null
    const unidades = v?.unidades ?? []
    if (!unidades.length) return null
    const opts = (item.opciones ?? []) as { id: string }[]
    if (!opts.length) return null
    return unidades.every((u) => unidadCumple(u, opts))
  }
  return null
}

export interface AcumuladoResponsable {
  responsable: string
  puntos: number
}

export function incumplimientosPorResponsable(
  item: { tipo: string; opciones?: string[] | { id: string; responsable?: string }[] | null },
  valor: unknown
): AcumuladoResponsable[] {
  if (valorBinario(item, valor) === null) return []
  const puntos = ((item.opciones ?? []) as { id?: string; responsable?: string }[]).filter((o) => o.id && (o.responsable ?? '').trim())
  const acum = new Map<string, number>()
  const sumar = (responsable: string) => {
    const r = (responsable ?? '').trim()
    if (!r) return
    acum.set(r, (acum.get(r) ?? 0) + 1)
  }
  if (puntos.length) {
    if (item.tipo === 'CHECKLIST') {
      const v = valor as ValorChecklist | null
      const sel = v?.selected ?? []
      const informativos = v?.informativos ?? []
      for (const o of puntos) {
        if (!informativos.includes(o.id as string) && !sel.includes(o.id as string)) sumar(o.responsable ?? '')
      }
    } else if (item.tipo === 'LISTA_COLABORADORES') {
      const v = valor as ValorListaColaboradores | null
      for (const c of (v?.colaboradores ?? []).filter((x) => x.aplica)) {
        const sel = c.selected ?? []
        for (const o of puntos) {
          if (!sel.includes(o.id as string)) sumar(o.responsable ?? '')
        }
      }
    } else if (item.tipo === 'UNIDAD_CHECKLIST') {
      const v = valor as ValorUnidadChecklist | null
      for (const u of v?.unidades ?? []) {
        const sel = u.selected ?? []
        for (const o of puntos) {
          if (!sel.includes(o.id as string)) sumar(o.responsable ?? '')
        }
      }
    }
  }
  return Array.from(acum.entries())
    .map(([responsable, n]) => ({ responsable: responsable as string, puntos: n }))
    .sort((a, b) => b.puntos - a.puntos || a.responsable.localeCompare(b.responsable))
}

export function calcularPuntaje(
  respuestas: { item: { tipo: string; opciones?: string[] | { id: string }[] | null }; valor: unknown }[]
): number | null {
  const binarios = respuestas.map((r) => valorBinario(r.item, r.valor)).filter((x) => x !== null) as boolean[]
  if (binarios.length === 0) return null
  const ok = binarios.filter((b) => b).length
  return Math.round((ok / binarios.length) * 10000) / 100
}