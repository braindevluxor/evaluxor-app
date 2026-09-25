const ETIQUETAS_TIPO: Record<string, string> = {
  CHECKLIST: 'Check list',
  CUMPLE_NO_CUMPLE: 'Cumple / No cumple',
  CONCILIACION: 'Conciliación',
  LISTA_COLABORADORES: 'Listado de colaboradores',
  UNIDAD_CHECKLIST: 'Unidad check list',
  CONTENEDOR: 'Sección (grupo)'
}

export function etiquetaTipo(tipo: string): string {
  return ETIQUETAS_TIPO[tipo] ?? tipo
}

export { ETIQUETAS_TIPO }

export interface ValorChecklist {
  selected: string[]
  informativos?: string[]
  evidencias?: Record<string, { photoIds: string[] }>
  /** Valores numéricos ingresados para las opciones de tipo RANGO (id de la opción → valor). */
  valores?: Record<string, number>
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
  /** Cantidad teórica (soh) reportada por el sistema al escanear. */
  soh?: number | null
  /** Última sincronización del producto reportada por el sistema. */
  lastSync?: string | null
  /** Precio base final (pricing.finalBase) reportado por el sistema. */
  finalBase?: number | null
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
  // Tasa de productos sin coincidir: (productos donde física ≠ teórica) / (total
  // escaneados con ambas cantidades) × 100. Por lo tanto 0% = todo concilia y
  // 100% = ningún producto coincide.
  const ps = v?.productos ?? []
  const escaneados = ps.filter((p) => typeof p?.teorica === 'number' && typeof p?.fisica === 'number')
  if (!escaneados.length) return null
  const sinCoincidir = escaneados.filter((p) => p.fisica !== p.teorica).length
  return Math.round((sinCoincidir / escaneados.length) * 10000) / 100
}

