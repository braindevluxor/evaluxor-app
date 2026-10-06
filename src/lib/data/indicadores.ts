import { supabase } from '../supabase'
import type { Evaluacion, Respuesta, Item, Foto, Modulo, Opcion, VistaEvaluacion, EstadoEvaluacion, Rol, SucursalOpcion, InstanciaGrupo, SucursalModulo, TipoItem } from '../types'
import {
  proporcionItem,
  puntajePonderado,
  conSeccionesPonderadas,
  incumplimientosPorResponsable,
  opcionCumplida,
  colaboradorCumple,
  colaboradoresQueCuentan,
  opcionesAplicablesColaborador,
  unidadCumple,
  esSinHablador,
  pesoItem,
  puntosMarcadosPlano,
  redondear3,
  tieneRespuesta,
  type AcumuladoResponsable,
  type BinarioConPuntaje,
  type ValorCumple,
  type ValorChecklist,
  type ValorConciliacion,
  type ValorListaColaboradores,
  type ValorPlano,
  type ValorUnidadChecklist
} from '../scoring'

export interface FiltrosIndicadores {
  sucursal_ids: string[] | null
  desde?: string
  hasta?: string
  modulo_id?: string
}

export interface ConjuntoDatos {
  evaluaciones: VistaEvaluacion[]
  respuestas: Respuesta[]
  items: Item[]
  modulos: Modulo[]
  fotos: Foto[]
  sucursalOpciones: SucursalOpcion[]
  instancias: InstanciaGrupo[]
}

export interface DetalleEvaluacion {
  evaluacion: VistaEvaluacion
  respuestas: Respuesta[]
  items: Item[]
  modulos: Modulo[]
  fotos: Foto[]
  sucursalOpciones: SucursalOpcion[]
  instancias: InstanciaGrupo[]
}

/** Datos de perfil (nombre + última subida a la nube) de los ids indicados. */
export async function listarPerfilesSync(
  ids: string[]
): Promise<Record<string, { nombre: string; ultima_sync: string | null; rol: Rol }>> {
  const out: Record<string, { nombre: string; ultima_sync: string | null; rol: Rol }> = {}
  if (!ids.length) return out
  const { data } = await supabase.from('profiles').select('id,nombre,ultima_sync,rol').in('id', ids)
  for (const p of (data ?? []) as { id: string; nombre: string; ultima_sync: string | null; rol: Rol }[]) {
    out[p.id] = { nombre: p.nombre, ultima_sync: p.ultima_sync ?? null, rol: p.rol }
  }
  return out
}

const SELECT_EVALUACION = '*, sucursal:sucursales(id,nombre,shop_id,branch_id,direccion), aperturador:profiles!evaluaciones_aperturada_por_fkey(id,nombre)'

export async function obtenerEvaluacion(id: string): Promise<DetalleEvaluacion | null> {
  const { data: ev } = await supabase
    .from('evaluaciones')
    .select(SELECT_EVALUACION)
    .eq('id', id)
    .maybeSingle()
  if (!ev) return null
  const evaluacion = ev as VistaEvaluacion

  const [resp, itemsResp, mods, fotos, opciones, instancias] = await Promise.all([
    supabase.from('respuestas').select('*').eq('evaluacion_id', id),
    (async () => {
      const rr = (await supabase.from('respuestas').select('item_id').eq('evaluacion_id', id)).data ?? []
      const itemIds = Array.from(new Set((rr as { item_id: string }[]).map((r) => r.item_id)))
      if (!itemIds.length) return [] as Item[]
      const it = ((await supabase.from('items').select('*').in('id', itemIds)).data ?? []) as Item[]
      const padresIds = Array.from(new Set(it.map((i) => i.padre_id).filter((p): p is string => !!p)))
      if (!padresIds.length) return it
      const padres = ((await supabase.from('items').select('*').in('id', padresIds)).data ?? []) as Item[]
      return [...it, ...padres]
    })(),
    supabase.from('modulos').select('*').order('orden'),
    supabase.from('fotos').select('*').eq('evaluacion_id', id),
    supabase.from('sucursal_opciones').select('*').eq('sucursal_id', evaluacion.sucursal_id).eq('activa', true),
    supabase.from('instancias_grupo').select('*').eq('evaluacion_id', id).order('orden')
  ])

  const items = (itemsResp ?? []) as Item[]
  const modulos = ((mods.data ?? []) as Modulo[]).filter((m) => items.some((i) => i.modulo_id === m.id))

  return {
    evaluacion,
    respuestas: (resp.data ?? []) as Respuesta[],
    items,
    modulos,
    fotos: (fotos.data ?? []) as Foto[],
    sucursalOpciones: (opciones.data ?? []) as SucursalOpcion[],
    instancias: (instancias.data ?? []) as InstanciaGrupo[]
  }
}

/**
 * Ítems que componen un módulo dentro de una lista completa: los respondedidos más sus
 * contenedores (grupos CONTENEDOR que no generan respuestas). Incluir los contenedores es
 * necesario para conservar instancias (p. ej. placas de vehículos), cuyo item_id apunta al
 * contenedor y no a ítems individuales, al filtrar por módulo.
 */
export function itemsDelModulo(todosItems: Item[], moduloId: string): Item[] {
  const ids = new Set<string>()
  for (const i of todosItems) {
    if (i.modulo_id !== moduloId) continue
    ids.add(i.id)
    if (i.padre_id) ids.add(i.padre_id)
  }
  return todosItems.filter((i) => ids.has(i.id))
}

/**
 * Módulos que tienen algo respondido en esta evaluación, en el orden en que
 * salen en el PDF.
 *
 * Es lo mismo que deja `detalle.modulos`, pero sin traer respuestas ni fotos:
 * el selector de qué exportar tiene que ofrecer los módulos *antes* de que el
 * usuario elija, y en las pantallas de listado la evaluación todavía no está
 * cargada. Por eso van en tandas: una evaluación larga pasa de los 100 ids y la
 * petición se corta.
 */
export async function modulosRespondidos(evaluacionId: string): Promise<Modulo[]> {
  const { data: resp } = await supabase
    .from('respuestas')
    .select('item_id')
    .eq('evaluacion_id', evaluacionId)
  const itemIds = Array.from(new Set((resp ?? []).map((r) => (r as { item_id: string }).item_id).filter(Boolean)))
  if (!itemIds.length) return []
  const moduloIds = new Set<string>()
  for (let i = 0; i < itemIds.length; i += 100) {
    const tanda = itemIds.slice(i, i + 100)
    const { data: items } = await supabase.from('items').select('id, modulo_id').in('id', tanda)
    for (const item of items ?? []) {
      const moduloId = (item as { modulo_id: string | null }).modulo_id
      if (moduloId) moduloIds.add(moduloId)
    }
  }
  if (!moduloIds.size) return []
  const { data: mods } = await supabase.from('modulos').select('*').in('id', Array.from(moduloIds))
  return ((mods ?? []) as Modulo[]).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
}

