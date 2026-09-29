const ETIQUETAS_TIPO: Record<string, string> = {
  CHECKLIST: 'Check list',
  CUMPLE_NO_CUMPLE: 'Cumple / No cumple',
  CONCILIACION: 'Conciliación',
  LISTA_COLABORADORES: 'Listado de colaboradores',
  UNIDAD_CHECKLIST: 'Unidad check list',
  PLANO_XY: 'Cumplimiento XY',
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
  /** Responsables elegidos por el evaluador para atribuir una FALLA del ítem: cada uno absorbe el punto fallado. */
  responsables?: string[]
  /** Responsables elegidos por el evaluador por cada check INCUMPLIDO: check → responsables que absorben la falla. */
  responsablesPorOpcion?: Record<string, string[]>
  /** Nombre del gerente de la sucursal, horneado al responder: destino por defecto de los puntos incumplidos. */
  responsablesGerente?: string | null
}
export interface EvidenciaCumple {
  photoIds: string[]
  comentario: string
}
export interface ValorCumple {
  value: boolean | null
  evidencias: EvidenciaCumple[]
  informativo?: boolean
  /** Responsables elegidos por el evaluador para atribuir una FALLA del ítem: cada uno absorbe el punto fallado. */
  responsables?: string[]
  /** Nombre del gerente de la sucursal, horneado al responder: destino por defecto de los puntos incumplidos. */
  responsablesGerente?: string | null
}
/** Dato del sistema usado como referencia ("contra dato") en una conciliación: stock teórico (soh) o precio base (finalBase). */
export type ContraDatoConciliacion = 'SOH' | 'FINAL_BASE'

export const ETIQUETAS_CONTRA_DATO: Record<ContraDatoConciliacion, string> = {
  SOH: 'SOH (stock)',
  FINAL_BASE: 'Precio base'
}