/** Formatea el precio base final (pricing.finalBase) del sistema para mostrarlo en conciliación. */
export function formatearPrecioBase(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `$${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
}

/** Formatea la última sincronización (lastSync) del sistema; vuelve el texto crudo si no es una fecha válida. */
export function formatearLastSync(fecha: string | null | undefined): string {
  if (!fecha) return '—'
  const d = new Date(fecha)
  if (Number.isNaN(d.getTime())) return fecha
  return d.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * ¿Una opción del checklist está cumplida? Para opciones de tipo RANGO requiere
 * estar marcada y tener un valor numérico mayor o igual al mínimo aceptable.
 */
export function opcionCumplida(
  o: { tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number },
  valor: ValorChecklist | null | undefined,
  id: string
): boolean {
  const sel = (valor?.selected ?? []).includes(id)
  if (o.tipo_respuesta === 'RANGO') {
    if (!sel) return false
    const val = (valor?.valores ?? {})[id]
    return typeof val === 'number' && typeof o.minimo === 'number' && val >= o.minimo
  }
  return sel
}

export function valorBinario(item: { tipo: string; opciones?: string[] | { id: string; tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number }[] | null }, valor: unknown): boolean | null {
  if (item.tipo === 'CONTENEDOR') return null
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
    const v = valor as ValorChecklist | null
    const opts = ((item.opciones ?? []) as { id: string; tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number }[]).filter((o) => !(v?.informativos ?? []).includes(o.id))
    const sel = (v?.selected ?? [])
    if (!opts.length || sel.length === 0) return null
    return opts.every((o) => opcionCumplida(o, v, o.id))
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
  const opts = ((item.opciones ?? []) as { id: string; puntos?: number; tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number }[])
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
  const obtenido = relevantes.filter((o) => opcionCumplida(o, v, o.id)).reduce((a, o) => a + (o.puntos ?? 0), 0)
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
      const informativos = v?.informativos ?? []
      for (const o of puntos) {
        if (!informativos.includes(o.id as string) && !opcionCumplida(o as { tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number }, v, o.id as string)) sumar(o.responsable ?? '')
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

/** Redondea un puntaje a 3 decimales (mínimo razonable 0.001 por opción/ítem). */
export function redondear3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

export interface RespuestaItem {
  item: {
    tipo: string
    opciones?: string[] | { id: string }[] | null
    puntaje?: number | null
    id?: string
    padre_id?: string | null
  }
  valor: unknown
}

export interface BinarioConPuntaje {
  item: { id?: string; tipo?: string; padre_id?: string | null; puntaje?: number | null }
  /** Cumplimiento booleano (0/1) o proporción 0..1 para CHECKLIST con puntos por opción. null = sin puntuar (reservado para secciones ponderadas). */
  cumple: boolean | number | null
}

export interface EntradaPuntaje {
  item: BinarioConPuntaje['item']
  cumple: boolean | number | null
}

function normCumple(c: boolean | number | null | undefined): number {
  if (typeof c === 'number') return Number.isFinite(c) ? c : 0
  return c ? 1 : 0
}

/**
 * Agrega los puntajes de una lista de entradas (0-100). Reglas:
 * - Si nada tiene puntaje, cada entrada pesa 1 (porcentaje por cantidad de ítems).
 * - Secciones CONTENEDOR con puntaje > 0 y al menos un hijo respondido participan
 *   como grupo: su peso es el puntaje de la sección y su cumplimiento es el promedio
 *   ponderado del cumplimiento de sus hijos (puntaje del hijo × proporción).
 *   Los hijos de una sección ponderada no se cuentan por separado.
 * - Si la sección no aparece o no tiene peso, sus hijos se cuentan como ítems
 *   directos (comportamiento previo), para no perder puntos en datos existentes.
 */
export function agregarPuntaje(entradas: EntradaPuntaje[]): number | null {
  const hijosPorPadre = new Map<string, EntradaPuntaje[]>()
  for (const e of entradas) {
    if (e.item.padre_id && e.item.tipo !== 'CONTENEDOR') {
      const arr = hijosPorPadre.get(e.item.padre_id) ?? []
      arr.push(e)
      hijosPorPadre.set(e.item.padre_id, arr)
    }
  }

  const seccionIds = new Set<string>()
  for (const e of entradas) {
    if (e.item.tipo === 'CONTENEDOR' && e.item.id && pesoItem(e.item) > 0) {
      const hijos = hijosPorPadre.get(e.item.id) ?? []
      if (hijos.some((h) => h.cumple != null)) seccionIds.add(e.item.id)
    }
  }

  const modoPonderado = seccionIds.size > 0 || entradas.some((e) => e.item.tipo !== 'CONTENEDOR' && pesoItem(e.item) > 0)
  const peso = (item: { puntaje?: number | null }): number => (modoPonderado ? pesoItem(item) : 1)

  const unidades: { peso: number; cumple: number }[] = []
  const seccionesProcesadas = new Set<string>()
  for (const e of entradas) {
    const it = e.item
    if (it.tipo === 'CONTENEDOR') {
      if (!it.id || !seccionIds.has(it.id) || seccionesProcesadas.has(it.id)) continue
      seccionesProcesadas.add(it.id)
      const hijos = (hijosPorPadre.get(it.id) ?? []).filter((h) => h.cumple != null)
      if (!hijos.length) continue
      const tot = hijos.reduce((a, h) => a + peso(h.item), 0)
      const ganado = hijos.reduce((a, h) => a + peso(h.item) * normCumple(h.cumple), 0)
      unidades.push({ peso: peso(it), cumple: tot > 0 ? Math.min(1, ganado / tot) : 0 })
      continue
    }
    if (it.padre_id && seccionIds.has(it.padre_id)) continue
    if (e.cumple == null) continue
    unidades.push({ peso: peso(it), cumple: normCumple(e.cumple) })
  }

  const tot = unidades.reduce((a, u) => a + u.peso, 0)
  if (!(tot > 0)) return null
  const ok = unidades.reduce((a, u) => a + u.peso * u.cumple, 0)
  return Math.round((ok / tot) * 10000) / 100
}

export function puntajePonderado(binarios: BinarioConPuntaje[]): number | null {
  return agregarPuntaje(binarios)
}

/**
 * Agrega a la lista de binarios las secciones ponderadas que no la tengan pero sí
 * tengan hijos respondidos, para que participen como grupo en el puntaje agregado.
 * Útil en reportes (indicadores), donde las secciones no generan respuestas.
 */
export function conSeccionesPonderadas(
  items: { id?: string; tipo?: string; puntaje?: number | null }[] | undefined,
  binarios: BinarioConPuntaje[]
): BinarioConPuntaje[] {
  const secciones = (items ?? []).filter((i) => i.tipo === 'CONTENEDOR' && !!i.id && pesoItem(i) > 0)
  if (!secciones.length) return binarios
  const porId = new Map<string, { id?: string; tipo?: string; puntaje?: number | null }>(secciones.map((s) => [s.id as string, s]))
  const presentes = new Set(binarios.map((b) => b.item.id).filter(Boolean))
  const aAgregar: BinarioConPuntaje[] = []
  for (const [id, seccion] of porId) {
    if (presentes.has(id)) continue
    const tieneHijos = binarios.some((b) => b.item.padre_id === id && b.cumple != null)
    if (tieneHijos) aAgregar.push({ item: { id, tipo: seccion.tipo, puntaje: seccion.puntaje, padre_id: null }, cumple: null })
  }
  return aAgregar.length ? [...binarios, ...aAgregar] : binarios
}

export function calcularPuntaje(respuestas: RespuestaItem[]): number | null {
  return agregarPuntaje(
    respuestas.map((r) => ({
      item: r.item,
      cumple: r.item.tipo === 'CONTENEDOR' ? null : proporcionItem(r.item, r.valor)
    }))
  )
}