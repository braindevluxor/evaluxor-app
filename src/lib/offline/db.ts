import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Modulo, Item, Sucursal, Asignacion, AsignacionModulo, SucursalModulo, SucursalItem, SucursalOpcion } from '../types'
import { claveRespuesta, type InstanciaPlana } from '../pasos'
import { normalizarResponsables, type ResponsableIncidencia } from '../data/responsablesIncidencia'

export { claveRespuesta }

export interface DraftResp {
  valor: unknown
  /** En colaboración en vivo: 'yo' = escrita por este evaluador (se sincroniza); 'otros' = fusionada de otro evaluador solo para visualizarla (nunca se re-envía). */
  por?: 'yo' | 'otros'
}

export interface DraftInstancia {
  id: string
  etiqueta: string
  orden: number
  /** API que trajo los datos del registro (si la sección la tiene configurada). */
  api_id?: string
  /** Valores guardados desde la API (según items.api_campos de la sección). Informativos. */
  datos?: Record<string, unknown>
}

export interface DraftEval {
  sucursal_id: string
  evaluador_id: string
  fecha: string
  comentario_general: string
  puntuacion: number | null
  /** Respuestas por clave `item_id::instancia_id` (instancia vacía para ítems directos). */
  respuestas: Record<string, DraftResp>
  /** Registros creados por ítem CONTENEDOR (sección): item_id → instancias. */
  instancias: Record<string, DraftInstancia[]>
  updated_at: number
}

/** Separa una clave de respuesta en ítem e instancia. */
export function parsearClaveRespuesta(k: string): { item_id: string; instancia_id: string | null } {
  const sep = k.indexOf('::')
  if (sep === -1) return { item_id: k, instancia_id: null }
  return { item_id: k.slice(0, sep), instancia_id: k.slice(sep + 2) || null }
}

/** Normaliza claves de borradores antiguos (solo `item_id`) al formato actual (`item_id::`). */
export function normalizarClave(k: string): string {
  return k.includes('::') ? k : claveRespuesta(k)
}

/**
 * Respuestas del borrador listas para sincronizar. Excluye las fusionadas de
 * otros evaluadores (`por: 'otros'`): son solo para visualizarlas en la
 * colaboración en vivo y re-enviarlas pisaría la autoría/evidencias del otro.
 */
export function respuestasConInstancia(draft: DraftEval): { item_id: string; instancia_id: string | null; valor: unknown }[] {
  return Object.entries(draft.respuestas)
    .filter(([, r]) => r.por !== 'otros')
    .map(([k, r]) => ({ ...parsearClaveRespuesta(k), valor: r.valor }))
}

/** Registros aplanados del borrador (item_id → orden) para calcular pasos. */
export function instanciasPlanasDe(d: Pick<DraftEval, 'instancias'> | null): InstanciaPlana[] {
  const ins = d?.instancias ?? {}
  return Object.entries(ins).flatMap(([item_id, arr]) =>
    (arr ?? []).map((x, i) => ({ id: x.id, item_id, orden: typeof x.orden === 'number' ? x.orden : i }))
  )
}

export interface PhotoRecord {
  id: string
  mime: string
  blob: Blob
  created_at: number
}

/**
 * Incidencia reportada durante la evaluación: algo que no está en el formulario
 * (p. ej. una bandeja de pechuga en la heladera de helados). Vive local hasta
 * que la subida llega al servidor (`sync: 'pendiente'`).
 */
export interface IncidenteRecord {
  id: string
  evaluador_id: string
  sucursal_id: string
  fecha: string
  modulo_id: string | null
  descripcion: string
  photoIds: string[]
  /**
   * Cargos responsables. Es opcional a propósito: las incidencias que ya estaban
   * en el dispositivo antes de este cambio no lo tienen, y `listIncidentes` lo
   * completa con `normalizarResponsables` en vez de romper.
   */
  responsables?: ResponsableIncidencia[]
  created_at: number
  sync: 'pendiente' | 'enviado'
}

