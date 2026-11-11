import { supabase } from '../supabase'
import { getCache, putCache, type CacheData } from '../offline/db'
import type { Modulo, Item, Sucursal, Departamento, SucursalModulo, SucursalItem, SucursalOpcion, DepartamentoModulo, DepartamentoItem, DepartamentoOpcion } from '../types'

export async function obtenerCacheLocal(): Promise<CacheData | undefined> {
  return getCache()
}

export async function refrescarCatalogo(evaluadorId: string): Promise<CacheData> {
  const [modulos, items, sucursales, departamentos, asignaciones, asignacionesModulos, sucursalModulos, sucursalItems, sucursalOpciones, sucursalPermisos, departamentoModulos, departamentoItems, departamentoOpciones] = await Promise.all([
    selectSeguro(supabase.from('modulos').select('*').eq('activo', true).order('orden').order('nombre')),
    selectSeguro(supabase.from('items').select('*').eq('activo', true)),
    selectSeguro(supabase.from('sucursales').select('*, gerente:profiles!sucursales_gerente_id_fkey(id, nombre)').eq('activa', true).order('nombre')),
    selectSeguro(supabase.from('departamentos_centralizados').select('*').eq('activa', true).order('nombre')),
    selectSeguro(supabase.from('asignaciones').select('*').eq('evaluador_id', evaluadorId).eq('activa', true)),
    selectSeguro(supabase.from('asignaciones_modulos').select('*').eq('evaluador_id', evaluadorId).eq('activa', true)),
    selectSeguro(supabase.from('sucursal_modulos').select('*').eq('activa', true)),
    selectSeguro(supabase.from('sucursal_items').select('*').eq('activa', true)),
    selectSeguro(supabase.from('sucursal_opciones').select('*').eq('activa', true)),
    // Sin filtro por `vigente`: la lista de permisos se arma en cada pantalla y
    // ahí se decide cuáles entran. El caché guarda el catálogo completo.
    selectSeguro(supabase.from('sucursal_permisos').select('*')),
    selectSeguro(supabase.from('departamento_modulos').select('*').eq('activa', true)),
    selectSeguro(supabase.from('departamento_items').select('*').eq('activa', true)),
    selectSeguro(supabase.from('departamento_opciones').select('*').eq('activa', true))
  ])

  const data: CacheData = {
    modulos: modulos as Modulo[],
    items: items as Item[],
    sucursales: sucursales as Sucursal[],
    departamentos: departamentos as Departamento[],
    asignaciones: asignaciones as CacheData['asignaciones'],
    asignacionesModulos: asignacionesModulos as CacheData['asignacionesModulos'],
    sucursalModulos: sucursalModulos as SucursalModulo[],
    sucursalItems: sucursalItems as SucursalItem[],
    sucursalOpciones: sucursalOpciones as SucursalOpcion[],
    sucursalPermisos: sucursalPermisos as CacheData['sucursalPermisos'],
    departamentoModulos: departamentoModulos as DepartamentoModulo[],
    departamentoItems: departamentoItems as DepartamentoItem[],
    departamentoOpciones: departamentoOpciones as DepartamentoOpcion[],
    updated_at: Date.now()
  }
  await putCache(data)
  return data
}

async function selectSeguro(p: PromiseLike<{ data: unknown[] | null }>): Promise<unknown[]> {
  try {
    const r = await p
    return r.data ?? []
  } catch {
    return []
  }
}

export type SucursalVista = Sucursal & {
  gerente?: { id: string; nombre: string } | null
}

export async function listarSucursalesAdmin(): Promise<SucursalVista[]> {
  const { data } = await supabase
    .from('sucursales')
    .select('*, gerente:profiles!sucursales_gerente_id_fkey(id, nombre)')
    .order('nombre')
  return (data ?? []) as SucursalVista[]
}

export async function guardarSucursal(s: Partial<Sucursal> & { nombre: string }): Promise<void> {
  if (s.id) {
    const { id, ...rest } = s
    await supabase.from('sucursales').update(rest).eq('id', id)
  } else {
    await supabase.from('sucursales').insert({
      nombre: s.nombre,
      shop_id: s.shop_id ?? null,
      branch_id: s.branch_id ?? null,
      direccion: s.direccion,
      gerente_id: s.gerente_id ?? null
    })
  }
}

