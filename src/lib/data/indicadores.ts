import { supabase } from '../supabase'
import type { Evaluacion, Respuesta, Item, Foto, Modulo, VistaEvaluacion } from '../types'
import { valorBinario } from '../scoring'

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
}

export interface DetalleEvaluacion {
  evaluacion: VistaEvaluacion
  respuestas: Respuesta[]
  items: Item[]
  modulos: Modulo[]
  fotos: Foto[]
}

export async function obtenerEvaluacion(id: string): Promise<DetalleEvaluacion | null> {
  const { data: ev } = await supabase
    .from('evaluaciones')
    .select('*, sucursal:sucursales(id,nombre,shop_id,direccion), evaluador:profiles(id,nombre)')
    .eq('id', id)
    .maybeSingle()
  if (!ev) return null
  const evaluacion = ev as VistaEvaluacion

  const [resp, itemsResp, mods, fotos] = await Promise.all([
    supabase.from('respuestas').select('*').eq('evaluacion_id', id),
    (async () => {
      const rr = (await supabase.from('respuestas').select('item_id').eq('evaluacion_id', id)).data ?? []
      const itemIds = Array.from(new Set((rr as { item_id: string }[]).map((r) => r.item_id)))
      if (!itemIds.length) return [] as Item[]
      return ((await supabase.from('items').select('*').in('id', itemIds)).data ?? []) as Item[]
    })(),
    supabase.from('modulos').select('*').order('orden'),
    supabase.from('fotos').select('*').eq('evaluacion_id', id)
  ])

  const modulos = ((mods.data ?? []) as Modulo[]).filter((m) => itemsResp.some((i) => i.modulo_id === m.id))

  return {
    evaluacion,
    respuestas: (resp.data ?? []) as Respuesta[],
    items: itemsResp,
    modulos,
    fotos: (fotos.data ?? []) as Foto[]
  }
}

export async function consultarEvaluaciones(f: FiltrosIndicadores): Promise<ConjuntoDatos> {
  let query = supabase
    .from('evaluaciones')
    .select('*, sucursal:sucursales(id,nombre,shop_id,direccion), evaluador:profiles(id,nombre)')
    .order('fecha', { ascending: false })

  const sucursales = f.sucursal_ids && f.sucursal_ids.length ? f.sucursal_ids : null
  if (sucursales) query = query.in('sucursal_id', sucursales)
  if (f.desde) query = query.gte('fecha', f.desde)
  if (f.hasta) query = query.lte('fecha', f.hasta)

  const { data: evals } = await query
  const evaluaciones = (evals ?? []) as VistaEvaluacion[]
  const vacio: ConjuntoDatos = { evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [] }
  if (!evaluaciones.length) return vacio

  const ids = evaluaciones.map((e) => e.id)

  const [resp, fot, mods, itemsResp] = await Promise.all([
    supabase.from('respuestas').select('*').in('evaluacion_id', ids),
    supabase.from('fotos').select('*').in('evaluacion_id', ids).order('created_at', { ascending: false }),
    supabase.from('modulos').select('*').order('orden'),
    (async () => {
      const respuestas2 = (await supabase.from('respuestas').select('*').in('evaluacion_id', ids)).data ?? []
      const itemIds = Array.from(new Set(respuestas2.map((r) => r.item_id)))
      if (!itemIds.length) return [] as Item[]
      const it = await supabase.from('items').select('*').in('id', itemIds)
      return (it.data ?? []) as Item[]
    })()
  ])

  let items = itemsResp
  if (f.modulo_id) {
    const idsItemsModulo = items.filter((i) => i.modulo_id === f.modulo_id).map((i) => i.id)
    items = items.filter((i) => idsItemsModulo.includes(i.id))
    const respuestas = (resp.data ?? [])
      .filter((r) => idsItemsModulo.includes(r.item_id))
      .map((r) => ({ ...r }))
    return {
      evaluaciones,
      respuestas,
      items,
      modulos: ((mods.data ?? []) as Modulo[]).filter((m) => m.id === f.modulo_id),
      fotos: (fot.data ?? []) as Foto[]
    }
  }

  return {
    evaluaciones,
    respuestas: (resp.data ?? []) as Respuesta[],
    items,
    modulos: (mods.data ?? []) as Modulo[],
    fotos: (fot.data ?? []) as Foto[]
  }
}

export interface ResumenEvaluacion {
  puntaje: number | null
  itemsBinarios: number
  itemsBinariosOk: number
}

