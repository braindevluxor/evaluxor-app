import { supabase } from '../supabase'
import type { Sucursal, SucursalComputador, SucursalPermiso } from '../types'

/**
 * Parámetros operativos de una sucursal: los contadores de equipos de la tienda
 * más las dos listas que no son un número (`sucursal_computadores`,
 * `sucursal_permisos`).
 *
 * Se leen y se escriben juntos porque para el Líder son una sola pantalla: la
 * ficha de la tienda. Los contadores viajan como columnas de `sucursales` y
 * las listas en sus tablas, así que el guardado son tres destinos distintos.
 */
export interface ParametrosSucursal {
  equipos_pos: number
  verificadores_precio: number
  pantallas_publicitarias: number
  cabezales: number
  pda: number
  computadores: SucursalComputador[]
  permisos: SucursalPermiso[]
}

/** Los cinco contadores, para no repetir la lista de columnas al leer y al escribir. */
export const COLUMNAS_CONTADORES = [
  'equipos_pos',
  'verificadores_precio',
  'pantallas_publicitarias',
  'cabezales',
  'pda'
] as const

type Contador = (typeof COLUMNAS_CONTADORES)[number]

/**
 * Una fila de la lista tal como queda en pantalla: con `id` si ya existe en la
 * nube y sin él si es nueva. Es lo que se guarda, no la fila de la tabla (que
 * trae `sucursal_id` y `created_at`, que la pantalla no toca).
 */
export type FilaEditada<T> = Omit<T, 'id' | 'sucursal_id' | 'created_at'> & { id?: string }

export async function cargarParametrosSucursal(sucursalId: string): Promise<ParametrosSucursal> {
  const [sucursal, computadores, permisos] = await Promise.all([
    supabase.from('sucursales').select(`id, ${COLUMNAS_CONTADORES.join(', ')}`).eq('id', sucursalId).maybeSingle(),
    supabase.from('sucursal_computadores').select('*').eq('sucursal_id', sucursalId).order('nombre'),
    supabase.from('sucursal_permisos').select('*').eq('sucursal_id', sucursalId).order('nombre')
  ])
  if (sucursal.error) throw new Error(sucursal.error.message)
  if (computadores.error) throw new Error(computadores.error.message)
  if (permisos.error) throw new Error(permisos.error.message)

  const fila = sucursal.data as Pick<Sucursal, Contador> | null
  return {
    // `?? 0`: un contador vacío es «cero equipos», no «sin dato». El `default 0`
    // de la columna cubre lo nuevo; el `?? 0` cubre la fila vieja en caché.
    equipos_pos: fila?.equipos_pos ?? 0,
    verificadores_precio: fila?.verificadores_precio ?? 0,
    pantallas_publicitarias: fila?.pantallas_publicitarias ?? 0,
    cabezales: fila?.cabezales ?? 0,
    pda: fila?.pda ?? 0,
    computadores: (computadores.data ?? []) as SucursalComputador[],
    permisos: (permisos.data ?? []) as SucursalPermiso[]
  }
}

/**
 * Qué hay que hacer con cada lista para que la nube quede igual que en pantalla:
 * insertar las filas nuevas, actualizar las que cambiaron y borrar las que se
 * quitaron.
 *
 * Es puro a propósito: el diff es la parte que puede romper datos (una fila de
 * más es un permiso fantasma, una de menos es un equipo que deja de existir),
 * así que se prueba sola, sin red ni base de datos. Los cambios salen campo por
 * campo: tocar el `vence` de un permiso no reescribe su nombre.
 */
export function planificarGuardado<T extends { id: string }>(
  actuales: T[],
  editadas: FilaEditada<T>[],
  campos: (keyof T)[]
): { insertar: FilaEditada<T>[]; actualizar: { id: string; cambios: Partial<T> }[]; eliminar: string[] } {
  const porId = new Map(actuales.map((f) => [f.id, f]))
  const insertar: FilaEditada<T>[] = []
  const actualizar: { id: string; cambios: Partial<T> }[] = []
  const conservadas = new Set<string>()

  for (const fila of editadas) {
    if (!fila.id) {
      const resto = { ...fila } as Record<string, unknown>
      delete resto.id
      insertar.push(resto as FilaEditada<T>)
      continue
    }
    conservadas.add(fila.id)
    const original = porId.get(fila.id)
    if (!original) continue
    const antes = original as unknown as Record<string, unknown>
    const despues = fila as unknown as Record<string, unknown>
    const cambios: Partial<T> = {}
    for (const campo of campos) {
      const clave = campo as string
      if (!iguales(antes[clave], despues[clave])) (cambios as Record<string, unknown>)[clave] = normalizaTexto(despues[clave])
    }
    if (Object.keys(cambios).length) actualizar.push({ id: fila.id, cambios })
  }

  const eliminar = actuales.filter((f) => !conservadas.has(f.id)).map((f) => f.id)
  return { insertar, actualizar, eliminar }
}

/**
 * Dos valores de un campo son «iguales» para el diff. La trampa es el texto
 * vacío contra null: en pantalla «sin número» se escribe `''` y en la tabla es
 * `null`, y sin esto el guardado reescribiría la fila entera cada vez.
 */
function iguales(actual: unknown, editado: unknown): boolean {
  return normaliza(actual) === normaliza(normalizaTexto(editado))
}

/** Vacío (string o solo espacios) es null: en la tabla no se guardan huecos en blanco. */
function normalizaTexto(valor: unknown): unknown {
  return typeof valor === 'string' && !valor.trim() ? null : valor
}

function normaliza(valor: unknown): string {
  if (valor == null) return ' null'
  if (typeof valor === 'boolean') return valor ? 'true' : 'false'
  return `${typeof valor}:${String(valor)}`
}