export interface SyncJob {
  id: string
  sucursal_id: string
  evaluador_id: string
  fecha: string
  instancias: { id: string; item_id: string; etiqueta: string; orden: number; api_id?: string; datos?: Record<string, unknown> }[]
  respuestas: { item_id: string; instancia_id: string | null; valor: unknown }[]
  photoIds: string[]
  status: 'pending' | 'processing'
  /** Momento en que empezó el intento actual; permite recuperar trabajos tras cerrar la app. */
  processing_at?: number
  created_at: number
}

export interface CacheData {
  modulos: Modulo[]
  items: Item[]
  sucursales: Sucursal[]
  asignaciones: Asignacion[]
  asignacionesModulos: AsignacionModulo[]
  sucursalModulos: SucursalModulo[]
  sucursalItems: SucursalItem[]
  sucursalOpciones: SucursalOpcion[]
  updated_at: number
}

interface EvaluxorDB extends DBSchema {
  cache: { key: string; value: CacheData }
  drafts: { key: string; value: DraftEval }
  photos: { key: string; value: PhotoRecord }
  queue: { key: string; value: SyncJob }
  incidentes: { key: string; value: IncidenteRecord }
}

const DB_NAME = 'evaluxor-db'
const DB_VERSION = 6
/** Stores que la app necesita para funcionar. */
const STORES = ['cache', 'drafts', 'photos', 'queue', 'incidentes'] as const

let dbPromise: Promise<IDBPDatabase<EvaluxorDB>> | null = null

/**
 * Abre la base. Si el navegador ya tiene una versión MÁS nueva que la del
 * código (otra pestaña con un build distinto o un rollback), IndexedDB lanza
 * `VersionError` y toda la app se quedaba sin catálogo ni cola. En ese caso se
 * abre la versión que ya existe y, si le faltara algún store, se sube un punto
 * para crearlo — sin tocar los datos existentes.
 */
async function abrirDB(version: number): Promise<IDBPDatabase<EvaluxorDB>> {
  try {
    return await openDB<EvaluxorDB>(DB_NAME, version, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache')
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts')
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos')
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue')
        if (!db.objectStoreNames.contains('incidentes')) db.createObjectStore('incidentes')
        if (oldVersion > 0 && oldVersion < 4) {
          // Solo se renueva el catálogo cacheado, que es lo único que puede quedar
          // incompatible con el código nuevo. La cola y los borradores son trabajo
          // real del evaluador: antes esto los borraba y se perdía lo que no había
          // llegado a la nube.
          db.deleteObjectStore('cache')
          db.createObjectStore('cache')
        }
      }
    })
  } catch (err) {
    if ((err as DOMException | undefined)?.name !== 'VersionError') throw err
    // La base local es más nueva que el código: ábrela tal cual…
    const db = await openDB<EvaluxorDB>(DB_NAME)
    const faltan = STORES.filter((s) => !db.objectStoreNames.contains(s))
    if (!faltan.length) return db
    // …y si le falta algún store, sube la versión para crearlo.
    const siguiente = Math.max(db.version, version) + 1
    db.close()
    return abrirDB(siguiente)
  }
}

export function getDB(): Promise<IDBPDatabase<EvaluxorDB>> {
  if (!dbPromise) {
    const p = abrirDB(DB_VERSION)
    // Si falla, no dejamos la promesa rechazada cacheada para siempre.
    p.catch(() => {
      if (dbPromise === p) dbPromise = null
    })
    dbPromise = p
  }
  return dbPromise
}

/** Cierra la conexión para poder borrar la base (usado por "Restaurar app"). */
export async function cerrarDB(): Promise<void> {
  const p = dbPromise
  dbPromise = null
  if (!p) return
  try {
    ;(await p).close()
  } catch {
    // Si nunca llegó a abrir, no hay nada que cerrar.
  }
}

/** Tira el catálogo cacheado para que se vuelva a bajar del servidor. */
export async function limpiarCacheCatalogo(): Promise<void> {
  const db = await getDB()
  await db.delete('cache', 'data')
}