export async function listarModulosAdmin(): Promise<(Modulo & { _items: Item[] })[]> {
  const { data: mods } = await supabase.from('modulos').select('*').order('orden').order('created_at')
  const { data: items } = await supabase.from('items').select('*').order('orden')
  const modsArr = (mods ?? []) as Modulo[]
  const itemsArr = (items ?? []) as Item[]
  return modsArr.map((m) => ({
    ...m,
    _items: itemsArr
      .filter((i) => i.modulo_id === m.id)
      .sort((a, b) => a.orden - b.orden)
  }))
}

export async function guardarModulo(m: Partial<Modulo> & { nombre: string }): Promise<void> {
  if (m.id) {
    const { id, ...rest } = m
    const { error } = await supabase.from('modulos').update(rest).eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await supabase.from('modulos').insert({ nombre: m.nombre, descripcion: m.descripcion ?? '', icono: m.icono ?? 'clipboard-list', orden: m.orden ?? 0, compartido: m.compartido ?? false }).select('id').single()
    if (error) throw new Error(error.message)
    void data
  }
}

export async function eliminarModulo(id: string): Promise<void> {
  await supabase.from('modulos').delete().eq('id', id)
}

export async function guardarItem(i: Partial<Item> & { modulo_id: string; tipo: Item['tipo']; texto: string }): Promise<string | null> {
  // items.api_campos es NOT NULL (schema.sql): mandarlo explícitamente en null
  // devuelve 400 (23502) y el guardado falla. Sin API se guarda como lista vacía.
  const apiCampos = i.api_campos ?? []
  if (i.id) {
    const { id, ...rest } = i
    const { data, error } = await supabase.from('items').update({ ...rest, api_campos: apiCampos }).eq('id', id).select('id').single()
    if (error) throw error
    return data?.id ?? id
  }
  const { data, error } = await supabase.from('items').insert({
    modulo_id: i.modulo_id,
    tipo: i.tipo,
    texto: i.texto,
    descripcion: i.descripcion ?? '',
    opciones: i.opciones ?? [],
    colaboradores_filtro: i.colaboradores_filtro ?? null,
    responsables: i.responsables ?? [],
    orden: i.orden ?? 0,
    requerido: i.requerido ?? false,
    puntaje: i.puntaje ?? 0,
    activo: i.activo ?? true,
    padre_id: i.padre_id ?? null,
    api_id: i.api_id ?? null,
    api_campos: apiCampos,
    permitir_duplicados: i.permitir_duplicados ?? false,
    repetible: i.repetible ?? true,
    contra_dato: i.contra_dato ?? 'SOH',
    doble_check: i.doble_check ?? false,
    precarga: i.precarga ?? true
  }).select('id').single()
  if (error) throw error
  return data?.id ?? null
}

export async function eliminarItem(id: string): Promise<void> {
  const { error } = await supabase.from('items').delete().eq('id', id)
  if (error) throw error
}

export async function listarSucursalConfigAdmin(sucursalId: string): Promise<{ modulos: string[]; items: string[]; opciones: { item_id: string; opcion_id: string }[] }> {
  const [mods, items, opciones] = await Promise.all([
    supabase.from('sucursal_modulos').select('modulo_id').eq('sucursal_id', sucursalId).eq('activa', true),
    supabase.from('sucursal_items').select('item_id').eq('sucursal_id', sucursalId).eq('activa', true),
    supabase.from('sucursal_opciones').select('item_id, opcion_id').eq('sucursal_id', sucursalId).eq('activa', true)
  ])
  return {
    modulos: (mods.data ?? []).map((r) => r.modulo_id as string),
    items: (items.data ?? []).map((r) => r.item_id as string),
    opciones: (opciones.data ?? []).map((r) => ({ item_id: r.item_id as string, opcion_id: r.opcion_id as string }))
  }
}