export async function consultarEvaluaciones(f: FiltrosIndicadores): Promise<ConjuntoDatos> {
  let query = supabase
    .from('evaluaciones')
    .select(SELECT_EVALUACION)
    .order('fecha', { ascending: false })

  const sucursales = f.sucursal_ids && f.sucursal_ids.length ? f.sucursal_ids : null
  if (sucursales) query = query.in('sucursal_id', sucursales)
  if (f.desde) query = query.gte('fecha', f.desde)
  if (f.hasta) query = query.lte('fecha', f.hasta)

  const { data: evals } = await query
  const evaluaciones = (evals ?? []) as VistaEvaluacion[]
  const vacio: ConjuntoDatos = { evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [], sucursalOpciones: [], instancias: [] }
  if (!evaluaciones.length) return vacio

  const ids = evaluaciones.map((e) => e.id)
  const sucursalIds = Array.from(new Set(evaluaciones.map((e) => e.sucursal_id)))

  const [resp, fot, mods, itemsResp, opciones, instancias] = await Promise.all([
    supabase.from('respuestas').select('*').in('evaluacion_id', ids),
    supabase.from('fotos').select('*').in('evaluacion_id', ids).order('created_at', { ascending: false }),
    supabase.from('modulos').select('*').order('orden'),
    (async () => {
      const respuestas2 = (await supabase.from('respuestas').select('*').in('evaluacion_id', ids)).data ?? []
      const itemIds = Array.from(new Set(respuestas2.map((r) => r.item_id)))
      if (!itemIds.length) return [] as Item[]
      const it = ((await supabase.from('items').select('*').in('id', itemIds)).data ?? []) as Item[]
      const padresIds = Array.from(new Set(it.map((i) => i.padre_id).filter((p): p is string => !!p)))
      if (!padresIds.length) return it
      const padres = ((await supabase.from('items').select('*').in('id', padresIds)).data ?? []) as Item[]
      return [...it, ...padres]
    })(),
    sucursalIds.length
      ? supabase.from('sucursal_opciones').select('*').in('sucursal_id', sucursalIds).eq('activa', true)
      : Promise.resolve({ data: [] }),
    supabase.from('instancias_grupo').select('*').in('evaluacion_id', ids).order('orden')
  ])

  const todosItems = (itemsResp ?? []) as Item[]
  const todosModulos = (mods.data ?? []) as Modulo[]
  const respuestas = (resp.data ?? []) as Respuesta[]
  // Ítems del rango: los respondidos MÁS sus contenedores padre, como en
  // `obtenerEvaluacion`. Dejarlos afuera rompe el puntaje: una sección pesa como
  // grupo con su propio puntaje, así que si no está en la lista cada hijo pesa
  // por su cuenta y el número que se ve en el historial no es el que queda al
  // cerrar (ni el que imprime el PDF).
  const items = todosItems

  if (f.modulo_id) {
    // El módulo se compone de ítems respondidos + sus contenedores (grupos sin respuestas).
    // Incluir los contenedores es necesario para conservar instancias (p. ej. placas de vehículos),
    // cuyo item_id apunta al contenedor y no a ítems individuales.
    const itemsModulo = itemsDelModulo(todosItems, f.modulo_id)
    const idsItemsModulo = new Set(itemsModulo.map((i) => i.id))
    const respModulo = respuestas.filter((r) => idsItemsModulo.has(r.item_id))
    return {
      evaluaciones,
      respuestas: respModulo,
      items: itemsModulo,
      modulos: todosModulos.filter((m) => m.id === f.modulo_id),
      fotos: ((fot.data ?? []) as Foto[]).filter((f2) => idsItemsModulo.has(f2.item_id)),
      sucursalOpciones: (opciones.data ?? []) as SucursalOpcion[],
      instancias: ((instancias.data ?? []) as InstanciaGrupo[]).filter((ins) => idsItemsModulo.has(ins.item_id))
    }
  }

  return {
    evaluaciones,
    respuestas,
    items,
    modulos: todosModulos.filter((m) => items.some((i) => i.modulo_id === m.id)),
    fotos: ((fot.data ?? []) as Foto[]).filter((f2) => items.some((i) => i.id === f2.item_id)),
    sucursalOpciones: (opciones.data ?? []) as SucursalOpcion[],
    instancias: (instancias.data ?? []) as InstanciaGrupo[]
  }
}

export interface ResumenEvaluacion {
  puntaje: number | null
  itemsBinarios: number
  itemsBinariosOk: number
}

function aplicarOpcionesSucursal(item: Item, sucursalId: string, sucursalOpciones: SucursalOpcion[]): Item {
  if (item.tipo !== 'CHECKLIST' || !item.opciones?.length) return item
  const ids = sucursalOpciones.filter((o) => o.sucursal_id === sucursalId && o.item_id === item.id).map((o) => o.opcion_id)
  if (!ids.length) return item
  return { ...item, opciones: item.opciones.filter((o) => ids.includes(o.id)) }
}

export function resumirEvaluacion(ev: Evaluacion, resps: Respuesta[], items: Item[], sucursalOpciones: SucursalOpcion[] = []): ResumenEvaluacion {
  const rr = resps
    .filter((r) => r.evaluacion_id === ev.id)
    .map((r) => {
      const item = items.find((i) => i.id === r.item_id)
      return item ? { item: aplicarOpcionesSucursal(item, ev.sucursal_id, sucursalOpciones), valor: r.valor } : null
    })
    .filter((x): x is { item: Item; valor: unknown } => !!x)

  const binarios = rr
    .map((r) => ({ item: r.item, cumple: proporcionItem(r.item, r.valor) }))
    .filter((b): b is { item: Item; cumple: number } => b.cumple !== null)
  // Las secciones ponderadas participan como grupo (su peso agrupa el de sus hijos).
  const conSecciones = conSeccionesPonderadas(items, binarios)
  const puntaje = conSecciones.length ? puntajePonderado(conSecciones) : ev.puntuacion

  return { puntaje, itemsBinarios: binarios.length, itemsBinariosOk: binarios.filter((b) => b.cumple === 1).length }
}

/** Puntaje en curso de una evaluación a partir de sus respuestas (mismas reglas que al cerrar):
 *  muestra el avance mientras los evaluadores responden. `respondidos` = ítems puntuables con respuesta. */
export function puntajeEnCurso(
  ev: Evaluacion,
  resps: Respuesta[],
  items: Item[],
  sucursalOpciones: SucursalOpcion[] = []
): { puntaje: number | null; respondidos: number } {
  const r = resumirEvaluacion(ev, resps, items, sucursalOpciones)
  return { puntaje: r.puntaje, respondidos: r.itemsBinarios }
}

export interface PuntajeModulo {
  modulo_id: string
  nombre: string
  puntaje: number | null
  evaluaciones: number
}

export function puntajePorModulo(
  datos: ConjuntoDatos
): PuntajeModulo[] {
  const sucursalDeEval = new Map(datos.evaluaciones.map((e) => [e.id, e.sucursal_id]))
  const acum = new Map<string, { modulo_id: string; nombre: string; binarios: { item: Item; cumple: number }[]; evals: Set<string> }>()
  for (const r of datos.respuestas) {
    const item = datos.items.find((i) => i.id === r.item_id)
    if (!item) continue
    const sucursalId = sucursalDeEval.get(r.evaluacion_id)
    const bin = proporcionItem(sucursalId ? aplicarOpcionesSucursal(item, sucursalId, datos.sucursalOpciones) : item, r.valor)
    if (bin === null) continue
    const nombre = datos.modulos.find((mm) => mm.id === item.modulo_id)?.nombre ?? 'Módulo'
    let a = acum.get(item.modulo_id)
    if (!a) {
      a = { modulo_id: item.modulo_id, nombre, binarios: [], evals: new Set() }
      acum.set(item.modulo_id, a)
    }
    a.binarios.push({ item, cumple: bin })
    a.evals.add(r.evaluacion_id)
  }
  return Array.from(acum.values())
    .map(({ modulo_id, nombre, binarios, evals }) => {
      const conSecciones = conSeccionesPonderadas(datos.items, binarios)
      return {
        modulo_id,
        nombre,
        puntaje: puntajePonderado(conSecciones),
        evaluaciones: evals.size
      }
    })
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0))
}

