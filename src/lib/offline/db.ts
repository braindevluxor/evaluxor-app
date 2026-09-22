import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Modulo, Item, Sucursal, Asignacion, AsignacionModulo, SucursalModulo, SucursalItem } from '../types'

export interface DraftResp {
  valor: unknown
}

export interface DraftEval {
  sucursal_id: string
  evaluador_id: string
  fecha: string
  comentario_general: string
  puntuacion: number | null
  respuestas: Record<string, DraftResp>
  updated_at: number
}

export interface PhotoRecord {
  id: string
  mime: string
  blob: Blob
  created_at: number
}

export interface SyncJob {
  offline_uuid: string
  sucursal_id: string
  evaluador_id: string
  fecha: string
  comentario_general: string
  puntuacion: number | null
  respuestas: { item_id: string; valor: unknown }[]
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
  updated_at: number
}

interface EvaluxorDB extends DBSchema {
  cache: { key: string; value: CacheData }
  drafts: { key: string; value: DraftEval }
  photos: { key: string; value: PhotoRecord }
  queue: { key: string; value: SyncJob }
}

const DB_NAME = 'evaluxor-db'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<EvaluxorDB>> | null = null

export function getDB(): Promise<IDBPDatabase<EvaluxorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<EvaluxorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache')
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts')
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos')
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue')
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
  await db.put('queue', job, job.offline_uuid)
}

export async function deleteJob(uuid: string): Promise<void> {
  const db = await getDB()
  await db.delete('queue', uuid)
}