export interface ValorConciliacion {
  productos: ProductoConciliacion[]
  /** Contra qué dato del sistema se calcula la conciliación de cada producto (soh → stock, finalBase → precio). */
  contraDato?: ContraDatoConciliacion
  informativo?: boolean
  /** Responsables elegidos por el evaluador para atribuir una FALLA del ítem: cada uno absorbe el punto fallado. */
  responsables?: string[]
  /** Nombre del gerente de la sucursal (horneado al responder): destino por defecto de los puntos incumplidos. */
  responsablesGerente?: string | null
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

/** Referencia contra la que se compara la física: el contra dato elegido (soh → stock, finalBase → precio) o, si falta, la teórica ya cargada. */
export function referenciaConciliacion(
  p: { teorica?: number | null; soh?: number | null; finalBase?: number | null } | null | undefined,
  contraDato: ContraDatoConciliacion = 'SOH'
): number | null {
  if (!p) return null
  const dato = contraDato === 'FINAL_BASE' ? p.finalBase : p.soh
  if (typeof dato === 'number') return dato
  return p.teorica ?? null
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
  admission_date?: string | null
  active: boolean
  aplica: boolean
  selected: string[]
  /** Responsables elegidos por el evaluador por cada check INCUMPLIDO DE ESTE TRABAJADOR: check → responsables que absorben la falla. */
  responsablesPorOpcion?: Record<string, string[]>
}

export interface ValorListaColaboradores {
  colaboradores: ColaboradorItem[]
  informativo?: boolean
  loadedAt?: number
  /** Responsables elegidos por el evaluador a nivel de ítem (modo binario): cada uno recibe el punto completo. */
  responsables?: string[]
  /** Responsables elegidos por el evaluador por cada check INCUMPLIDO: check → responsables que absorben la falla. */
  responsablesPorOpcion?: Record<string, string[]>
  /** Nombre del gerente de la sucursal, horneado al responder: destino por defecto de los puntos incumplidos. */
  responsablesGerente?: string | null
}

export interface UnidadChecklist {
  codigo: string
  selected: string[]
}

export interface ValorUnidadChecklist {
  unidades: UnidadChecklist[]
  informativo?: boolean
  /** Responsables elegidos por el evaluador a nivel de ítem (modo binario): cada uno recibe el punto completo. */
  responsables?: string[]
  /** Responsables elegidos por el evaluador por cada check INCUMPLIDO: check → responsables que absorben la falla. */
  responsablesPorOpcion?: Record<string, string[]>
  /** Nombre del gerente de la sucursal, horneado al responder: destino por defecto de los puntos incumplidos. */
  responsablesGerente?: string | null
}

/** Imagen del plano (layout) de un ítem PLANO_XY: la sube el evaluador dentro de la evaluación. */
export interface PlanoImagen {
  id: string
  /** Nombre del archivo, para distinguir plantas (ej. "Planta baja", "Mezanine"). */
  nombre: string
  /** En el borrador local: ids de las fotos en IndexedDB. Ya sincronizado: rutas del bucket. */
  photoIds?: string[]
  paths?: string[]
}

/** Punto marcado sobre el plano: coordenadas normalizadas 0..1 + veredicto y comentario. */
export interface PuntoPlano {
  id: string
  planoId: string
  x: number
  y: number
  cumple: boolean | null
  comentario: string
}

export interface ValorPlano {
  planos: PlanoImagen[]
  puntos: PuntoPlano[]
  informativo?: boolean
  /** Responsables elegidos por el evaluador a nivel de ítem (modo binario): cada uno recibe el punto completo. */
  responsables?: string[]
  /** Nombre del gerente de la sucursal, horneado al responder. */
  responsablesGerente?: string | null
}

/** ¿El punto tiene veredicto (cumple / no cumple)? Los pines sin marcar no puntúan. */
export function puntoMarcado(p: PuntoPlano | null | undefined): boolean {
  return p?.cumple === true || p?.cumple === false
}

/** Puntos con veredicto del ítem PLANO_XY. */
export function puntosMarcadosPlano(valor: ValorPlano | null | undefined): PuntoPlano[] {
  return (valor?.puntos ?? []).filter((p) => puntoMarcado(p))
}

/**
 * Proporción 0..1 de un PLANO_XY: pines que cumplen sobre pines marcados
 * (11 de 15 → 0.7333). null = sin pines con veredicto (no puntúa) o informativo.
 */
export function proporcionPlano(valor: ValorPlano | null | undefined): number | null {
  if (valor?.informativo) return null
  const marcados = puntosMarcadosPlano(valor)
  if (!marcados.length) return null
  return marcados.filter((p) => p.cumple === true).length / marcados.length
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
  if (item.tipo === 'PLANO_XY') {
    const v = valor as ValorPlano | null
    if (v?.informativo) return null
    // Sin pines con veredicto no hay veredicto del ítem. Con pines marcados, cumple
    // solo si ninguno quedó en "no cumple" (el puntaje fino va en proporcionPlano).
    const marcados = puntosMarcadosPlano(v)
    if (!marcados.length) return null
    return marcados.every((p) => p.cumple === true)
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

/** Proporción 0..1 de cumplimiento de un ítem (1 = cumple, 0 = no cumple, parcial para CHECKLIST con puntos y PLANO_XY por pines). null = no puntuable. */
export function proporcionItem(
  item: { tipo: string; opciones?: string[] | { id: string; puntos?: number }[] | null },
  valor: unknown
): number | null {
  if (item.tipo === 'CHECKLIST') {
    const p = proporcionChecklist(item, valor)
    if (p !== null) return p
  }
  if (item.tipo === 'PLANO_XY') {
    const p = proporcionPlano(valor as ValorPlano | null)
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

export interface ValorResponsable {
  responsable: string
  /** Cantidad de ítems ponderados en los que participa. */
  items: number
  /** Puntos posibles: reparto del valor de cada ítem entre quienes participan (peso del ítem ÷ nº de responsables del ítem). El 100% propio del responsable. */
  posible: number
  /** Puntos logrados en la evaluación (posible × proporción del ítem por cada muestra respondida). */
  logrado: number
  /** Logrado / posible × 100. null si no tiene puntos posibles. */
  porciento: number | null
}

/**
 * Responsables de un check: la lista `responsables` (admite varios) unida al campo
 * `responsable` de las opciones guardadas antes del cambio. Sin repetidos ni vacíos.
 */
export function responsablesDeOpcion(
  opcion: { responsable?: string | null; responsables?: string[] | null } | null | undefined
): string[] {
  if (!opcion) return []
  const base = [...(opcion.responsables ?? []), opcion.responsable ?? '']
  return [...new Set(base.map((x) => (x ?? '').trim()).filter(Boolean))]
}

/** Responsables que participan en un ítem: los que están asignados a sus checks (opciones); si ningún check tiene responsable, la lista del ítem. */
function responsablesDelItem(item: { opciones?: string[] | { id?: string; responsable?: string }[] | null; responsables?: string[] | null }): string[] {
  const porOpciones = ((item.opciones ?? []) as { responsable?: string; responsables?: string[] }[]).flatMap((o) => responsablesDeOpcion(o))
  const base = porOpciones.length ? porOpciones : item.responsables ?? []
  return [...new Set(base.map((x) => x.trim()).filter(Boolean))]
}

/** ¿El valor trae la selección nueva de responsables del evaluador (por ítem o por check)? Su ausencia = comportamiento legado retrocompatible. También detecta la selección guardada por cada colaborador en LISTA_COLABORADORES. */
export function tieneSeleccionResponsables(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as Record<string, unknown>
  if (
    Array.isArray(v.responsables) ||
    (v.responsablesPorOpcion != null && typeof v.responsablesPorOpcion === 'object') ||
    'responsablesGerente' in v
  ) {
    return true
  }
  // LISTA_COLABORADORES: la selección por check puede vivir en cada colaborador.
  if (Array.isArray(v.colaboradores)) {
    return (v.colaboradores as unknown[]).some(
      (c) => c != null && typeof c === 'object' && (c as { responsablesPorOpcion?: unknown }).responsablesPorOpcion != null
    )
  }
  return false
}

/** Selección de responsables por ítem (modo binario) guardada en el valor. */
function getRespArray(valor: unknown): string[] {
  const v = valor as { responsables?: unknown } | null
  return Array.isArray(v?.responsables) ? v.responsables : []
}

type OpcionScoring = { id?: string; puntos?: number; tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number; responsable?: string | null; responsables?: string[] | null }

/** ¿Un check puntúa (está cumplido) según el tipo de ítem y el valor? LISTA/UNIDAD exigen que TODAS sus filas lo tengan marcado. null = sin filas puntuables (saltar). */
function puntoCumplido(tipo: string | undefined, o: OpcionScoring, valor: unknown): boolean | null {
  if (tipo === 'CHECKLIST') return opcionCumplida(o, valor as ValorChecklist, o.id ?? '')
  if (tipo === 'LISTA_COLABORADORES') {
    const v = valor as ValorListaColaboradores | null
    const aplican = (v?.colaboradores ?? []).filter((c) => c.aplica)
    if (!aplican.length) return null
    return aplican.every((c) => (c.selected ?? []).includes(o.id ?? ''))
  }
  if (tipo === 'UNIDAD_CHECKLIST') {
    const v = valor as ValorUnidadChecklist | null
    const unids = v?.unidades ?? []
    if (!unids.length) return null
    return unids.every((u) => (u.selected ?? []).includes(o.id ?? ''))
  }
  return null
}

type Contribucion = Map<string, { pos: number; log: number }>

/**
 * Contribución de un ítem respondido con la selección nueva de responsables de
 * las FALLAS (puntos incumplidos):
 * - Los checks CUMPLIDOS se reparten en modo legado: cada responsable configurado
 *   del check recibe su parte del peso del check (logrado = parte).
 * - Cada check INCUMPLIDO es absorbido por los responsables elegidos para él:
 *   cada elegido carga el punto completo como posible sin logrado (la pérdida del
 *   punto se atribuye a ellos; elegir varios puede superar el 100% del módulo).
 *   Sin selección → gerente (responsablesGerente); sin gerente → el peso se
 *   reparte entre los responsables configurados del check (legado).
 * - CUMPLE_NO_CUMPLE y CONCILIACION: ítem cumplido → reparto legado; ítem
 *   incumplido (value=false / desconciliado) → misma lógica de absorción a nivel
 *   del ítem completo.
 */
function contribucionNueva(it: ItemRespLigero, P: number, valor: unknown): Contribucion {
  const res = new Map<string, { pos: number; log: number }>()
  const v = valor as { responsables?: string[]; responsablesPorOpcion?: Record<string, string[]>; responsablesGerente?: string | null }
  const add = (r: string, pos: number, log: number) => {
    const x = (r ?? '').trim()
    if (!x) return
    const a = res.get(x) ?? { pos: 0, log: 0 }
    a.pos += pos
    a.log += log
    res.set(x, a)
  }
  const gerente = typeof v.responsablesGerente === 'string' && v.responsablesGerente ? v.responsablesGerente : null

  const esChecklist = it.tipo === 'CHECKLIST' || it.tipo === 'LISTA_COLABORADORES' || it.tipo === 'UNIDAD_CHECKLIST'
  const record = esChecklist && v.responsablesPorOpcion != null && typeof v.responsablesPorOpcion === 'object' && !Array.isArray(v.responsablesPorOpcion) ? v.responsablesPorOpcion : null

  if (esChecklist) {
    const opts = ((it.opciones ?? []) as OpcionScoring[]).filter((o) => o.id)
    const informativos = ((valor as ValorChecklist | null)?.informativos) ?? []
    const relevantes = opts.filter((o) => o.id && !informativos.includes(o.id as string))
    if (!relevantes.length) return res
    const conPuntos = relevantes.every((o) => typeof o.puntos === 'number' && (o.puntos as number) > 0)
    const totalPuntos = conPuntos ? relevantes.reduce((a, o) => a + ((o.puntos as number) ?? 0), 0) : 0
    for (const o of relevantes) {
      const cumple = puntoCumplido(it.tipo, o, valor)
      if (cumple === null) continue // sin filas puntuables: el punto no aplica
      // Peso del check: P × puntos/total si el ítem reparte por puntos; si no, reparto igual entre checks relevantes.
      const peso = conPuntos && totalPuntos > 0 ? redondear3((P * ((o.puntos as number) ?? 0)) / totalPuntos) : redondear3(P / relevantes.length)
      const conf = o.id ? responsablesDeOpcion(o) : []
      const rs = conf.length ? conf : responsablesDelItem(it)
      if (!rs.length) continue
      if (cumple) {
        // Punto cumplido → reparto legado: cada responsable configurado del check recibe su parte completa.
        const parte = redondear3(peso / rs.length)
        for (const r of rs) add(r, parte, parte)
      } else if (it.tipo === 'LISTA_COLABORADORES') {
        // Punto incumplido del listado de trabajadores: con selección por trabajador,
        // cada trabajador que NO marcó el punto absorbe la falla con SUS responsables
        // elegidos (o la selección antigua del ítem, o el gerente, o legado). Sin esa
        // selección (legado) la falla del punto completo se absorbe una sola vez.
        const vLista = valor as ValorListaColaboradores | null
        const aplican = (vLista?.colaboradores ?? []).filter((x) => x.aplica)
        const modoPorTrabajador = aplican.some((c) => c.responsablesPorOpcion)
        if (modoPorTrabajador) {
          for (const c of aplican) {
            if ((c.selected ?? []).includes(o.id as string)) continue
            const sel = c.responsablesPorOpcion?.[o.id as string] ?? record?.[o.id as string] ?? []
            if (sel.length) {
              for (const r of sel) add(r, peso, 0)
            } else if (gerente) {
              add(gerente, peso, 0)
            } else {
              const parte = redondear3(peso / rs.length)
              for (const r of rs) add(r, parte, 0)
            }
          }
        } else {
          const sel = o.id ? (record?.[o.id] ?? []) : []
          if (sel.length) {
            for (const r of sel) add(r, peso, 0)
          } else if (gerente) {
            add(gerente, peso, 0)
          } else {
            const parte = redondear3(peso / rs.length)
            for (const r of rs) add(r, parte, 0)
          }
        }
      } else {
        // Punto incumplido → la selección del evaluador absorbe la falla (posible sin logrado).
        const sel = o.id ? (record?.[o.id] ?? []) : []
        if (sel.length) {
          for (const r of sel) add(r, peso, 0)
        } else if (gerente) {
          add(gerente, peso, 0)
        } else {
          const parte = redondear3(peso / rs.length)
          for (const r of rs) add(r, parte, 0)
        }
      }
    }
    return res
  }

  // PLANO_XY: el peso del ítem se reparte entre los pines con veredicto. La parte
  // cumplida se reparte entre los responsables configurados; la fallada la absorbe la
  // selección del evaluador (o el gerente) como posible sin logrado. Los pines sin
  // veredicto no cuentan: no son una respuesta.
  if (it.tipo === 'PLANO_XY') {
    const prop = proporcionPlano(valor as ValorPlano | null)
    if (prop === null) return res
    const rsItem = responsablesDelItem(it)
    const cumple = redondear3(P * prop)
    const falla = redondear3(P - cumple)
    if (cumple > 0 && rsItem.length) {
      const parte = redondear3(cumple / rsItem.length)
      for (const r of rsItem) add(r, parte, parte)
    }
    if (falla > 0) {
      const sel = getRespArray(valor)
      if (sel.length) {
        for (const r of sel) add(r, falla, 0)
      } else if (gerente) {
        add(gerente, falla, 0)
      } else if (rsItem.length) {
        const parte = redondear3(falla / rsItem.length)
        for (const r of rsItem) add(r, parte, 0)
      }
    }
    return res
  }

  // CUMPLE_NO_CUMPLE / CONCILIACION: ítem binario (no usa opciones).
  const b = valorBinario({ tipo: it.tipo ?? '' }, valor)
  if (b === null) return res
  const rsItem = responsablesDelItem(it)
  if (b) {
    // Cumple → reparto legado del ítem completo entre todos sus responsables.
    if (!rsItem.length) return res
    const parte = redondear3(P / rsItem.length)
    for (const r of rsItem) add(r, parte, parte)
  } else {
    // No cumple → la selección del evaluador absorbe el punto fallado del ítem.
    const sel = getRespArray(valor)
    if (sel.length) {
      for (const r of sel) add(r, P, 0)
    } else if (gerente) {
      add(gerente, P, 0)
    } else {
      if (!rsItem.length) return res
      const parte = redondear3(P / rsItem.length)
      for (const r of rsItem) add(r, parte, 0)
    }
  }
  return res
}

export type ItemRespLigero = {
  id?: string
  tipo?: string
  puntaje?: number | null
  opciones?: string[] | { id?: string; responsable?: string; responsables?: string[] }[] | null
  responsables?: string[] | null
}

/**
 * Valor (ponderación) de cada responsable según su participación:
 * cada ítem con peso reparte su puntaje en partes iguales entre los responsables
 * que participan en él (sus checks), de modo que la suma de «posible» de todos los
 * responsables reconstruye los puntos del módulo (100% distribuido). Con `respuestas`
 * además calcula lo logrado por responsable en la evaluación y su porcentaje propio.
 */
export function valorPorResponsable(items: ItemRespLigero[], respuestas?: { item_id: string; instancia_id?: string | null; valor: unknown }[]): ValorResponsable[] {
  const muestrasPorItem = new Map<string, unknown[]>()
  if (respuestas) {
    for (const r of respuestas) {
      const arr = muestrasPorItem.get(r.item_id) ?? []
      arr.push(r.valor)
      muestrasPorItem.set(r.item_id, arr)
    }
  }

  const acum = new Map<string, { items: number; posible: number; logrado: number }>()
  const sumar = (responsable: string, items: number, posible: number, logrado: number) => {
    const a = acum.get(responsable) ?? { items: 0, posible: 0, logrado: 0 }
    a.items += items
    a.posible += posible
    a.logrado += logrado
    acum.set(responsable, a)
  }

  for (const it of items) {
    if (!it?.id || it.tipo === 'CONTENEDOR') continue
    const P = pesoItem(it)
    if (!(P > 0)) continue
    const muestras = muestrasPorItem.get(it.id) ?? []

    // Modelo nuevo: el evaluador respondió con selección de responsables de
    // fallas (por check o por ítem). Cada check INCUMPLIDO es absorbido por los
    // elegidos (o el gerente); los checks cumplidos se reparten en legado.
    if (muestras.some((m) => tieneSeleccionResponsables(m))) {
      const porResp = new Map<string, { pos: number; log: number }>()
      const sumarM = (r: string, pos: number, log: number) => {
        const a = porResp.get(r) ?? { pos: 0, log: 0 }
        a.pos += pos
        a.log += log
        porResp.set(r, a)
      }
      for (const valor of muestras) {
        if (tieneSeleccionResponsables(valor)) {
          const contrib = contribucionNueva(it, P, valor)
          for (const [r, a] of contrib) sumarM(r, a.pos, a.log)
        } else {
          // Muestra legada dentro de un ítem con selección: reparto original.
          const rs = responsablesDelItem(it)
          if (!rs.length) continue
          const share = redondear3(P / rs.length)
          const prop = proporcionItem(it as { tipo: string }, valor)
          if (prop == null) continue
          for (const r of rs) sumarM(r, share, share * prop)
        }
      }
      for (const [r, a] of porResp) {
        if (a.pos > 0 || a.log > 0) sumar(r, 1, a.pos, a.log)
      }
      continue
    }

    // Legado: comportamiento original intacto.
    const rs = responsablesDelItem(it)
    if (!rs.length) continue
    const share = redondear3(P / rs.length)
    for (const r of rs) {
      if (!muestras.length) {
        sumar(r, 1, share, 0)
        continue
      }
      let posibleM = 0
      let logradoM = 0
      for (const valor of muestras) {
        const prop = proporcionItem(it as { tipo: string }, valor)
        if (prop == null) continue // muestra no puntuable (ej. informativa)
        posibleM += share
        logradoM += share * prop
      }
      if (posibleM > 0 || logradoM > 0) sumar(r, 1, posibleM, logradoM)
    }
  }

  return Array.from(acum.entries())
    .map(([responsable, a]) => ({
      responsable,
      items: a.items,
      posible: redondear3(a.posible),
      logrado: redondear3(a.logrado),
      porciento: a.posible > 0 ? Math.round((a.logrado / a.posible) * 10000) / 100 : null
    }))
    .sort((a, b) => b.posible - a.posible || a.responsable.localeCompare(b.responsable))
}

export function incumplimientosPorResponsable(
  item: { tipo: string; opciones?: string[] | { id: string; responsable?: string; responsables?: string[] }[] | null },
  valor: unknown
): AcumuladoResponsable[] {
  const esChecklist = item.tipo === 'CHECKLIST' || item.tipo === 'LISTA_COLABORADORES' || item.tipo === 'UNIDAD_CHECKLIST'
  const v = valor as { responsables?: string[]; responsablesPorOpcion?: Record<string, string[]>; responsablesGerente?: string | null } | null
  const porOpcion =
    esChecklist && v?.responsablesPorOpcion != null && typeof v.responsablesPorOpcion === 'object' && !Array.isArray(v.responsablesPorOpcion)
      ? v.responsablesPorOpcion
      : null
  const gerente = typeof v?.responsablesGerente === 'string' && v.responsablesGerente ? v.responsablesGerente : null
  const acum = new Map<string, number>()
  // Un check fallado suma 1 a cada uno de sus responsables.
  const sumar = (rs: string[], n = 1) => {
    for (const r of rs) acum.set(r, (acum.get(r) ?? 0) + n)
  }

  if (item.tipo === 'PLANO_XY') {
    // Cada pin marcado "no cumple" es una falla, atribuida a los responsables elegidos
    // a nivel de ítem (o al gerente). Sin selección no se registra.
    const fallados = puntosMarcadosPlano(valor as ValorPlano | null).filter((p) => p.cumple === false).length
    if (!fallados) return []
    const selItem = Array.isArray(v?.responsables) ? v.responsables : []
    if (selItem.length) sumar(selItem, fallados)
    else if (gerente) sumar([gerente], fallados)
    return Array.from(acum.entries())
      .map(([responsable, n]) => ({ responsable: responsable as string, puntos: n }))
      .sort((a, b) => b.puntos - a.puntos || a.responsable.localeCompare(b.responsable))
  }

  if (!esChecklist) {
    // CUMPLE_NO_CUMPLE / CONCILIACION: el ítem fallado es UNA falla, atribuida a
    // los responsables elegidos por el evaluador (o al gerente). Sin selección
    // no se registra (legado: estos tipos no acumulaban incumplimientos).
    if (valorBinario(item, valor) !== false) return []
    const selItem = Array.isArray(v?.responsables) ? v.responsables : []
    if (selItem.length) sumar(selItem)
    else if (gerente) sumar([gerente])
    return Array.from(acum.entries())
      .map(([responsable, n]) => ({ responsable: responsable as string, puntos: n }))
      .sort((a, b) => b.puntos - a.puntos || a.responsable.localeCompare(b.responsable))
  }

  if (valorBinario(item, valor) === null) return []
  // Con selección por check, un check fallado se atribuye a los responsables
  // elegidos para él (o al gerente); sin modo por check → responsables
  // configurados (legado).
  const resolver = (o: { id?: string; responsable?: string; responsables?: string[] }): string[] => {
    if (porOpcion) {
      const sel = o.id ? porOpcion[o.id] : undefined
      if (sel?.length) return sel
      if (gerente) return [gerente]
    }
    return o.id ? responsablesDeOpcion(o) : []
  }
  const puntos = ((item.opciones ?? []) as { id?: string; responsable?: string; responsables?: string[] }[])
    .map((o) => ({ o, rs: resolver(o) }))
    .filter((x) => x.rs.length)
  if (puntos.length) {
    if (item.tipo === 'CHECKLIST') {
      const v2 = valor as ValorChecklist | null
      const informativos = v2?.informativos ?? []
      for (const { o, rs } of puntos) {
        if (!informativos.includes(o.id as string) && !opcionCumplida(o as { tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number }, v2, o.id as string)) sumar(rs)
      }
    } else if (item.tipo === 'LISTA_COLABORADORES') {
      // Cada trabajador que falla un check acumula una falla a SUS responsables
      // elegidos (o la selección antigua del ítem, o el gerente, o los configurados).
      const v2 = valor as ValorListaColaboradores | null
      const modoPorTrabajador = (v2?.colaboradores ?? []).some((c) => c.responsablesPorOpcion)
      const aplican = (v2?.colaboradores ?? []).filter((x) => x.aplica)
      if (modoPorTrabajador) {
        for (const c of aplican) {
          const sel = c.selected ?? []
          const cmap = c.responsablesPorOpcion ?? {}
          for (const o of (item.opciones ?? []) as { id?: string; responsable?: string; responsables?: string[] }[]) {
            if (!o.id || sel.includes(o.id)) continue
            const rs =
              cmap[o.id]?.length ? cmap[o.id]
              : porOpcion?.[o.id]?.length ? porOpcion[o.id]
              : gerente ? [gerente]
              : responsablesDeOpcion(o)
            if (rs.length) sumar(rs)
          }
        }
      } else {
        for (const c of aplican) {
          const sel = c.selected ?? []
          for (const { o, rs } of puntos) {
            if (!sel.includes(o.id as string)) sumar(rs)
          }
        }
      }
    } else if (item.tipo === 'UNIDAD_CHECKLIST') {
      const v2 = valor as ValorUnidadChecklist | null
      for (const u of v2?.unidades ?? []) {
        const sel = u.selected ?? []
        for (const { o, rs } of puntos) {
          if (!sel.includes(o.id as string)) sumar(rs)
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