export interface MedidorModulo {
  modulo_id: string
  nombre: string
  /** Promedio del puntaje (0-100) de la última evaluación de cada sucursal con el módulo activo, o null si no hay datos. */
  promedio: number | null
  /** Sucursales que entraron al promedio. */
  sucursales: number
  /** Sucursales con el módulo activo sin evaluación con puntaje (o sin ítems del módulo respondidos) en el rango. */
  sinDatos: number
}

/** Puntaje ponderado de un módulo dentro de una evaluación puntual. */
function puntajeModuloEnEvaluacion(
  datos: ConjuntoDatos,
  ev: Evaluacion,
  moduloId: string,
  respuestasDe: Map<string, Respuesta[]>,
  itemDe: Map<string, Item>
): number | null {
  const binarios: { item: Item; cumple: number }[] = []
  for (const r of respuestasDe.get(ev.id) ?? []) {
    const item = itemDe.get(r.item_id)
    if (!item || item.modulo_id !== moduloId) continue
    const cumple = proporcionItem(aplicarOpcionesSucursal(item, ev.sucursal_id, datos.sucursalOpciones), r.valor)
    if (cumple === null) continue
    binarios.push({ item, cumple })
  }
  if (!binarios.length) return null
  return puntajePonderado(conSeccionesPonderadas(datos.items, binarios))
}

/**
 * Promedio de la última evaluación de cada sucursal que tenga el módulo activo
 * (`sucursal_modulos.activa`, dentro de las sucursales visibles). Solo se
 * consideran evaluaciones ya puntuadas (`puntuacion != null`); de cada sucursal
 * se toma la más reciente (por fecha, desempate por created_at) que haya medido
 * el módulo. Si el módulo no tiene sucursales configuradas, se usan las
 * sucursales con datos del módulo en el rango, para evitar relojes en blanco.
 */
/**
 * Sucursales evaluadas del módulo: solo cuentan las sucursales que tienen el
 * módulo habilitado (`sucursal_modulos.activa`; sin filas activas para la
 * sucursal aplican todos los módulos) Y cuya evaluación en el rango tiene
 * respuestas de ítems de ese módulo. Sin respuestas del módulo no cuenta.
 */
export function sucursalesConModuloEvaluado(
  datos: ConjuntoDatos,
  moduloId: string,
  sucursalModulos: SucursalModulo[]
): number {
  // Módulos activos por sucursal según la configuración.
  const activosPorSucursal = new Map<string, Set<string>>()
  for (const sm of sucursalModulos) {
    if (!sm.activa) continue
    const arr = activosPorSucursal.get(sm.sucursal_id) ?? new Set<string>()
    arr.add(sm.modulo_id)
    activosPorSucursal.set(sm.sucursal_id, arr)
  }
  const habilitado = (sucursalId: string): boolean => {
    const ids = activosPorSucursal.get(sucursalId)
    // Sin filas activas para esa sucursal => aplican TODOS los módulos.
    if (ids === undefined || ids.size === 0) return true
    return ids.has(moduloId)
  }
  // Evaluaciones que tienen al menos una respuesta de ítems del módulo.
  const idsItemsModulo = new Set(datos.items.filter((i) => i.modulo_id === moduloId).map((i) => i.id))
  const conRespuestas = new Set<string>()
  for (const r of datos.respuestas) {
    if (!idsItemsModulo.has(r.item_id)) continue
    conRespuestas.add(r.evaluacion_id)
  }
  const resultado = new Set<string>()
  for (const e of datos.evaluaciones) {
    if (!conRespuestas.has(e.id)) continue
    if (!habilitado(e.sucursal_id)) continue
    resultado.add(e.sucursal_id)
  }
  return resultado.size
}

export function medidoresPorModulo(
  datos: ConjuntoDatos,
  modulos: { id: string; nombre: string }[],
  sucursalesVisibles: { id: string }[],
  sucursalModulos: SucursalModulo[]
): MedidorModulo[] {
  const visibles = new Set(sucursalesVisibles.map((s) => s.id))
  const itemDe = new Map<string, Item>()
  const moduloDeItem = new Map<string, string>()
  for (const i of datos.items) {
    itemDe.set(i.id, i)
    moduloDeItem.set(i.id, i.modulo_id)
  }
  const respuestasDe = new Map<string, Respuesta[]>()
  for (const r of datos.respuestas) {
    const arr = respuestasDe.get(r.evaluacion_id) ?? []
    arr.push(r)
    respuestasDe.set(r.evaluacion_id, arr)
  }
  const evalsPorSucursal = new Map<string, Evaluacion[]>()
  for (const e of datos.evaluaciones) {
    if (e.puntuacion == null) continue
    const arr = evalsPorSucursal.get(e.sucursal_id) ?? []
    arr.push(e)
    evalsPorSucursal.set(e.sucursal_id, arr)
  }
  for (const arr of evalsPorSucursal.values()) {
    arr.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.created_at.localeCompare(a.created_at))
  }
  const activosPorModulo = new Map<string, string[]>()
  for (const sm of sucursalModulos) {
    if (!sm.activa || !visibles.has(sm.sucursal_id)) continue
    const arr = activosPorModulo.get(sm.modulo_id) ?? []
    arr.push(sm.sucursal_id)
    activosPorModulo.set(sm.modulo_id, arr)
  }
  const evaluaModulo = (evId: string, moduloId: string): boolean =>
    (respuestasDe.get(evId) ?? []).some((r) => moduloDeItem.get(r.item_id) === moduloId)

  return modulos.map((m) => {
    const miembros = activosPorModulo.get(m.id) ?? []
    if (!miembros.length) {
      for (const [sucursalId, arr] of evalsPorSucursal) {
        if (!visibles.has(sucursalId)) continue
        if (arr.some((ev) => evaluaModulo(ev.id, m.id))) miembros.push(sucursalId)
      }
    }
    let suma = 0
    let sucursales = 0
    let sinDatos = 0
    for (const sucursalId of new Set(miembros)) {
      const arr = evalsPorSucursal.get(sucursalId)
      let puntaje: number | null = null
      if (arr) {
        for (const ev of arr) {
          const p = puntajeModuloEnEvaluacion(datos, ev, m.id, respuestasDe, itemDe)
          if (p != null) {
            puntaje = p
            break
          }
        }
      }
      if (puntaje == null) {
        sinDatos++
        continue
      }
      suma += puntaje
      sucursales++
    }
    return {
      modulo_id: m.id,
      nombre: m.nombre,
      promedio: sucursales ? Math.round((suma / sucursales) * 100) / 100 : null,
      sucursales,
      sinDatos
    }
  })
}

export interface ResumenOpcionChecklist {
  id: string
  etiqueta: string
  tipo_respuesta: 'CHECK' | 'RANGO' | null
  minimo: number | null
  unidad: string | null
  /** Nº de muestras puntuables en las que la opción estuvo presente (esperada). */
  veces: number
  /** De esas veces, en cuántas quedó cumplida. */
  cumplida: number
}

export interface ResumenConciliacion {
  /** Productos escaneados puntuables (con teórica > 0 y física ingresada). */
  total: number
  /** Productos donde la cantidad física coincide con la teórica. */
  conciliados: number
  /** % de productos sin coincidir (tasa de descuadre agregada). null si no hay productos. */
  tasaDescuadre: number | null
}

