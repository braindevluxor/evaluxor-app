/**
 * Catálogo de departamentos (áreas que no son sucursales) para
 * Configuración > Departamentos.
 *
 * Son unidades con evaluación propia, así que la tabla es deliberadamente
 * corta: nombre y estado. Lo demás (módulos activos, evaluaciones, filtros)
 * entra en la tanda siguiente, cuando `evaluaciones` ya pueda apuntar a un
 * departamento en vez de a una sucursal.
 *
 * Solo el LÍDER entra a esta pantalla y las políticas de escritura solo lo
 * permiten a él (`departamentos_centralizados_lider` en
 * `supabase/departamentos-centralizados.sql`).
 *
 * La tabla física se llama `departamentos_centralizados` porque en la base ya
 * existía otra `departamentos` (de otro proceso). En la app todo sigue siendo
 * "departamento": el sufijo no pasa de la consulta al servidor.
 */
import { supabase } from '../supabase'
import type { Departamento } from '../types'

/**
 * Listado completo (activos y desactivados), orden alfabético: en un catálogo
 * tan corto es más fácil leerlo así que por estado.
 */
export async function listarDepartamentosAdmin(): Promise<Departamento[]> {
  const { data, error } = await supabase.from('departamentos_centralizados').select('*').order('nombre')
  if (error) throw new Error('No se pudieron cargar los departamentos.')
  return (data ?? []) as Departamento[]
}

/**
 * Alta y edición en una sola función, igual que `guardarSucursal`.
 * Un nombre repetido choca con `uniq_departamentos_nombre` (índice sobre
 * `lower(nombre)`), y acá se traduce al mensaje que entiende quien lo llenó.
 */
export async function guardarDepartamento(
  d: Partial<Departamento> & { nombre: string }
): Promise<void> {
  if (d.id) {
    const { id, ...rest } = d
    const { error } = await supabase.from('departamentos_centralizados').update(rest).eq('id', id)
    if (error) throw mensajeDeError(error.code, error.message)
  } else {
    const { error } = await supabase
      .from('departamentos_centralizados')
      .insert({ nombre: d.nombre, activa: d.activa ?? true })
    if (error) throw mensajeDeError(error.code, error.message)
  }
}

/**
 * Baja física del listado. Hoy nada apunta a `departamentos`, así que el
 * borrado es directo; cuando `evaluaciones.departamento_id` cuelgue de acá,
 * Postgres lo frena con su restricción (23503) y el mensaje de abajo deja de
 * ser hipotético: no se pierde una evaluación por borrar un nombre.
 *
 * Para que un departamento deje de aparecer sin borrar nada, existe la baja
 * lógica: `activa = false` en `guardarDepartamento`.
 */
export async function eliminarDepartamento(id: string): Promise<void> {
  const { error } = await supabase.from('departamentos_centralizados').delete().eq('id', id)
  if (!error) return
  throw error.code === '23503'
    ? new Error('No se puede eliminar: tiene evaluaciones asociadas. Desactívalo en su lugar.')
    : new Error(error.message)
}

/** 23505 = violación de único (el nombre del departamento ya existe). */
function mensajeDeError(code: string | undefined, mensaje: string): Error {
  return code === '23505'
    ? new Error('Ya existe un departamento con ese nombre.')
    : new Error(mensaje)
}

// ---------------------------------------------------------------------------
// Configuración por departamento: qué módulos, ítems y puntos aplican.
//
// Es el gemelo exacto de `listarSucursalConfigAdmin` y `configurarSucursal*`
// (en `catalog.ts`), con las tablas `departamento_*` y la columna
// `departamento_id`. Misma semántica: sin filas activas aplica todo; con
// filas, solo lo marcado. Las funciones se guardan sin borrar filas (se
// insertan las nuevas y se activan/desactivan las que cambian), así el
// historial de lo que estuvo marcado no se pierde.
// ---------------------------------------------------------------------------

export interface ConfigDepartamentoVista {
  modulos: string[]
  items: string[]
  opciones: { item_id: string; opcion_id: string }[]
}

