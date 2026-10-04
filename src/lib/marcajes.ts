import { supabase } from './supabase'

// ============================================================================
// Marcajes y proyectos (módulo "Proyectos" -> carpeta "Biométrico D100").
// El D100 (Anviz) se lee con una app puente local (/biometrico-bridge); estos
// helpers consultan al puente por HTTP y persisten los marcajes en Supabase.
// ============================================================================

export type TipoMarcaje = 'ENTRADA' | 'SALIDA' | 'OTRO'
export type TipoProyecto = 'BIOMETRICO' | 'GENERICO'

export interface Proyecto {
  id: string
  nombre: string
  descripcion: string
  tipo: TipoProyecto
  sucursal_id: string | null
  creado_por: string | null
  created_at: string
}

/** Marcaje tal como lo entrega el puente (o el CSV exportado). */
export interface MarcajeBridge {
  dni: string
  fecha: string // ISO
  tipo?: TipoMarcaje | string
}

export interface Marcaje {
  id: string
  proyecto_id: string
  trabajador_dni: string
  trabajador_nombre: string
  rol: string
  tipo: TipoMarcaje
  marcado_en: string
  creado_por: string | null
  created_at: string
}

export interface DispositivoInfo {
  conectado: boolean
  modelo: string | null
  serial: string | null
  mensaje: string | null
  /**
   * Por el transporte detectado (USB serie, red, CD-ROM virtual...) ¿se pueden
   * leer marcajes? Viene `false` en el caso habitual del D100 por USB: el equipo
   * está enchufado pero los marcajes salen del software de Anviz. La UI lo dice
   * en vez de prometer una sincronización que no va a traer datos.
   */
  sirve?: boolean
  transporte?: string | null
  transporteEtiqueta?: string | null
  /** El puente estaba en modo demo (marcajes de ejemplo). */
  demo?: boolean
}

export interface FiltrosMarcajes {
  desde?: string | null
  hasta?: string | null
  dni?: string | null
  tipo?: TipoMarcaje | 'TODOS' | null
}

export interface InfoTrabajador {
  nombre: string
  rol: string
}

export const PUENTE_DEFECTO = 'http://127.0.0.1:8787'
const CLAVE_URL_PUENTE = 'evaluxor:puente_url'

export function urlPuenteGuardada(): string {
  return localStorage.getItem(CLAVE_URL_PUENTE) ?? PUENTE_DEFECTO
}

export function guardarUrlPuente(url: string): void {
  localStorage.setItem(CLAVE_URL_PUENTE, url.trim() || PUENTE_DEFECTO)
}

export function normalizarDni(dni: unknown): string {
  return String(dni ?? '').trim().replace(/^0+(?=\d)/, '')
}

/**
 * Clasifica los marcajes que llegan sin tipo: por día y trabajador, los
 * impares son ENTRADA y los pares SALIDA (patrón típico de jornada).
 * Si el puente ya trae el tipo, se conserva.
 */
export function clasificarTipo(marcajes: MarcajeBridge[]): MarcajeBridge[] {
  const orden = [...marcajes].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  const conteo = new Map<string, number>()
  return orden.map((m) => {
    const dni = normalizarDni(m.dni)
    const clave = `${dni}|${String(m.fecha).slice(0, 10)}`
    const n = (conteo.get(clave) ?? 0) + 1
    conteo.set(clave, n)
    return {
      ...m,
      dni,
      tipo: (m.tipo as TipoMarcaje | undefined) ?? (n % 2 === 1 ? 'ENTRADA' : 'SALIDA')
    }
  })
}

// --- Comunicación con el puente local ---------------------------------------

async function leerJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function fetchPuente<T>(urlBase: string, ruta: string, timeoutMs = 6000): Promise<T> {
  const ctrl = new AbortController()
  const tiempo = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${urlBase.replace(/\/+$/, '')}${ruta}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`El puente respondió ${res.status}.`)
    return await leerJson<T>(res)
  } finally {
    clearTimeout(tiempo)
  }
}

