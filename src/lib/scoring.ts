const ETIQUETAS_TIPO: Record<string, string> = {
  CHECKLIST: 'Check list',
  COMENTARIO: 'Comentario',
  FOTO: 'Foto',
  CUMPLE_NO_CUMPLE: 'Cumple / No cumple',
  DESCRIPCION: 'Descripción',
  CANTIDAD: 'Cantidad',
  CONCILIACION: 'Conciliación'
}

export function etiquetaTipo(tipo: string): string {
  return ETIQUETAS_TIPO[tipo] ?? tipo
}

export { ETIQUETAS_TIPO }

export interface ValorChecklist {
  selected: string[]
}
export interface EvidenciaCumple {
  photoIds: string[]
  comentario: string
}
export interface ValorCumple {
  value: boolean | null
  evidencias: EvidenciaCumple[]
}
export interface ValorFoto {
  photoIds: string[]
}
export interface ValorConciliacion {
  productos: ProductoConciliacion[]
}
export interface ProductoConciliacion {
  sku: string
  nombre: string | null
  teorica: number | null
  fisica: number | null
}

export function conciliacionPorcentaje(p: { teorica?: number | null; fisica?: number | null } | null | undefined): number | null {
  const t = p?.teorica
  const f = p?.fisica
  if (typeof t !== 'number' || typeof f !== 'number' || !(t > 0)) return null
  return Math.round(Math.min(100, (f / t) * 100) * 100) / 100
}

export function conciliacionTotal(v: ValorConciliacion | null | undefined): number | null {
  const ps = v?.productos ?? []
  const validos = ps.filter((p) => typeof p.teorica === 'number' && typeof p.fisica === 'number' && (p.teorica ?? 0) > 0)
  if (!validos.length) return null
  const sumT = validos.reduce((a, p) => a + (p.teorica ?? 0), 0)
  const sumF = validos.reduce((a, p) => a + (p.fisica ?? 0), 0)
  if (!(sumT > 0)) return null
  return Math.round(Math.min(100, (sumF / sumT) * 100) * 100) / 100
}

export function valorBinario(item: { tipo: string; opciones?: string[] | { id: string }[] | null }, valor: unknown): boolean | null {
  if (item.tipo === 'CUMPLE_NO_CUMPLE') {
    const v = (valor as ValorCumple | null)?.value
    return typeof v === 'boolean' ? v : null
  }
  if (item.tipo === 'CONCILIACION') {
    const v = valor as ValorConciliacion | null
    const ps = v?.productos ?? []
    if (!ps.length) return null
    for (const p of ps) {
      if (typeof p.teorica !== 'number' || typeof p.fisica !== 'number' || !(p.teorica > 0)) return null
      if (p.fisica !== p.teorica) return false
    }
    return true
  }
  if (item.tipo === 'CHECKLIST') {
    const opts = (item.opciones ?? []) as { id: string }[]
    const sel = (valor as ValorChecklist | null)?.selected ?? []
    if (!opts.length || sel.length === 0) return null
    return opts.every((o) => sel.includes(o.id))
  }
  return null
}

export function calcularPuntaje(
  respuestas: { item: { tipo: string; opciones?: string[] | { id: string }[] | null }; valor: unknown }[]
): number | null {
  const binarios = respuestas.map((r) => valorBinario(r.item, r.valor)).filter((x) => x !== null) as boolean[]
  if (binarios.length === 0) return null
  const ok = binarios.filter((b) => b).length
  return Math.round((ok / binarios.length) * 10000) / 100
}