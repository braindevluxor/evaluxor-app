import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Modulo, Item, Sucursal, Departamento, DepartamentoModulo, DepartamentoItem, DepartamentoOpcion, Asignacion, AsignacionModulo, SucursalModulo, SucursalItem, SucursalOpcion } from '../types'
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
  /**
   * Clave del borrador: id de la UNIDAD a la que pertenece, que puede ser una
   * sucursal o un departamento centralizado. Es también la clave del store
   * `drafts`, así que nunca conviven dos borradores de la misma unidad.
   */
  unidad_id: string
  /** Seteado cuando el borrador es de un departamento (su id va en `unidad_id`). */
  departamento_id?: string | null
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
  /** Unidad de la evaluación: sucursal o departamento (heredada de la evaluación). */
  unidad_id: string
  /** Seteado cuando la incidencia es de una evaluación de departamento. */
  departamento_id?: string | null
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

export interface PreEntregaRecord {
  id: string
  evaluador_id: string
  sucursal_id: string
  modulo_id: string | null
  placa: string
  vehiculo: Record<string, unknown>
  chofer: Record<string, unknown>
  chofer_firma: string | null
  observaciones: string
  /** Respuestas del check list: `{ [item_id]: <valor de ItemRenderer> }`. */
  respuestas: Record<string, unknown>
  estado: 'BORRADOR' | 'FINALIZADA'
  /** Fecha calendario (YYYY-MM-DD) de la entrega. */
  fecha: string
  /** Fotos de las respuestas que aún no llegaron al bucket. */
  photoIds: string[]
  created_at: number
  updated_at: number
  sync: 'pendiente' | 'enviado'
}

export interface SyncJob {
  id: string
  /** Unidad de la evaluación: sucursal o departamento. */
  unidad_id: string
  /** Seteado cuando la evaluación es de departamento (su id va en `unidad_id`). */
  departamento_id?: string | null
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
  /**
   * Departamentos centralizados y su configuración. Van en el mismo cache que
   * la de sucursales porque aplican la misma regla (sin filas activas aplica
   * todo). Son opcionales: los caches escritos por versiones anteriores no los
   * traen, y `normalizarCache` los completa con listas vacías.
   */
  departamentos?: Departamento[]
  departamentoModulos?: DepartamentoModulo[]
  departamentoItems?: DepartamentoItem[]
  departamentoOpciones?: DepartamentoOpcion[]
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
  /** Revisión Pre-Entrega armada en el dispositivo (borrador o pendiente de subir). */
  preentrega: { key: string; value: PreEntregaRecord }
}

const DB_NAME = 'evaluxor-db'
// 7: el store `preentrega` puede faltar en dispositivos que ya abrieron la base
// como v6 con un build sin la herramienta; subir un punto lo crea sin tocar datos.
const DB_VERSION = 7
/** Stores que la app necesita para funcionar. */
const STORES = ['cache', 'drafts', 'photos', 'queue', 'incidentes', 'preentrega'] as const

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
        if (!db.objectStoreNames.contains('preentrega')) db.createObjectStore('preentrega')
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
export async function resumenAlmacenamiento(): Promise<{
  borradores: number
  cola: number
  fotos: number
  incidentes: number
  preentregas: number
}> {
  try {
    const db = await getDB()
    const [borradores, cola, fotos, incidentes, preentregas] = await Promise.all([
      db.count('drafts'),
      db.count('queue'),
      db.count('photos'),
      db.count('incidentes'),
      db.count('preentrega')
    ])
    return { borradores, cola, fotos, incidentes, preentregas }
  } catch {
    return { borradores: 0, cola: 0, fotos: 0, incidentes: 0, preentregas: 0 }
  }
}

export async function getCache(): Promise<CacheData | undefined> {
  const db = await getDB()
  const bruto: unknown = await db.get('cache', 'data')
  if (!bruto) return undefined
  // El disco no miente pero sí envejece: lo que hay guardado lo escribió la
  // versión de la app que corrió la última vez, que puede no ser esta.
  return normalizarCache(bruto)
}

function oLista<T>(valor: T[] | undefined | null): T[] {
  return Array.isArray(valor) ? valor : []
}