export async function verificarDispositivo(urlBase = urlPuenteGuardada()): Promise<DispositivoInfo> {
  try {
    const info = await fetchPuente<{
      conectado?: boolean
      modelo?: string
      serial?: string
      mensaje?: string
      sirve?: boolean
      transporte?: string
      transporteEtiqueta?: string
    }>(urlBase, '/dispositivo')
    return {
      conectado: info.conectado === true,
      modelo: info.modelo ?? null,
      serial: info.serial ?? null,
      mensaje: info.mensaje ?? null,
      sirve: info.sirve !== false,
      transporte: info.transporte ?? null,
      transporteEtiqueta: info.transporteEtiqueta ?? null
    }
  } catch (e) {
    return {
      conectado: false,
      modelo: null,
      serial: null,
      mensaje: e instanceof Error ? e.message : 'No se pudo contactar al puente.'
    }
  }
}

export async function leerMarcajesPuente(
  desde: string,
  hasta: string,
  urlBase = urlPuenteGuardada()
): Promise<{ marcajes: MarcajeBridge[]; mensaje: string | null }> {
  try {
    const q = new URLSearchParams({ desde, hasta })
    const datos = await fetchPuente<{ marcajes?: unknown[] }>(urlBase, `/marcajes?${q.toString()}`)
    const brutos = (Array.isArray(datos.marcajes) ? datos.marcajes : []).filter(
      (m): m is MarcajeBridge =>
        m != null &&
        typeof (m as { dni?: unknown }).dni === 'string' &&
        typeof (m as { fecha?: unknown }).fecha === 'string' &&
        Boolean((m as { fecha?: string }).fecha)
    )
    return { marcajes: clasificarTipo(brutos), mensaje: null }
  } catch (e) {
    return { marcajes: [], mensaje: e instanceof Error ? e.message : 'No se pudo leer los marcajes del puente.' }
  }
}

// --- Persistencia en Supabase -------------------------------------------------

export async function guardarMarcajes(
  proyectoId: string,
  marcajes: MarcajeBridge[],
  usuarioId?: string | null
): Promise<{ insertados: number; mensaje: string | null }> {
  if (!marcajes.length) return { insertados: 0, mensaje: null }

  const filas: {
    proyecto_id: string
    trabajador_dni: string
    trabajador_nombre: string
    rol: string
    tipo: TipoMarcaje
    marcado_en: string
    creado_por: string | null
  }[] = []

  for (const m of marcajes) {
    const fecha = new Date(m.fecha)
    if (Number.isNaN(fecha.getTime())) continue
    const dni = normalizarDni(m.dni)
    if (!dni) continue
    filas.push({
      proyecto_id: proyectoId,
      trabajador_dni: dni,
      trabajador_nombre: dni,
      rol: '',
      tipo: (m.tipo as TipoMarcaje | undefined) === 'ENTRADA' || (m.tipo as TipoMarcaje | undefined) === 'SALIDA'
        ? (m.tipo as TipoMarcaje)
        : 'OTRO',
      marcado_en: fecha.toISOString(),
      creado_por: usuarioId ?? null
    })
  }

  if (!filas.length) return { insertados: 0, mensaje: null }

  // La clave única (proyecto, dni, marcado_en) evita duplicados entre sincronizaciones.
  const { data, error } = await supabase
    .from('marcajes')
    .upsert(filas, { onConflict: 'proyecto_id,trabajador_dni,marcado_en', ignoreDuplicates: true })
    .select('id')

  if (error) return { insertados: 0, mensaje: `Error al guardar los marcajes: ${error.message}` }
  return { insertados: data?.length ?? 0, mensaje: null }
}