export function resumirEvaluacion(ev: Evaluacion, resps: Respuesta[], items: Item[]): ResumenEvaluacion {
  const rr = resps
    .filter((r) => r.evaluacion_id === ev.id)
    .map((r) => ({ item: items.find((i) => i.id === r.item_id), valor: r.valor }))
    .filter((x): x is { item: Item; valor: unknown } => !!x.item)

  const binarios = rr.map((r) => valorBinario(r.item, r.valor)).filter((x) => x !== null) as boolean[]
  const puntaje = binarios.length
    ? Math.round((binarios.filter(Boolean).length / binarios.length) * 10000) / 100
    : ev.puntuacion

  return { puntaje, itemsBinarios: binarios.length, itemsBinariosOk: binarios.filter(Boolean).length }
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
  const acum = new Map<string, { modulo_id: string; nombre: string; ok: number; total: number; evals: Set<string> }>()
  for (const r of datos.respuestas) {
    const item = datos.items.find((i) => i.id === r.item_id)
    if (!item) continue
    const bin = valorBinario(item, r.valor)
    if (bin === null) continue
    const nombre = datos.modulos.find((mm) => mm.id === item.modulo_id)?.nombre ?? 'Módulo'
    let a = acum.get(item.modulo_id)
    if (!a) {
      a = { modulo_id: item.modulo_id, nombre, ok: 0, total: 0, evals: new Set() }
      acum.set(item.modulo_id, a)
    }
    a.total++
    if (bin) a.ok++
    a.evals.add(r.evaluacion_id)
  }
  return Array.from(acum.values())
    .map(({ modulo_id, nombre, ok, total, evals }) => ({
      modulo_id,
      nombre,
      puntaje: total ? Math.round((ok / total) * 10000) / 100 : null,
      evaluaciones: evals.size
    }))
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0))
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
    const { puntaje } = resumirEvaluacion(ev, datos.respuestas, datos.items)
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
  mes: string
  puntaje: number | null
  completadas: number
}

export function evolucionMensual(datos: ConjuntoDatos): SerieMes[] {
  const porMes = new Map<string, { puntajes: number[]; completadas: number }>()
  for (const ev of datos.evaluaciones) {
    const key = ev.fecha.slice(0, 7)
    const { puntaje } = resumirEvaluacion(ev, datos.respuestas, datos.items)
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
    .map(([mes, v]) => {
      const fecha = new Date(mes + '-01T12:00:00')
      return {
        mes: espanol.format(fecha),
        puntaje: v.puntajes.length ? Math.round((v.puntajes.reduce((a, b) => a + b, 0) / v.puntajes.length) * 100) / 100 : null,
        completadas: v.completadas
      }
    })
}

export function peoresItems(datos: ConjuntoDatos): { item_id: string; texto: string; modulo_id: string; ok: number; total: number; ratio: number }[] {
  const porItem = new Map<string, { item_id: string; texto: string; modulo_id: string; ok: number; total: number }>()
  for (const r of datos.respuestas) {
    const item = datos.items.find((i) => i.id === r.item_id)
    if (!item) continue
    const v = valorBinario(item, r.valor)
    if (v === null) continue
    const e = porItem.get(r.item_id)
    if (e) {
      e.total++
      if (v) e.ok++
    } else {
      porItem.set(r.item_id, {
        item_id: r.item_id,
        texto: item.texto,
        modulo_id: item.modulo_id,
        ok: v ? 1 : 0,
        total: 1
      })
    }
  }
  return Array.from(porItem.values())
    .map((x) => ({ ...x, ratio: x.total ? x.ok / x.total : 0 }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 10)
}

export function porEvaluador(datos: ConjuntoDatos): { evaluador_id: string; nombre: string; puntaje: number | null; evaluaciones: number }[] {
  const porE = new Map<string, { nombre: string; puntajes: number[]; n: number }>()
  for (const ev of datos.evaluaciones) {
    const { puntaje } = resumirEvaluacion(ev, datos.respuestas, datos.items)
    const e = porE.get(ev.evaluador_id)
    if (e) {
      if (puntaje != null) e.puntajes.push(puntaje)
      e.n++
    } else {
      porE.set(ev.evaluador_id, { nombre: ev.evaluador?.nombre || 'Sin nombre', puntajes: puntaje != null ? [puntaje] : [], n: 1 })
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
  const celdas: Record<string, Record<string, { ok: number; n: number }>> = {}
  const nombresSuc: Record<string, string> = {}
  for (const ev of datos.evaluaciones) {
    nombresSuc[ev.sucursal_id] = ev.sucursal?.nombre ?? ev.sucursal_id
    for (const r of datos.respuestas.filter((x) => x.evaluacion_id === ev.id)) {
      const item = datos.items.find((i) => i.id === r.item_id)
      if (!item) continue
      const bin = valorBinario(item, r.valor)
      if (bin === null) continue
      const c = celdas[ev.sucursal_id]?.[item.modulo_id] ?? { ok: 0, n: 0 }
      c.n++
      if (bin) c.ok++
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
        puntaje: c && c.n ? Math.round((c.ok / c.n) * 10000) / 100 : null
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