/** Pasa la fila de pantalla a la forma de la tabla: texto vacío → null. */
export function paraGuardar<T extends Record<string, unknown>>(fila: T): T {
  const salida: Record<string, unknown> = { ...fila }
  for (const [clave, valor] of Object.entries(salida)) {
    if (clave === 'cantidad' || clave === 'vigente' || clave === 'tipo') continue
    salida[clave] = normalizaTexto(valor)
  }
  return salida as T
}

/**
 * Lo que la pantalla tiene entre manos: los contadores ya cargados más las dos
 * listas en edición. Las filas nuevas vienen sin `id`; las que ya existen en
 * la nube lo traen.
 */
export interface ParametrosEditados extends Omit<ParametrosSucursal, 'computadores' | 'permisos'> {
  computadores: FilaEditada<SucursalComputador>[]
  permisos: FilaEditada<SucursalPermiso>[]
}

export async function guardarParametrosSucursal(sucursalId: string, p: ParametrosEditados): Promise<void> {
  // 1) Los contadores: una sola fila de `sucursales`, cinco columnas.
  const contadores: Partial<Sucursal> = {}
  for (const columna of COLUMNAS_CONTADORES) {
    contadores[columna] = Math.max(0, Math.trunc(p[columna] ?? 0))
  }
  const sucursal = await supabase.from('sucursales').update(contadores).eq('id', sucursalId)
  if (sucursal.error) throw new Error(sucursal.error.message)

  // 2) Las dos listas. El diff se hace contra lo que hay AHORA en la nube, no
  // contra lo que la pantalla cargó al abrir: si alguien cambió un permiso
  // mientras se editaba, gana el estado fresco y no se pisa un dato ajeno.
  const [computadoresActuales, permisosActuales] = await Promise.all([
    supabase.from('sucursal_computadores').select('*').eq('sucursal_id', sucursalId),
    supabase.from('sucursal_permisos').select('*').eq('sucursal_id', sucursalId)
  ])
  if (computadoresActuales.error) throw new Error(computadoresActuales.error.message)
  if (permisosActuales.error) throw new Error(permisosActuales.error.message)

  // Las filas de pantalla pueden traer `sucursal_id` y `created_at` de cuando
  // se cargaron; se quitan para que ni el insert ni el update lleguen con
  // columnas que la pantalla no maneja.
  const planComputadores = planificarGuardado<SucursalComputador>(
    (computadoresActuales.data ?? []) as SucursalComputador[],
    p.computadores.map(sinColumnasDeTabla),
    ['nombre', 'tipo', 'cantidad']
  )
  const planPermisos = planificarGuardado<SucursalPermiso>(
    (permisosActuales.data ?? []) as SucursalPermiso[],
    p.permisos.map(sinColumnasDeTabla),
    ['nombre', 'numero', 'vigente', 'emision', 'vence', 'observacion']
  )

  await aplicarPlan('sucursal_computadores', sucursalId, planComputadores)
  await aplicarPlan('sucursal_permisos', sucursalId, planPermisos)
}

function sinColumnasDeTabla<T extends object>(fila: T): FilaEditada<T> {
  const resto = { ...fila } as Record<string, unknown>
  delete resto.sucursal_id
  delete resto.created_at
  return resto as FilaEditada<T>
}

async function aplicarPlan<T extends { id: string }>(
  tabla: 'sucursal_computadores' | 'sucursal_permisos',
  sucursalId: string,
  plan: { insertar: FilaEditada<T>[]; actualizar: { id: string; cambios: Partial<T> }[]; eliminar: string[] }
): Promise<void> {
  const errores: string[] = []
  if (plan.insertar.length) {
    const filas = plan.insertar.map((f) => ({ ...paraGuardar(f as Record<string, unknown>), sucursal_id: sucursalId }))
    const { error } = await supabase.from(tabla).insert(filas)
    if (error) errores.push(error.message)
  }
  for (const { id, cambios } of plan.actualizar) {
    const { error } = await supabase.from(tabla).update(paraGuardar(cambios as Record<string, unknown>)).eq('id', id)
    if (error) errores.push(error.message)
  }
  if (plan.eliminar.length) {
    const { error } = await supabase.from(tabla).delete().in('id', plan.eliminar)
    if (error) errores.push(error.message)
  }
  // Un solo error basta para que la pantalla sepa que no quedó completo; los
  // demás viajan pegados para poder decir cuál fue.
  if (errores.length) throw new Error(errores.join(' · '))
}

/** Días de aviso antes del vencimiento: a partir de acá el permiso sale marcado. */
export const DIAS_AVISO_VENCIMIENTO = 30

export type EstadoPermiso = 'SIN_FECHA' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDO'

/**
 * En qué estado está un permiso según su fecha de vencimiento.
 *
 * La comparación es sobre el texto `YYYY-MM-DD`, no sobre `Date`: una fecha sin
 * hora convertida a Date se desplaza por la zona horaria y «vence hoy» puede
 * salir vencido o no según la máquina. Con texto, el calendario manda.
 */
export function estadoPermiso(vence: string | null, hoy: string): EstadoPermiso {
  if (!vence) return 'SIN_FECHA'
  if (vence < hoy) return 'VENCIDO'
  if (vence <= sumarDias(hoy, DIAS_AVISO_VENCIMIENTO)) return 'POR_VENCER'
  return 'VIGENTE'
}

/** Hoy en la zona del usuario, en el mismo formato que guardan los inputs date. */
export function hoyLocal(): string {
  const ahora = new Date()
  const mes = String(ahora.getMonth() + 1).padStart(2, '0')
  const dia = String(ahora.getDate()).padStart(2, '0')
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const d = new Date(anio, (mes ?? 1) - 1, dia ?? 1)
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