export async function listaMarcajes(
  proyectoId: string,
  filtros: FiltrosMarcajes = {},
  limite = 200
): Promise<{ marcajes: Marcaje[]; mensaje: string | null }> {
  let q = supabase.from('marcajes').select('*').eq('proyecto_id', proyectoId)
  if (filtros.desde) {
    const desde = new Date(filtros.desde)
    desde.setHours(0, 0, 0, 0)
    q = q.gte('marcado_en', desde.toISOString())
  }
  if (filtros.hasta) {
    const hasta = new Date(filtros.hasta)
    hasta.setHours(23, 59, 59, 999)
    q = q.lte('marcado_en', hasta.toISOString())
  }
  if (filtros.dni) q = q.eq('trabajador_dni', normalizarDni(filtros.dni))
  if (filtros.tipo && filtros.tipo !== 'TODOS') q = q.eq('tipo', filtros.tipo)

  const { data, error } = await q.order('marcado_en', { ascending: false }).limit(limite)
  if (error) return { marcajes: [], mensaje: `No se pudieron cargar los marcajes: ${error.message}` }
  return { marcajes: (data ?? []) as Marcaje[], mensaje: null }
}

export async function listarProyectos(): Promise<{ proyectos: Proyecto[]; mensaje: string | null }> {
  const { data, error } = await supabase.from('proyectos').select('*').order('created_at')
  if (error) return { proyectos: [], mensaje: `No se pudieron cargar los proyectos: ${error.message}` }
  return { proyectos: (data ?? []) as Proyecto[], mensaje: null }
}

export async function crearProyecto(
  nombre: string,
  descripcion: string,
  sucursalId: string | null,
  usuarioId: string | null,
  tipo: TipoProyecto = 'GENERICO'
): Promise<{ proyecto: Proyecto | null; mensaje: string | null }> {
  const { data, error } = await supabase
    .from('proyectos')
    .insert({ nombre, descripcion, sucursal_id: sucursalId, creado_por: usuarioId, tipo })
    .select('*')
    .single()
  if (error) return { proyecto: null, mensaje: `No se pudo crear el proyecto: ${error.message}` }
  return { proyecto: data as Proyecto, mensaje: null }
}

/** Encuentra (o crea, si es LIDER) la carpeta del biométrico D100. */
export async function asegurarProyectoBiometrico(usuarioId: string | null): Promise<{ proyecto: Proyecto | null; mensaje: string | null }> {
  const { proyectos, mensaje } = await listarProyectos()
  if (mensaje) return { proyecto: null, mensaje }
  const existente = proyectos.find((p) => p.tipo === 'BIOMETRICO')
  if (existente) return { proyecto: existente, mensaje: null }
  return crearProyecto(
    'Biométrico D100 (Anviz)',
    'Fichajes (marcajes) del lector biométrico Anviz D100 conectado por USB mediante la app puente.',
    null,
    usuarioId,
    'BIOMETRICO'
  )
}

export async function definirSucursalProyecto(proyectoId: string, sucursalId: string | null): Promise<{ ok: boolean; mensaje: string | null }> {
  const { error } = await supabase.from('proyectos').update({ sucursal_id: sucursalId }).eq('id', proyectoId)
  if (error) return { ok: false, mensaje: `No se pudo guardar la sucursal: ${error.message}` }
  return { ok: true, mensaje: null }
}

/** Pone nombre/rol a los marcajes según el listado de colaboradores de la sucursal. */
export async function actualizarNombres(proyectoId: string, porDni: Map<string, InfoTrabajador>): Promise<void> {
  for (const [dni, info] of porDni) {
    await supabase
      .from('marcajes')
      .update({ trabajador_nombre: info.nombre, rol: info.rol })
      .eq('proyecto_id', proyectoId)
      .eq('trabajador_dni', dni)
  }
}

// --- Presentación -------------------------------------------------------------

export function coloresTipo(tipo: TipoMarcaje): number {
  if (tipo === 'ENTRADA') return 2 // verde
  if (tipo === 'SALIDA') return 4 // rojo
  return 0 // gris
}

export function etiquetaTipo(tipo: TipoMarcaje): string {
  if (tipo === 'ENTRADA') return 'Entrada'
  if (tipo === 'SALIDA') return 'Salida'
  return 'Sin clasificar'
}