export async function configurarSucursalModulos(sucursalId: string, modulosIds: string[]): Promise<void> {
  const { data: actuales, error: errorLectura } = await supabase
    .from('sucursal_modulos')
    .select('id, modulo_id, activa')
    .eq('sucursal_id', sucursalId)
  // Sin la lectura previa no se sabe qué cambiar, y a ciegas los inserts
  // chocarían contra la `unique (sucursal_id, modulo_id)` en silencio.
  if (errorLectura) throw new Error(errorLectura.message)
  const rows = (actuales ?? []) as { id: string; modulo_id: string; activa: boolean }[]
  const ids = new Set(modulosIds)
  const aInsertar = modulosIds.filter((mid) => !rows.some((r) => r.modulo_id === mid))
  const aActivar = rows.filter((r) => ids.has(r.modulo_id) && !r.activa).map((r) => r.id)
  const aDesactivar = rows.filter((r) => !ids.has(r.modulo_id)).map((r) => r.id)
  // Los builders resuelven con el error adentro: hay que leer cada
  // respuesta, no sólo esperar. Sin esto el guardado se daba por hecho y la
  // bitácora quedaba muda, sin que nadie supiera que la base había rechazado
  // el cambio.
  const ops: PromiseLike<{ error: { message: string } | null }>[] = []
  if (aInsertar.length) ops.push(supabase.from('sucursal_modulos').insert(aInsertar.map((modulo_id) => ({ sucursal_id: sucursalId, modulo_id }))))
  if (aActivar.length) ops.push(supabase.from('sucursal_modulos').update({ activa: true }).in('id', aActivar))
  if (aDesactivar.length) ops.push(supabase.from('sucursal_modulos').update({ activa: false }).in('id', aDesactivar))
  for (const r of await Promise.all(ops)) {
    if (r.error) throw new Error(r.error.message || 'No se pudieron guardar los módulos de la sucursal.')
  }
}

export async function configurarSucursalItems(sucursalId: string, itemsIds: string[]): Promise<void> {
  const { data: actuales } = await supabase.from('sucursal_items').select('id, item_id, activa').eq('sucursal_id', sucursalId)
  const rows = (actuales ?? []) as { id: string; item_id: string; activa: boolean }[]
  const ids = new Set(itemsIds)
  const aInsertar = itemsIds.filter((iid) => !rows.some((r) => r.item_id === iid))
  const aActivar = rows.filter((r) => ids.has(r.item_id) && !r.activa).map((r) => r.id)
  const aDesactivar = rows.filter((r) => !ids.has(r.item_id)).map((r) => r.id)
  const ops: Promise<void>[] = []
  if (aInsertar.length) ops.push(Promise.resolve(supabase.from('sucursal_items').insert(aInsertar.map((item_id) => ({ sucursal_id: sucursalId, item_id })))).then(() => undefined))
  if (aActivar.length) ops.push(Promise.resolve(supabase.from('sucursal_items').update({ activa: true }).in('id', aActivar)).then(() => undefined))
  if (aDesactivar.length) ops.push(Promise.resolve(supabase.from('sucursal_items').update({ activa: false }).in('id', aDesactivar)).then(() => undefined))
  await Promise.all(ops)
}

export async function configurarSucursalOpciones(sucursalId: string, opciones: { item_id: string; opcion_id: string }[]): Promise<void> {
  const { data: actuales } = await supabase.from('sucursal_opciones').select('id, item_id, opcion_id, activa').eq('sucursal_id', sucursalId)
  const rows = (actuales ?? []) as { id: string; item_id: string; opcion_id: string; activa: boolean }[]
  const pares = new Set(opciones.map((o) => `${o.item_id}:${o.opcion_id}`))
  const aInsertar = opciones.filter((o) => !rows.some((r) => r.item_id === o.item_id && r.opcion_id === o.opcion_id))
  const aActivar = rows.filter((r) => pares.has(`${r.item_id}:${r.opcion_id}`) && !r.activa).map((r) => r.id)
  const aDesactivar = rows.filter((r) => !pares.has(`${r.item_id}:${r.opcion_id}`)).map((r) => r.id)
  const ops: Promise<void>[] = []
  if (aInsertar.length) ops.push(Promise.resolve(supabase.from('sucursal_opciones').insert(aInsertar.map((o) => ({ sucursal_id: sucursalId, item_id: o.item_id, opcion_id: o.opcion_id })))).then(() => undefined))
  if (aActivar.length) ops.push(Promise.resolve(supabase.from('sucursal_opciones').update({ activa: true }).in('id', aActivar)).then(() => undefined))
  if (aDesactivar.length) ops.push(Promise.resolve(supabase.from('sucursal_opciones').update({ activa: false }).in('id', aDesactivar)).then(() => undefined))
  await Promise.all(ops)
}