export interface ResumenItemModulo {
  item: Item
  /** Peso del ítem en el módulo (0 si no tiene peso configurado). */
  peso: number
  /** Nº total de respuestas guardadas para el ítem en el rango. */
  respondidas: number
  /** Nº de respuestas puntuables (entran al puntaje). */
  muestras: number
  /** Suma de proporciones (0..1 por muestra). Para binarios = nº de muestras que cumplen. */
  ok: number
  /** Proporción promedio 0..1 (ok / muestras). null si no hay muestras. */
  promedio: number | null
  /** Solo LISTA_COLABORADORES: total de trabajadores revisados que entran en el puntaje y cuántos cumplen. */
  colaboradores?: { total: number; ok: number }
  /** Solo UNIDAD_CHECKLIST: total de unidades evaluadas y cuántas cumplen. */
  unidades?: { total: number; ok: number }
  /** Solo CONCILIACION: desglose de productos escaneados y conciliados. */
  conciliacion?: ResumenConciliacion
  /** Solo CHECKLIST: cumplimiento por opción a lo largo de las muestras. */
  opciones?: ResumenOpcionChecklist[]
}

interface AcumuladoOpcion {
  id: string
  etiqueta: string
  tipo_respuesta: 'CHECK' | 'RANGO' | null
  minimo: number | null
  unidad: string | null
  veces: number
  cumplida: number
}

interface AcumuladoItem {
  respondidas: number
  muestras: number
  ok: number
  colabTotal: number
  colabOk: number
  unidTotal: number
  unidOk: number
  concTotal: number
  concOk: number
  opciones: Map<string, AcumuladoOpcion>
}

function nuevoAcumulado(): AcumuladoItem {
  return {
    respondidas: 0,
    muestras: 0,
    ok: 0,
    colabTotal: 0,
    colabOk: 0,
    unidTotal: 0,
    unidOk: 0,
    concTotal: 0,
    concOk: 0,
    opciones: new Map()
  }
}

/**
 * Resume por ítem el desempeño de un módulo en el rango: para cada ítem del
 * módulo (secciones CONTENEDOR excluidas) computa el nº de muestras puntuables,
 * el cumplimiento promedio y un desglose según el tipo de ítem (opciones de
 * checklist, productos de conciliación, colaboradores o unidades) para elegir
 * el gráfico más idóneo. `catalogoItems` aporta la estructura del módulo
 * (aunque no haya respuestas en el rango) y por defecto usa los ítems de `datos`.
 */
export function resumenItemsModulo(
  datos: ConjuntoDatos,
  moduloId: string,
  catalogoItems: Item[] = datos.items
): ResumenItemModulo[] {
  const sucursalDeEval = new Map<string, string>()
  for (const e of datos.evaluaciones) sucursalDeEval.set(e.id, e.sucursal_id)

  const acum = new Map<string, AcumuladoItem>()
  const itemDe = new Map<string, Item>()
  for (const i of datos.items) itemDe.set(i.id, i)

  for (const r of datos.respuestas) {
    const item = itemDe.get(r.item_id)
    if (!item || item.modulo_id !== moduloId) continue
    const sucursalId = sucursalDeEval.get(r.evaluacion_id)
    const it = sucursalId ? aplicarOpcionesSucursal(item, sucursalId, datos.sucursalOpciones) : item
    const p = proporcionItem(it, r.valor)

    let a = acum.get(item.id)
    if (!a) {
      a = nuevoAcumulado()
      acum.set(item.id, a)
    }
    // Solo cuentan las respuestas con contenido: una fila guardada vacía (ítem abierto
    // sin contestar) no es una respuesta y no debe inflar "n respuestas" del ítem.
    if (tieneRespuesta(it, r.valor)) a.respondidas++

    if (it.tipo === 'CHECKLIST') {
      const v = r.valor as ValorChecklist | null
      const informativos = v?.informativos ?? []
      const relevantes = ((it.opciones ?? []) as Opcion[]).filter((o) => !informativos.includes(o.id))
      // Las opciones solo se cuentan dentro de muestras puntuables (mismo umbral que el scoring).
      if (p === null) continue
      a.muestras++
      a.ok += p
      for (const o of relevantes) {
        const eo = a.opciones.get(o.id) ?? {
          id: o.id,
          etiqueta: o.etiqueta,
          tipo_respuesta: o.tipo_respuesta ?? null,
          minimo: (o.minimo ?? null) as number | null,
          unidad: (o.unidad ?? null) as string | null,
          veces: 0,
          cumplida: 0
        }
        eo.veces++
        if (opcionCumplida(o, v, o.id)) eo.cumplida++
        a.opciones.set(o.id, eo)
      }
      continue
    }

    if (it.tipo === 'LISTA_COLABORADORES') {
      const v = r.valor as ValorListaColaboradores | null
      const aplican = colaboradoresQueCuentan(v?.colaboradores)
      const opts = (it.opciones ?? []) as { id: string }[]
      if (!opts.length || !aplican.length || p === null) continue
      a.muestras++
      a.ok += p
      for (const c of aplican.filter((colaborador) => opcionesAplicablesColaborador(colaborador, opts).length > 0)) {
        a.colabTotal++
        if (colaboradorCumple(c, opts)) a.colabOk++
      }
      continue
    }

    if (it.tipo === 'UNIDAD_CHECKLIST') {
      const v = r.valor as ValorUnidadChecklist | null
      const unidades = v?.unidades ?? []
      const opts = (it.opciones ?? []) as { id: string }[]
      if (!opts.length || !unidades.length || p === null) continue
      a.muestras++
      a.ok += p
      for (const u of unidades) {
        a.unidTotal++
        if (unidadCumple(u, opts)) a.unidOk++
      }
      continue
    }

    if (it.tipo === 'CONCILIACION') {
      const v = r.valor as ValorConciliacion | null
      // Los sin hablador entran aunque no tengan precio físico: son No Match y
      // sacarlos del total habría hecho que empeorar la tasa en lugar de bajarla.
      const validos = (v?.productos ?? []).filter(
        (pro) => esSinHablador(pro) || (typeof pro.teorica === 'number' && typeof pro.fisica === 'number' && pro.teorica > 0)
      )
      if (!validos.length) continue
      a.muestras++
      a.ok += p ?? 0
      for (const pro of validos) {
        a.concTotal++
        if (!esSinHablador(pro) && pro.fisica === pro.teorica) a.concOk++
      }
      continue
    }

    if (p === null) continue
    a.muestras++
    a.ok += p
  }

  const ordenDeOpcion = (item: Item, id: string): number => {
    const idx = ((item.opciones ?? []) as { id: string }[]).findIndex((o) => o.id === id)
    return idx === -1 ? 99 : idx
  }

  const baseDeCatalogo = catalogoItems.length ? catalogoItems : datos.items
  return baseDeCatalogo
    .filter((i) => i.modulo_id === moduloId && i.activo && i.tipo !== 'CONTENEDOR')
    .sort((x, y) => x.orden - y.orden)
    .map((item) => {
      const a = acum.get(item.id) ?? nuevoAcumulado()
      const promedio = a.muestras ? redondear3(a.ok / a.muestras) : null
      const base: ResumenItemModulo = {
        item,
        peso: pesoItem(item),
        respondidas: a.respondidas,
        muestras: a.muestras,
        ok: redondear3(a.ok),
        promedio
      }
      if (item.tipo === 'LISTA_COLABORADORES') {
        base.colaboradores = { total: a.colabTotal, ok: a.colabOk }
      } else if (item.tipo === 'UNIDAD_CHECKLIST') {
        base.unidades = { total: a.unidTotal, ok: a.unidOk }
      } else if (item.tipo === 'CONCILIACION') {
        base.conciliacion = {
          total: a.concTotal,
          conciliados: a.concOk,
          tasaDescuadre: a.concTotal ? Math.round(((a.concTotal - a.concOk) / a.concTotal) * 10000) / 100 : null
        }
      } else if (item.tipo === 'CHECKLIST') {
        base.opciones = Array.from(a.opciones.values()).sort(
          (x, y) => ordenDeOpcion(item, x.id) - ordenDeOpcion(item, y.id)
        )
      }
      return base
    })
}