/**
 * Caché leída → `CacheData` completo, sin importar lo que traiga el registro.
 *
 * POR QUÉ EXISTE
 * --------------
 * Un registro escrito por una versión vieja de la app (o dañado) puede venir sin
 * campos. `CatalogContext` hace `setSucursales(local.sucursales)` y el estado
 * quedaba `undefined` — algo que el tipo dice que no puede pasar—, y la primera
 * pantalla que leyera `.length` sobre esa lista se caía con
 * "Cannot read properties of undefined (reading 'length')". Pasó en la lista de
 * sucursales (`EvaluarHome`), donde el array entra en las dependencias de un
 * efecto y se evalúa en cada render.
 *
 * Con esto, cualquier consumidor puede confiar en el contrato `CacheData`.
 */
export function normalizarCache(bruto: unknown): CacheData {
  const c = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Partial<CacheData>
  return {
    modulos: oLista(c.modulos),
    items: oLista(c.items),
    sucursales: oLista(c.sucursales),
    departamentos: oLista(c.departamentos),
    departamentoModulos: oLista(c.departamentoModulos),
    departamentoItems: oLista(c.departamentoItems),
    departamentoOpciones: oLista(c.departamentoOpciones),
    asignaciones: oLista(c.asignaciones),
    asignacionesModulos: oLista(c.asignacionesModulos),
    sucursalModulos: oLista(c.sucursalModulos),
    sucursalItems: oLista(c.sucursalItems),
    sucursalOpciones: oLista(c.sucursalOpciones),
    updated_at: typeof c.updated_at === 'number' ? c.updated_at : 0
  }
}

export async function putCache(data: CacheData): Promise<void> {
  const db = await getDB()
  await db.put('cache', { ...data, updated_at: Date.now() }, 'data')
}

export async function getDraft(unidadId: string): Promise<DraftEval | undefined> {
  const db = await getDB()
  return db.get('drafts', unidadId)
}

export async function putDraft(draft: DraftEval): Promise<void> {
  const db = await getDB()
  await db.put('drafts', { ...draft, updated_at: Date.now() }, draft.unidad_id)
}

export async function deleteDraft(unidadId: string): Promise<void> {
  const db = await getDB()
  await db.delete('drafts', unidadId)
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

export async function listIncidentesEvaluacion(unidadId: string, fecha: string, evaluadorId: string): Promise<IncidenteRecord[]> {
  return (await listIncidentes()).filter(
    (incidente) => incidente.unidad_id === unidadId && incidente.fecha === fecha && incidente.evaluador_id === evaluadorId
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

/* --- Revisión Pre-Entrega ---------------------------------------------------- */

/** Guarda (o reemplaza) la revisión que se está armando en el dispositivo. */
export async function putPreEntrega(registro: PreEntregaRecord): Promise<void> {
  const db = await getDB()
  await db.put('preentrega', { ...registro, updated_at: Date.now() }, registro.id)
}

/**
 * Solo se retoma una `BORRADOR`; una `FINALIZADA` que quedó sin confirmar es
 * cosa de la cola de subida, no del formulario.
 */
export async function getPreEntregaAbierta(evaluadorId: string): Promise<PreEntregaRecord | undefined> {
  const todas = await listPreEntregas()
  const abiertas = todas.filter((r) => r.evaluador_id === evaluadorId && r.estado === 'BORRADOR')
  return abiertas[abiertas.length - 1]
}

async function listPreEntregas(): Promise<PreEntregaRecord[]> {
  const db = await getDB()
  const all = await db.getAll('preentrega')
  return all.sort((a, b) => a.created_at - b.created_at)
}

/** Las que todavía no llegaron al servidor (para la subida y los avisos). */
export async function preEntregasPendientes(): Promise<PreEntregaRecord[]> {
  return (await listPreEntregas()).filter((r) => r.sync === 'pendiente')
}

/** El borrador subió bien: queda en el dispositivo como `enviado` (se sigue editando). */
export async function marcarPreEntregaEnviada(id: string): Promise<void> {
  const db = await getDB()
  const actual = await db.get('preentrega', id)
  if (!actual) return
  await db.put('preentrega', { ...actual, sync: 'enviado', updated_at: Date.now() }, id)
}

/** La revisión finalizada llegó al servidor: sale de local con sus fotos. */
export async function eliminarPreEntrega(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('preentrega', id)
}