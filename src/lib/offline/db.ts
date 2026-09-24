import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Modulo, Item, Sucursal, Asignacion, AsignacionModulo, SucursalModulo, SucursalItem, SucursalOpcion } from '../types'
import { claveRespuesta, type InstanciaPlana } from '../pasos'

export { claveRespuesta }

export interface DraftResp {
  valor: unknown
}

export interface DraftInstancia {
  id: string
  etiqueta: string
  orden: number
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

export interface SyncJob {
  id: string
  sucursal_id: string
  evaluador_id: string
  fecha: string
  instancias: { id: string; item_id: string; etiqueta: string; orden: number }[]
  respuestas: { item_id: string; instancia_id: string | null; valor: unknown }[]
  photoIds: string[]
  status: 'pending' | 'processing'
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
}

const DB_NAME = 'evaluxor-db'
const DB_VERSION = 4

let dbPromise: Promise<IDBPDatabase<EvaluxorDB>> | null = null

export function getDB(): Promise<IDBPDatabase<EvaluxorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<EvaluxorDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache')
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts')
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos')
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue')
        if (oldVersion > 0 && oldVersion < 4) {
          db.deleteObjectStore('cache')
          db.createObjectStore('cache')
          db.deleteObjectStore('queue')
          db.createObjectStore('queue')
        }
      }
    })
  }
  return dbPromise
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