export async function listarDepartamentoConfigAdmin(
  departamentoId: string
): Promise<ConfigDepartamentoVista> {
  const [mods, items, opciones] = await Promise.all([
    supabase.from('departamento_modulos').select('modulo_id').eq('departamento_id', departamentoId).eq('activa', true),
    supabase.from('departamento_items').select('item_id').eq('departamento_id', departamentoId).eq('activa', true),
    supabase.from('departamento_opciones').select('item_id, opcion_id').eq('departamento_id', departamentoId).eq('activa', true)
  ])
  return {
    modulos: (mods.data ?? []).map((r) => r.modulo_id as string),
    items: (items.data ?? []).map((r) => r.item_id as string),
    opciones: (opciones.data ?? []).map((r) => ({ item_id: r.item_id as string, opcion_id: r.opcion_id as string }))
  }
}

export async function configurarDepartamentoModulos(
  departamentoId: string,
  modulosIds: string[]
): Promise<void> {
  const { data: actuales } = await supabase
    .from('departamento_modulos')
    .select('id, modulo_id, activa')
    .eq('departamento_id', departamentoId)
  const rows = (actuales ?? []) as { id: string; modulo_id: string; activa: boolean }[]
  const ids = new Set(modulosIds)
  const aInsertar = modulosIds.filter((mid) => !rows.some((r) => r.modulo_id === mid))
  const aActivar = rows.filter((r) => ids.has(r.modulo_id) && !r.activa).map((r) => r.id)
  const aDesactivar = rows.filter((r) => !ids.has(r.modulo_id)).map((r) => r.id)
  const ops: PromiseLike<unknown>[] = []
  if (aInsertar.length) ops.push(supabase.from('departamento_modulos').insert(aInsertar.map((modulo_id) => ({ departamento_id: departamentoId, modulo_id }))))
  if (aActivar.length) ops.push(supabase.from('departamento_modulos').update({ activa: true }).in('id', aActivar))
  if (aDesactivar.length) ops.push(supabase.from('departamento_modulos').update({ activa: false }).in('id', aDesactivar))
  await Promise.all(ops)
}

export async function configurarDepartamentoItems(
  departamentoId: string,
  itemsIds: string[]
): Promise<void> {
  const { data: actuales } = await supabase
    .from('departamento_items')
    .select('id, item_id, activa')
    .eq('departamento_id', departamentoId)
  const rows = (actuales ?? []) as { id: string; item_id: string; activa: boolean }[]
  const ids = new Set(itemsIds)
  const aInsertar = itemsIds.filter((iid) => !rows.some((r) => r.item_id === iid))
  const aActivar = rows.filter((r) => ids.has(r.item_id) && !r.activa).map((r) => r.id)
  const aDesactivar = rows.filter((r) => !ids.has(r.item_id)).map((r) => r.id)
  const ops: PromiseLike<unknown>[] = []
  if (aInsertar.length) ops.push(supabase.from('departamento_items').insert(aInsertar.map((item_id) => ({ departamento_id: departamentoId, item_id }))))
  if (aActivar.length) ops.push(supabase.from('departamento_items').update({ activa: true }).in('id', aActivar))
  if (aDesactivar.length) ops.push(supabase.from('departamento_items').update({ activa: false }).in('id', aDesactivar))
  await Promise.all(ops)
}

export async function configurarDepartamentoOpciones(
  departamentoId: string,
  opciones: { item_id: string; opcion_id: string }[]
): Promise<void> {
  const { data: actuales } = await supabase
    .from('departamento_opciones')
    .select('id, item_id, opcion_id, activa')
    .eq('departamento_id', departamentoId)
  const rows = (actuales ?? []) as { id: string; item_id: string; opcion_id: string; activa: boolean }[]
  const pares = new Set(opciones.map((o) => `${o.item_id}:${o.opcion_id}`))
  const aInsertar = opciones.filter((o) => !rows.some((r) => r.item_id === o.item_id && r.opcion_id === o.opcion_id))
  const aActivar = rows.filter((r) => pares.has(`${r.item_id}:${r.opcion_id}`) && !r.activa).map((r) => r.id)
  const aDesactivar = rows.filter((r) => !pares.has(`${r.item_id}:${r.opcion_id}`)).map((r) => r.id)
  const ops: PromiseLike<unknown>[] = []
  if (aInsertar.length) ops.push(supabase.from('departamento_opciones').insert(aInsertar.map((o) => ({ departamento_id: departamentoId, item_id: o.item_id, opcion_id: o.opcion_id }))))
  if (aActivar.length) ops.push(supabase.from('departamento_opciones').update({ activa: true }).in('id', aActivar))
  if (aDesactivar.length) ops.push(supabase.from('departamento_opciones').update({ activa: false }).in('id', aDesactivar))
  await Promise.all(ops)
}