/** Qué hay guardado en el dispositivo, para poder avisar antes de borrar. */
export async function resumenAlmacenamiento(): Promise<{ borradores: number; cola: number; fotos: number; incidentes: number }> {
  try {
    const db = await getDB()
    const [borradores, cola, fotos, incidentes] = await Promise.all([db.count('drafts'), db.count('queue'), db.count('photos'), db.count('incidentes')])
    return { borradores, cola, fotos, incidentes }
  } catch {
    return { borradores: 0, cola: 0, fotos: 0, incidentes: 0 }
  }
}

export async function getCache(): Promise<CacheData | undefined> {
  const db = await getDB()
  return db.get('cache', 'data')
}

export async function putCache(data: CacheData): Promise<void> {
  const db = await getDB()
  await db.put('cache', { ...data, updated_at: Date.now() }, 'data')
}

export async function getDraft(sucursalId: string): Promise<DraftEval | undefined> {
  const db = await getDB()
  return db.get('drafts', sucursalId)
}

export async function putDraft(draft: DraftEval): Promise<void> {
  const db = await getDB()
  await db.put('drafts', { ...draft, updated_at: Date.now() }, draft.sucursal_id)
}

export async function deleteDraft(sucursalId: string): Promise<void> {
  const db = await getDB()
  await db.delete('drafts', sucursalId)
}

export async function addPhoto(blob: Blob, mime: string): Promise<string> {
  const db = await getDB()
  const id = crypto.randomUUID()
  const record: PhotoRecord = { id, mime, blob, created_at: Date.now() }
  await db.put('photos', record, id)
  return id
}

export async function getPhotos(ids: string[]): Promise<PhotoRecord[]> {
  if (!ids.length) return []
  const db = await getDB()
  const out: PhotoRecord[] = []
  for (const id of ids) {
    const rec = await db.get('photos', id)
    if (rec) out.push(rec)
  }
  return out
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('photos', id)
}

export async function listQueue(): Promise<SyncJob[]> {
  const db = await getDB()
  const all = await db.getAll('queue')
  return all.sort((a, b) => a.created_at - b.created_at)
}

export async function putJob(job: SyncJob): Promise<void> {
  const db = await getDB()
  await db.put('queue', job, job.id)
}

export async function deleteJob(uuid: string): Promise<void> {
  const db = await getDB()
  await db.delete('queue', uuid)
}

export async function addIncidente(r: Omit<IncidenteRecord, 'id' | 'created_at' | 'sync'>): Promise<IncidenteRecord> {
  const db = await getDB()
  const record: IncidenteRecord = { ...r, id: crypto.randomUUID(), created_at: Date.now(), sync: 'pendiente' }
  await db.put('incidentes', record, record.id)
  return record
}

export async function updateIncidente(id: string, cambios: Partial<Pick<IncidenteRecord, 'descripcion' | 'photoIds' | 'modulo_id' | 'responsables' | 'sync'>>): Promise<void> {
  const db = await getDB()
  const actual = await db.get('incidentes', id)
  if (!actual) return
  await db.put('incidentes', { ...actual, ...cambios, sync: cambios.sync ?? 'pendiente' }, id)
}

export async function listIncidentes(): Promise<IncidenteRecord[]> {
  const db = await getDB()
  const all = await db.getAll('incidentes')
  return all
    .map((incidente) => ({ ...incidente, responsables: normalizarResponsables(incidente.responsables) }))
    .sort((a, b) => a.created_at - b.created_at)
}

export async function listIncidentesEvaluacion(sucursalId: string, fecha: string, evaluadorId: string): Promise<IncidenteRecord[]> {
  return (await listIncidentes()).filter(
    (incidente) => incidente.sucursal_id === sucursalId && incidente.fecha === fecha && incidente.evaluador_id === evaluadorId
  )
}

/** Las que todavía no llegaron al servidor (para la subida y los avisos). */
export async function incidentesPendientes(): Promise<IncidenteRecord[]> {
  const all = await listIncidentes()
  return all.filter((i) => i.sync === 'pendiente')
}

/** La incidencia se subió bien: sale de la base local (y sus fotos con ella). */
export async function eliminarIncidente(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('incidentes', id)
}