export interface BarraModulo {
  /** Id de sucursal o placa (etiqueta de la instancia). */
  clave: string
  /** Nombre para mostrar (sucursal o placa). */
  etiqueta: string
  /** Puntaje ponderado (0-100) agrupando las respuestas del rango. null si no hay datos. */
  puntaje: number | null
  /** Evaluaciones del rango que aportan datos al grupo. */
  muestras: number
}

/**
 * Barras para el gráfico general del módulo: promedio ponderado por sucursal,
 * o por placa en el caso de módulos de vehículos (secciones con api 'vehiculos',
 * donde la unidad de análisis es cada placa/instancia en lugar de la sucursal).
 */
export function barrasModulo(
  datos: ConjuntoDatos,
  moduloId: string,
  sucursalesVisibles: { id: string; nombre: string }[],
  porPlaca: boolean
): { grupo: 'sucursal' | 'placa'; barras: BarraModulo[] } {
  const sucursalDeEval = new Map<string, string>()
  for (const e of datos.evaluaciones) sucursalDeEval.set(e.id, e.sucursal_id)
  const itemDe = new Map<string, Item>()
  for (const i of datos.items) itemDe.set(i.id, i)
  const acum = (clave: string) =>
    agrupado.get(clave) ?? { binarios: [] as { item: Item; cumple: number }[], evals: new Set<string>() }

  const agrupado = new Map<string, { binarios: { item: Item; cumple: number }[]; evals: Set<string> }>()

  if (!porPlaca) {
    // Promedio por sucursal: agrupa todas las respuestas del módulo en el rango.
    for (const r of datos.respuestas) {
      const item = itemDe.get(r.item_id)
      if (!item || item.modulo_id !== moduloId) continue
      const suc = sucursalDeEval.get(r.evaluacion_id)
      if (!suc) continue
      const bin = proporcionItem(aplicarOpcionesSucursal(item, suc, datos.sucursalOpciones), r.valor)
      if (bin === null) continue
      const e = acum(suc)
      e.binarios.push({ item, cumple: bin })
      e.evals.add(r.evaluacion_id)
      agrupado.set(suc, e)
    }
    const barras = sucursalesVisibles.map((s) => {
      const e = agrupado.get(s.id)
      return {
        clave: s.id,
        etiqueta: s.nombre,
        puntaje: e?.binarios.length ? puntajePonderado(conSeccionesPonderadas(datos.items, e.binarios)) : null,
        muestras: e?.evals.size ?? 0
      }
    })
    return { grupo: 'sucursal', barras: ordenarBarras(barras) }
  }

  // Promedio por placa: agrupa por etiqueta de instancia (placa) dentro del rango.
  const etiquetaDeInstancia = new Map<string, string>()
  for (const i of datos.instancias) etiquetaDeInstancia.set(i.id, i.etiqueta)

  for (const r of datos.respuestas) {
    const item = itemDe.get(r.item_id)
    if (!item || item.modulo_id !== moduloId || !r.instancia_id) continue
    const placa = etiquetaDeInstancia.get(r.instancia_id)
    if (!placa) continue
    const suc = sucursalDeEval.get(r.evaluacion_id)
    const bin = proporcionItem(suc ? aplicarOpcionesSucursal(item, suc, datos.sucursalOpciones) : item, r.valor)
    if (bin === null) continue
    const e = acum(placa)
    e.binarios.push({ item, cumple: bin })
    e.evals.add(r.evaluacion_id)
    agrupado.set(placa, e)
  }
  // Incluye placas registradas aunque no tengan respuestas (barra sin datos).
  for (const i of datos.instancias) {
    const padre = itemDe.get(i.item_id)
    if (!padre || padre.modulo_id !== moduloId) continue
    if (!agrupado.has(i.etiqueta)) agrupado.set(i.etiqueta, { binarios: [], evals: new Set<string>() })
  }

  const barras = Array.from(agrupado.entries()).map(([placa, e]) => ({
    clave: placa,
    etiqueta: placa,
    puntaje: e.binarios.length ? puntajePonderado(conSeccionesPonderadas(datos.items, e.binarios)) : null,
    muestras: e.evals.size
  }))
  return { grupo: 'placa', barras: ordenarBarras(barras) }
}

function ordenarBarras(barras: BarraModulo[]): BarraModulo[] {
  return [...barras].sort(
    (a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1) || a.etiqueta.localeCompare(b.etiqueta, 'es')
  )
}

export interface FilaSucursalModulo {
  sucursal_id: string
  nombre: string
  /** Clave = nombre del módulo; valor = puntaje ponderado en el rango (0-100) o null si no hay respuestas. */
  porModulo: Record<string, number | null>
}

export interface MatrizSucursalModulo {
  sucursales: FilaSucursalModulo[]
  modulos: { modulo_id: string; nombre: string }[]
}

/** Puntaje (ponderación) por sucursal × módulo a partir de los ítems binarios respondidos en el rango. */
export function puntajePorSucursalModulo(
  datos: ConjuntoDatos,
  sucursales: { id: string; nombre: string }[]
): MatrizSucursalModulo {
  const sucursalDeEval = new Map(datos.evaluaciones.map((e) => [e.id, e.sucursal_id]))
  const modulos = datos.modulos.map((m) => ({ modulo_id: m.id, nombre: m.nombre }))
  const acum = new Map<string, { binarios: { item: Item; cumple: number }[] }>()
  for (const r of datos.respuestas) {
    const item = datos.items.find((i) => i.id === r.item_id)
    if (!item) continue
    const sucursalId = sucursalDeEval.get(r.evaluacion_id)
    if (!sucursalId) continue
    const bin = proporcionItem(aplicarOpcionesSucursal(item, sucursalId, datos.sucursalOpciones), r.valor)
    if (bin === null) continue
    const key = `${sucursalId}|${item.modulo_id}`
    let a = acum.get(key)
    if (!a) {
      a = { binarios: [] }
      acum.set(key, a)
    }
    a.binarios.push({ item, cumple: bin })
  }
  return {
    modulos,
    sucursales: sucursales.map((s) => {
      const porModulo: Record<string, number | null> = {}
      for (const m of modulos) {
        const a = acum.get(`${s.id}|${m.modulo_id}`)
        porModulo[m.nombre] = a && a.binarios.length ? puntajePonderado(conSeccionesPonderadas(datos.items, a.binarios)) : null
      }
      return { sucursal_id: s.id, nombre: s.nombre, porModulo }
    })
  }
}

