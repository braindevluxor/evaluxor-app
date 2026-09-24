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

/**
 * Proporción de puntos cumplidos de un CHECKLIST cuya configuración reparte la
 * puntuación entre sus opciones (todas con `puntos` definidos y > 0).
 * Devuelve 0..1 (fracción de puntos obtenidos) o null cuando no aplica el modo
 * proporcional o la respuesta no es puntuable.
 */
export function proporcionChecklist(
  item: { tipo?: string; opciones?: string[] | { id: string; puntos?: number }[] | null },
  valor: unknown
): number | null {
  const v = valor as ValorChecklist | null
  const opts = ((item.opciones ?? []) as { id: string; puntos?: number }[])
  if (!opts.length) return null
  const informativos = v?.informativos ?? []
  const relevantes = opts.filter((o) => !informativos.includes(o.id))
  if (!relevantes.length) return null
  // Solo entra en modo proporcional si TODAS las opciones relevantes tienen puntos.
  if (relevantes.some((o) => typeof o.puntos !== 'number' || !(o.puntos > 0))) return null
  const sel = (v?.selected ?? []).filter((id) => relevantes.some((o) => o.id === id))
  if (!sel.length) return null // sin respuesta → excluido del cálculo
  const total = relevantes.reduce((a, o) => a + (o.puntos ?? 0), 0)
  if (!(total > 0)) return null
  const obtenido = relevantes.filter((o) => sel.includes(o.id)).reduce((a, o) => a + (o.puntos ?? 0), 0)
  return Math.min(1, obtenido / total)
}

/** Proporción 0..1 de cumplimiento de un ítem (1 = cumple, 0 = no cumple, parcial para CHECKLIST con puntos). null = no puntuable. */
export function proporcionItem(
  item: { tipo: string; opciones?: string[] | { id: string; puntos?: number }[] | null },
  valor: unknown
): number | null {
  if (item.tipo === 'CHECKLIST') {
    const p = proporcionChecklist(item, valor)
    if (p !== null) return p
  }
  const b = valorBinario(item, valor)
  return b === null ? null : b ? 1 : 0
}

/** Suma de proporciones y cantidad de ítems puntuables de una lista de respuestas. */
export function itemsProporcion(vals: { item: { tipo: string; opciones?: string[] | { id: string; puntos?: number }[] | null }; valor: unknown }[]): { ok: number; total: number } {
  const props = vals.map((v) => proporcionItem(v.item, v.valor)).filter((x): x is number => x !== null)
  return { ok: props.reduce((a, b) => a + b, 0), total: props.length }
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

export function pesoItem(item: { puntaje?: number | null } | null | undefined): number {
  const p = item?.puntaje ?? 0
  return typeof p === 'number' && p > 0 ? p : 0
}

export interface RespuestaItem {
  item: { tipo: string; opciones?: string[] | { id: string }[] | null; puntaje?: number | null }
  valor: unknown
}

export interface BinarioConPuntaje {
  item: { puntaje?: number | null }
  /** Cumplimiento booleano (0/1) o proporción 0..1 para CHECKLIST con puntos por opción. */
  cumple: boolean | number
}

export function puntajePonderado(binarios: BinarioConPuntaje[]): number | null {
  if (binarios.length === 0) return null
  const totalPeso = binarios.reduce((a, b) => a + pesoItem(b.item), 0)
  const peso = totalPeso > 0 ? (b: BinarioConPuntaje) => pesoItem(b.item) : () => 1
  const ok = binarios.reduce((a, b) => a + peso(b) * (typeof b.cumple === 'number' ? b.cumple : b.cumple ? 1 : 0), 0)
  const tot = binarios.reduce((a, b) => a + peso(b), 0)
  return tot > 0 ? Math.round((ok / tot) * 10000) / 100 : null
}

export function calcularPuntaje(respuestas: RespuestaItem[]): number | null {
  const conPuntaje = respuestas
    .map((r) => ({ item: r.item, proporcion: proporcionItem(r.item, r.valor) }))
    .filter((x): x is { item: RespuestaItem['item']; proporcion: number } => x.proporcion !== null)
  return puntajePonderado(conPuntaje.map((x) => ({ item: x.item, cumple: x.proporcion })))
}