export function rankingSucursales(
  datos: ConjuntoDatos,
  todas?: { id: string; nombre: string }[]
): { sucursal_id: string; nombre: string; puntaje: number | null; completadas: number }[] {
  const porSuc = new Map<string, { sucursal_id: string; puntajes: number[]; completadas: number; nombre: string }>()
  for (const t of todas ?? []) {
    porSuc.set(t.id, { sucursal_id: t.id, puntajes: [], completadas: 0, nombre: t.nombre })
  }
  for (const ev of datos.evaluaciones) {
    const { puntaje } = resumirEvaluacion(ev, datos.respuestas, datos.items, datos.sucursalOpciones)
    const s = porSuc.get(ev.sucursal_id)
    if (s) {
      if (puntaje != null) s.puntajes.push(puntaje)
      s.completadas++
    } else {
      porSuc.set(ev.sucursal_id, {
        sucursal_id: ev.sucursal_id,
        puntajes: puntaje != null ? [puntaje] : [],
        completadas: 1,
        nombre: ev.sucursal?.nombre ?? ev.sucursal_id
      })
    }
  }
  return Array.from(porSuc.values())
    .map((s) => ({
      sucursal_id: s.sucursal_id,
      nombre: s.nombre,
      puntaje: s.puntajes.length ? Math.round((s.puntajes.reduce((a, b) => a + b, 0) / s.puntajes.length) * 100) / 100 : null,
      completadas: s.completadas
    }))
    .sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1) || a.nombre.localeCompare(b.nombre))
}

export interface SerieMes {
  /** Clave 'YYYY-MM' del mes (útil para filtrar evaluaciones en un drilldown). */
  key: string
  mes: string
  puntaje: number | null
  completadas: number
}

export function evolucionMensual(datos: ConjuntoDatos): SerieMes[] {
  const porMes = new Map<string, { puntajes: number[]; completadas: number }>()
  for (const ev of datos.evaluaciones) {
    const key = ev.fecha.slice(0, 7)
    const { puntaje } = resumirEvaluacion(ev, datos.respuestas, datos.items, datos.sucursalOpciones)
    const m = porMes.get(key)
    if (m) {
      if (puntaje != null) m.puntajes.push(puntaje)
      m.completadas++
    } else {
      porMes.set(key, { puntajes: puntaje != null ? [puntaje] : [], completadas: 1 })
    }
  }
  const espanol = new Intl.DateTimeFormat('es', { month: 'short', year: '2-digit' })
  return Array.from(porMes.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => {
      const fecha = new Date(key + '-01T12:00:00')
      return {
        key,
        mes: espanol.format(fecha),
        puntaje: v.puntajes.length ? Math.round((v.puntajes.reduce((a, b) => a + b, 0) / v.puntajes.length) * 100) / 100 : null,
        completadas: v.completadas
      }
    })
}

export function peoresItems(datos: ConjuntoDatos): { item_id: string; texto: string; modulo_id: string; ok: number; total: number; ratio: number }[] {
  const sucursalDeEval = new Map(datos.evaluaciones.map((e) => [e.id, e.sucursal_id]))
  const porItem = new Map<string, { item_id: string; texto: string; modulo_id: string; ok: number; total: number }>()
  for (const r of datos.respuestas) {
    const item = datos.items.find((i) => i.id === r.item_id)
    if (!item) continue
    const sucursalId = sucursalDeEval.get(r.evaluacion_id)
    const v = proporcionItem(sucursalId ? aplicarOpcionesSucursal(item, sucursalId, datos.sucursalOpciones) : item, r.valor)
    if (v === null) continue
    const e = porItem.get(r.item_id)
    if (e) {
      e.total++
      e.ok += v
    } else {
      porItem.set(r.item_id, {
        item_id: r.item_id,
        texto: item.texto,
        modulo_id: item.modulo_id,
        ok: v,
        total: 1
      })
    }
  }
  return Array.from(porItem.values())
    .map((x) => ({ ...x, ratio: x.total ? x.ok / x.total : 0 }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 10)
}

export function acumuladoResponsables(datos: ConjuntoDatos): AcumuladoResponsable[] {
  const sucursalDeEval = new Map(datos.evaluaciones.map((e) => [e.id, e.sucursal_id]))
  const acum = new Map<string, number>()
  for (const r of datos.respuestas) {
    const item = datos.items.find((i) => i.id === r.item_id)
    if (!item) continue
    const sucursalId = sucursalDeEval.get(r.evaluacion_id)
    const it = sucursalId ? aplicarOpcionesSucursal(item, sucursalId, datos.sucursalOpciones) : item
    for (const a of incumplimientosPorResponsable(it, r.valor)) {
      acum.set(a.responsable, (acum.get(a.responsable) ?? 0) + a.puntos)
    }
  }
  return Array.from(acum.entries())
    .map(([responsable, puntos]) => ({ responsable, puntos }))
    .sort((a, b) => b.puntos - a.puntos || a.responsable.localeCompare(b.responsable))
}

export function porEvaluador(datos: ConjuntoDatos): { evaluador_id: string; nombre: string; puntaje: number | null; evaluaciones: number }[] {
  const porE = new Map<string, { nombre: string; puntajes: number[]; n: number }>()
  for (const ev of datos.evaluaciones) {
    const { puntaje } = resumirEvaluacion(ev, datos.respuestas, datos.items, datos.sucursalOpciones)
    const key = ev.aperturada_por || ev.id
    const e = porE.get(key)
    if (e) {
      if (puntaje != null) e.puntajes.push(puntaje)
      e.n++
    } else {
      porE.set(key, { nombre: ev.aperturador?.nombre ?? 'Sin nombre', puntajes: puntaje != null ? [puntaje] : [], n: 1 })
    }
  }
  return Array.from(porE.values()).map((e) => ({
    evaluador_id: '',
    nombre: e.nombre,
    puntaje: e.puntajes.length ? Math.round((e.puntajes.reduce((a, b) => a + b, 0) / e.puntajes.length) * 100) / 100 : null,
    evaluaciones: e.n
  }))
}

export function matrizModuloSucursal(
  datos: ConjuntoDatos
): { sucursal: string; filas: { modulo: string; puntaje: number | null }[] }[] {
  const sucursales = Array.from(new Set(datos.evaluaciones.map((e) => e.sucursal_id)))
  const modulos = datos.modulos
  const celdas: Record<string, Record<string, { binarios: BinarioConPuntaje[] }>> = {}
  const nombresSuc: Record<string, string> = {}
  for (const ev of datos.evaluaciones) {
    nombresSuc[ev.sucursal_id] = ev.sucursal?.nombre ?? ev.sucursal_id
    for (const r of datos.respuestas.filter((x) => x.evaluacion_id === ev.id)) {
      const item = datos.items.find((i) => i.id === r.item_id)
      if (!item) continue
      const bin = proporcionItem(aplicarOpcionesSucursal(item, ev.sucursal_id, datos.sucursalOpciones), r.valor)
      if (bin === null) continue
      const c = celdas[ev.sucursal_id]?.[item.modulo_id] ?? { binarios: [] }
      c.binarios.push({ item, cumple: bin })
      if (!celdas[ev.sucursal_id]) celdas[ev.sucursal_id] = {}
      celdas[ev.sucursal_id][item.modulo_id] = c
    }
  }
  return sucursales.map((suc) => ({
    sucursal: nombresSuc[suc],
    filas: modulos.map((m) => {
      const c = celdas[suc]?.[m.id]
      return {
        modulo: m.nombre,
        puntaje: c ? puntajePonderado(conSeccionesPonderadas(datos.items, c.binarios)) : null
      }
    })
  }))
}

export async function eliminarEvaluacion(id: string): Promise<void> {
  const { data: fotos } = await supabase.from('fotos').select('path').eq('evaluacion_id', id)
  const paths = ((fotos ?? []) as { path: string }[]).map((f) => f.path)
  const { error } = await supabase.from('evaluaciones').delete().eq('id', id)
  if (error) throw new Error(error.message)
  if (paths.length) {
    // Se eliminan los archivos del bucket; si falla, solo quedan huérfanos en storage.
    await supabase.storage.from('evidencias').remove(paths).catch(() => null)
  }
}

export async function listarEvaluacionesActivas(): Promise<VistaEvaluacion[]> {
  const { data } = await supabase
    .from('evaluaciones')
    .select(SELECT_EVALUACION)
    .eq('estado', 'ACTIVA')
  return (data ?? []) as VistaEvaluacion[]
}

export async function listarRespuestasEvaluacion(evaluacionId: string): Promise<{ item_id: string; instancia_id: string | null; valor: unknown; respondido_por: string }[]> {
  const { data } = await supabase
    .from('respuestas')
    .select('item_id, instancia_id, valor, respondido_por')
    .eq('evaluacion_id', evaluacionId)
  return (data ?? []) as { item_id: string; instancia_id: string | null; valor: unknown; respondido_por: string }[]
}

export async function listarInstanciasEvaluacion(evaluacionId: string): Promise<InstanciaGrupo[]> {
  const { data } = await supabase
    .from('instancias_grupo')
    .select('*')
    .eq('evaluacion_id', evaluacionId)
    .order('orden')
  return (data ?? []) as InstanciaGrupo[]
}

export async function crearEvaluacion(args: {
  sucursal_id: string
  fecha: string
  estado: EstadoEvaluacion
  aperturada_por: string
}): Promise<void> {
  const { error } = await supabase.from('evaluaciones').insert({
    offline_uuid: crypto.randomUUID(),
    sucursal_id: args.sucursal_id,
    fecha: args.fecha,
    estado: args.estado,
    aperturada_por: args.aperturada_por,
    abierta_en: args.estado === 'ACTIVA' ? new Date().toISOString() : null
  })
  if (error) throw new Error(error.message)
}

/**
 * Pasa la evaluación a ACTIVA. Sirve para abrir una PROGRAMADA y también para
 * reabrir una CERRADA: en ambos casos se limpia `cerrada_en`. No se borra el
 * `puntuacion` ni el `comentario_general` del cierre anterior; quedan como están
 * hasta que el Líder vuelva a cerrarla (ahí se recalculan).
 * Las RLS ya dan escritura sobre respuestas/instancias/fotos cuando la
 * evaluación está ACTIVA, así que al reabrir los evaluadores recuperan permisos.
 */
export async function abrirEvaluacion(id: string): Promise<void> {
  const { error } = await supabase
    .from('evaluaciones')
    .update({ estado: 'ACTIVA', abierta_en: new Date().toISOString(), cerrada_en: null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function cerrarEvaluacion(id: string, puntuacion: number | null, comentario: string | null): Promise<void> {
  const { error } = await supabase
    .from('evaluaciones')
    .update({ estado: 'CERRADA', cerrada_en: new Date().toISOString(), puntuacion, comentario_general: comentario })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/* --- Drilldown: datos filtrados para el modal al hacer clic en un gráfico --- */

/** Alcance del drilldown: qué evaluaciones y qué respuestas incluir. */
export type AlcanceDrilldown = {
  sucursal_id?: string
  modulo_id?: string
  item_id?: string
  /** Solo evaluaciones donde el ítem quedó sin cumplir (proporción < 1). */
  soloNoCumple?: boolean
  evaluador_id?: string
  /** 'YYYY-MM'. */
  mes?: string
  /** Pista/placa (etiqueta de una instancia) del módulo de vehículos. */
  instancia_etiqueta?: string
}

export interface FilaDrilldownEval {
  id: string
  fecha: string
  sucursal: string
  estado: EstadoEvaluacion
  /** Puntaje global de la evaluación (0-100), o null si quedó sin cerrar. */
  puntaje: number | null
  /** Puntaje del elemento clickeado dentro de esa evaluación (módulo o ítem, 0-100). */
  puntajeScope: number | null
  /** Nº de respuestas puntuables dentro del alcance para esa evaluación. */
  muestras: number
  aperturador: string | null
}

export interface DetalleRespuestaEval {
  item_id: string
  texto: string
  modulo: string | null
  tipo: TipoItem
  peso: number
  /** 0..1 o null si la respuesta no puntúa. */
  proporcion: number | null
  cumple: boolean | null
  resumen: string
  instancia: string | null
  fotos: number
}

/**
 * Resume el valor de una respuesta en una línea legible, según el tipo de ítem.
 * Devuelve la proporción (0..1) y un texto corto del contenido cargado.
 */
export function resumenDeRespuesta(item: Item, valor: unknown): { proporcion: number | null; resumen: string } {
  const p = proporcionItem(item, valor)
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE': {
      const v = valor as ValorCumple | null
      const estado = v?.value == null ? 'Sin responder' : v.value ? 'Cumple' : 'No cumple'
      const info = v?.informativo ? ' · No aplica' : ''
      return { proporcion: p, resumen: `${estado}${info}` }
    }
    case 'CHECKLIST': {
      const v = valor as ValorChecklist | null
      const opts = (item.opciones ?? []) as Opcion[]
      const sel = v?.selected ?? []
      const labels = sel.map((id) => {
        const o = opts.find((x) => x.id === id)
        if (o?.tipo_respuesta === 'RANGO') return `${o.etiqueta}: ${v?.valores?.[id] ?? '—'}${o.unidad ? ` ${o.unidad}` : ''}`
        return o?.etiqueta ?? id
      })
      if (p === null) {
        if (v?.informativos?.length) return { proporcion: p, resumen: `No aplica en ${v.informativos.length} opción(es)` }
        return { proporcion: p, resumen: 'Sin opciones marcadas' }
      }
      return { proporcion: p, resumen: `${sel.length} de ${opts.length} opciones${labels.length ? ` · ${labels.join(' · ')}` : ''}` }
    }
    case 'LISTA_COLABORADORES': {
      const v = valor as ValorListaColaboradores | null
      const cols = v?.colaboradores ?? []
      if (!cols.length) return { proporcion: p, resumen: 'Sin trabajadores' }
      const opts = (item.opciones ?? []) as Opcion[]
      const enCuenta = cols.filter((c) => c.aplica)
      const enPuntaje = colaboradoresQueCuentan(cols)
      const conChecksAplicables = enPuntaje.filter((c) => opcionesAplicablesColaborador(c, opts).length > 0)
      const cumplen = conChecksAplicables.filter((c) => colaboradorCumple(c, opts)).length
      const sinPuntos = enCuenta.length - conChecksAplicables.length
      // Los que el evaluador no llegó a mirar se anuncian aparte: si no, el
      // tablero compone "3 de 3 cumplen" sin decir que eran veinte en la lista.
      const sinRevisar = enCuenta.length - enPuntaje.length
      return { proporcion: p, resumen: `${cumplen}/${conChecksAplicables.length} trabajadores cumplen${sinRevisar ? ` · ${sinRevisar} sin revisar` : ''}${sinPuntos ? ` · ${sinPuntos} sin puntos aplicables` : ''}${cols.some((c) => !c.aplica) ? ` · ${cols.length - enCuenta.length} excluido(s)` : ''}` }
    }
    case 'UNIDAD_CHECKLIST': {
      const v = valor as ValorUnidadChecklist | null
      const unids = v?.unidades ?? []
      if (!unids.length) return { proporcion: p, resumen: 'Sin unidades' }
      const opts = (item.opciones ?? []) as Opcion[]
      const cumplen = unids.filter((u) => unidadCumple(u, opts)).length
      return { proporcion: p, resumen: `${cumplen}/${unids.length} unidades completas` }
    }
    case 'PLANO_XY': {
      const v = valor as ValorPlano | null
      const pts = v?.puntos ?? []
      const marcados = puntosMarcadosPlano(v)
      const cumplen = marcados.filter((x) => x.cumple === true).length
      if (!pts.length) return { proporcion: p, resumen: 'Sin plano cargado' }
      if (!marcados.length) return { proporcion: p, resumen: `${pts.length} punto(s) sin veredicto` }
      return { proporcion: p, resumen: `${cumplen}/${marcados.length} puntos cumplen · ${pts.length} marcado(s)${v?.informativo ? ' · No aplica' : ''}` }
    }
    case 'CONCILIACION': {
      const v = valor as ValorConciliacion | null
      // Mismo criterio que el resumen del módulo: el sin hablador cuenta en el
      // total y nunca en los conciliados.
      const validos = (v?.productos ?? []).filter(
        (pro) => esSinHablador(pro) || (typeof pro.teorica === 'number' && typeof pro.fisica === 'number' && pro.teorica > 0)
      )
      if (!validos.length) {
        return { proporcion: p, resumen: v?.productos?.length ? `${v.productos.length} producto(s) escaneados` : 'Sin productos escaneados' }
      }
      const conc = validos.filter((pro) => !esSinHablador(pro) && pro.fisica === pro.teorica).length
      const tasa = Math.round(((validos.length - conc) / validos.length) * 100)
      return { proporcion: p, resumen: `${conc}/${validos.length} productos conciliados · descuadre ${tasa}%` }
    }
    default:
      return { proporcion: p, resumen: p != null ? `${Math.round(p * 100)}% de cumplimiento` : 'Sin responder' }
  }
}

/**
 * Evaluaciones del conjunto (ya acotado por rango/sucursal desde la consulta)
 * que caen dentro del alcance clickeado, con el puntaje global y el puntaje del
 * elemento al que se hizo clic. Ordenadas por fecha descendente.
 */
export function renglonesDrilldown(datos: ConjuntoDatos, f: AlcanceDrilldown = {}): FilaDrilldownEval[] {
  const itemDe = new Map<string, Item>()
  for (const i of datos.items) itemDe.set(i.id, i)
  const respuestasPorEval = new Map<string, Respuesta[]>()
  for (const r of datos.respuestas) {
    const arr = respuestasPorEval.get(r.evaluacion_id) ?? []
    arr.push(r)
    respuestasPorEval.set(r.evaluacion_id, arr)
  }
  const instanciaEtiqueta = new Map<string, string>()
  for (const ins of datos.instancias) instanciaEtiqueta.set(ins.id, ins.etiqueta)

  const filas: FilaDrilldownEval[] = []
  for (const ev of datos.evaluaciones) {
    if (f.sucursal_id && ev.sucursal_id !== f.sucursal_id) continue
    if (f.evaluador_id && (ev.aperturada_por || ev.id) !== f.evaluador_id) continue
    if (f.mes && ev.fecha.slice(0, 7) !== f.mes) continue

    const resp = respuestasPorEval.get(ev.id) ?? []
    let muestras = 0
    let okItem = 0
    let itemVisto = false
    for (const r of resp) {
      const item = itemDe.get(r.item_id)
      if (!item) continue
      if (f.modulo_id && item.modulo_id !== f.modulo_id) continue
      if (f.item_id && item.id !== f.item_id) continue
      if (f.instancia_etiqueta) {
        const etiq = r.instancia_id ? instanciaEtiqueta.get(r.instancia_id) : null
        if (etiq !== f.instancia_etiqueta) continue
      }
      const p = proporcionItem(aplicarOpcionesSucursal(item, ev.sucursal_id, datos.sucursalOpciones), r.valor)
      if (p === null) continue
      muestras++
      if (f.item_id) {
        itemVisto = true
        okItem = p
      }
    }
    if (f.item_id && !itemVisto) continue
    if (f.item_id && f.soloNoCumple && okItem >= 1) continue
    if (!f.item_id && f.modulo_id && muestras === 0) continue

    let puntajeScope: number | null = null
    if (f.modulo_id) {
      puntajeScope = puntajeModuloEnEvaluacion(datos, ev, f.modulo_id, respuestasPorEval, itemDe)
    } else if (f.item_id) {
      puntajeScope = Math.round(okItem * 100)
    }

    filas.push({
      id: ev.id,
      fecha: ev.fecha,
      sucursal: ev.sucursal?.nombre ?? ev.sucursal_id,
      estado: ev.estado,
      puntaje: ev.puntuacion,
      puntajeScope,
      muestras,
      aperturador: ev.aperturador?.nombre ?? null
    })
  }
  return filas.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.sucursal.localeCompare(b.sucursal, 'es'))
}

/**
 * Detalle de respuestas de una evaluación dentro del alcance (para el segundo
 * paso del modal): cada fila con el ítem, su contenido resumido y si cumple.
 */
export function detalleDeEvaluacion(datos: ConjuntoDatos, evaluacionId: string, f: AlcanceDrilldown = {}): DetalleRespuestaEval[] {
  const ev = datos.evaluaciones.find((e) => e.id === evaluacionId)
  const itemDe = new Map<string, Item>()
  for (const i of datos.items) itemDe.set(i.id, i)
  const moduloIndex = new Map<string, number>()
  datos.modulos.forEach((m, i) => moduloIndex.set(m.id, i))
  const instanciaEtiqueta = new Map<string, string>()
  for (const ins of datos.instancias) instanciaEtiqueta.set(ins.id, ins.etiqueta)
  const fotoPor = new Map<string, number>()
  for (const fot of datos.fotos) {
    const k = `${fot.evaluacion_id}|${fot.item_id}|${fot.instancia_id ?? ''}`
    fotoPor.set(k, (fotoPor.get(k) ?? 0) + 1)
  }

  const filas: DetalleRespuestaEval[] = []
  for (const r of datos.respuestas) {
    if (r.evaluacion_id !== evaluacionId) continue
    const item = itemDe.get(r.item_id)
    if (!item) continue
    if (f.modulo_id && item.modulo_id !== f.modulo_id) continue
    if (f.item_id && item.id !== f.item_id) continue
    if (f.instancia_etiqueta) {
      const etiq = r.instancia_id ? instanciaEtiqueta.get(r.instancia_id) : null
      if (etiq !== f.instancia_etiqueta) continue
    }
    const aplicado = aplicarOpcionesSucursal(item, ev?.sucursal_id ?? '', datos.sucursalOpciones)
    const { proporcion, resumen } = resumenDeRespuesta(aplicado, r.valor)
    filas.push({
      item_id: item.id,
      texto: item.texto,
      modulo: datos.modulos.find((m) => m.id === item.modulo_id)?.nombre ?? null,
      tipo: item.tipo,
      peso: pesoItem(item),
      proporcion,
      cumple: proporcion == null ? null : proporcion >= 1,
      resumen,
      instancia: r.instancia_id ? instanciaEtiqueta.get(r.instancia_id) ?? null : null,
      fotos: fotoPor.get(`${evaluacionId}|${item.id}|${r.instancia_id ?? ''}`) ?? 0
    })
  }

  const ordenIndex = (a: DetalleRespuestaEval) => {
    const item = itemDe.get(a.item_id)
    return (moduloIndex.get(item?.modulo_id ?? '') ?? 99) * 1000 + (item?.orden ?? 99)
  }
  return filas.sort(
    (a, b) => ordenIndex(a) - ordenIndex(b) || (a.instancia ?? '').localeCompare(b.instancia ?? '', 'es') || a.texto.localeCompare(b.texto, 'es')
  )
}