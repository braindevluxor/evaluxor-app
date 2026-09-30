import { supabase } from '../supabase'
import { errorSubida } from '../subida'
import { deleteDraft, getPhotos, deletePhoto, listQueue, putJob, deleteJob, respuestasConInstancia, incidentesPendientes, eliminarIncidente, type SyncJob, type DraftEval } from './db'
import { photoPath, convertirValor, extraerPhotoIds, valorSinFotos } from './transform'

export { respuestasConInstancia }

export function instanciasDeDraft(draft: DraftEval): { id: string; item_id: string; etiqueta: string; orden: number; api_id?: string; datos?: Record<string, unknown> }[] {
  return Object.entries(draft.instancias ?? {}).flatMap(([item_id, arr]) =>
    arr.map((ins, i) => ({ id: ins.id, item_id, etiqueta: ins.etiqueta, orden: typeof ins.orden === 'number' ? ins.orden : i, api_id: ins.api_id, datos: ins.datos }))
  )
}

export async function encolarRespuestas(draft: DraftEval): Promise<void> {
  const respuestas = respuestasConInstancia(draft)
  const photoIds = Array.from(
    new Set(respuestas.flatMap((r) => extraerPhotoIds(r.valor)))
  )
  const job: SyncJob = {
    id: crypto.randomUUID(),
    sucursal_id: draft.sucursal_id,
    evaluador_id: draft.evaluador_id,
    fecha: draft.fecha,
    instancias: instanciasDeDraft(draft),
    respuestas,
    photoIds,
    status: 'pending',
    created_at: Date.now()
  }
  await putJob(job)
  await deleteDraft(draft.sucursal_id)
}

async function upsertRespuestas(rows: { evaluacion_id: string; item_id: string; instancia_id: string | null; valor: unknown; respondido_por: string }[]): Promise<void> {
  if (!rows.length) return
  // El upsert se hace vía la RPC `upsert_respuestas` (schema.sql): declara el
  // predicado exacto de cada índice parcial (directas y por registro), algo que
  // PostgREST no puede expresar con `on_conflict`. Aplica las políticas RLS de
  // respuestas igual que un upsert directo.
  const { error } = await supabase.rpc('upsert_respuestas', { rows })
  if (error) throw error
}

// Marca de la última subida a la nube del usuario actual (`profiles.ultima_sync`,
// ver supabase/schema.sql). Se llama solo cuando una subida terminó bien, así que
// sirve para saber si el avance de cada evaluador realmente llegó al servidor.
const INTERVALO_MARCA_SYNC = 2 * 60_000
let ultimaMarca = 0

/**
 * Registra que este usuario logró subir datos. No falla nunca ni interrumpe la
 * subida: como mucho la marca se pierde (si la RPC aún no está aplicada en
 * Supabase) y se reintenta en la próxima subida exitosa.
 */
export async function marcarSyncNube(): Promise<void> {
  const ahora = Date.now()
  if (ahora - ultimaMarca < INTERVALO_MARCA_SYNC) return
  ultimaMarca = ahora
  const { error } = await supabase.rpc('registrar_sync')
  if (error) ultimaMarca = 0 // no se pudo marcar: se reintenta en la próxima subida
}

export async function guardarBorradorNube(
  evaluacionId: string,
  evaluadorId: string,
  respuestas: { item_id: string; instancia_id: string | null; valor: unknown }[],
  instancias: { id: string; item_id: string; etiqueta: string; orden: number; api_id?: string; datos?: Record<string, unknown> }[] = []
): Promise<void> {
  if (!respuestas.length && !instancias.length) return
  try {
    if (instancias.length) {
      const rows = instancias.map((ins) => ({
        id: ins.id,
        evaluacion_id: evaluacionId,
        item_id: ins.item_id,
        etiqueta: ins.etiqueta,
        orden: ins.orden,
        api_id: ins.api_id ?? null,
        datos: ins.datos ?? null
      }))
      const { error } = await supabase.from('instancias_grupo').upsert(rows, { onConflict: 'id' })
      if (error) throw error
    }
    const rows = respuestas.map((r) => ({
      evaluacion_id: evaluacionId,
      item_id: r.item_id,
      instancia_id: r.instancia_id,
      valor: valorSinFotos(r.valor),
      respondido_por: evaluadorId
    }))
    await upsertRespuestas(rows)
  } catch (e) {
    // Se propaga tipado (causa + detalle técnico) para que la pantalla diga qué
    // pasó de verdad en vez de culpar siempre a la conexión.
    throw errorSubida(e, 'guardar el avance')
  }
  // La subida terminó bien: queda registrada como última sincronización del usuario.
  void marcarSyncNube()
}

export async function procesarCola(): Promise<{ ok: number; fail: number }> {
  const jobs = await listQueue()
  let ok = 0
  let fail = 0
  for (const job of jobs) {
    if (job.status === 'processing') continue
    await putJob({ ...job, status: 'processing' })

    try {
      // La evaluación ya existe (la apertura/abre el Líder). Se resuelve por
      // sucursal + fecha y debe estar ACTIVA para recibir respuestas.
      const { data: ev, error: evErr } = await supabase
        .from('evaluaciones')
        .select('id')
        .eq('sucursal_id', job.sucursal_id)
        .eq('fecha', job.fecha)
        .eq('estado', 'ACTIVA')
        .maybeSingle()
      if (evErr) throw evErr
      if (!ev) throw new Error('La evaluación no está activa. El Líder debe abrirla antes de sincronizar respuestas.')
      const evaluacionId = ev.id as string

      const map = new Map<string, string>()
      for (const id of job.photoIds) {
        const rec = await getPhotos([id]).then((r) => r[0])
        if (!rec) continue
        const path = photoPath(job.id, 'evidencia', id)
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, rec.blob, {
          contentType: rec.mime,
          upsert: true
        })
        if (upErr && !upErr.message.toLowerCase().includes('already exists')) throw upErr
        map.set(id, path)
      }

      // Registros (instancias) de secciones repetibles, antes que sus respuestas (FK).
      if (job.instancias?.length) {
        const instRows = job.instancias.map((ins) => ({
          id: ins.id,
          evaluacion_id: evaluacionId,
          item_id: ins.item_id,
          etiqueta: ins.etiqueta,
          orden: ins.orden,
          api_id: ins.api_id ?? null,
          datos: ins.datos ?? null
        }))
        const { error: iErr } = await supabase.from('instancias_grupo').upsert(instRows, { onConflict: 'id' })
        if (iErr) throw iErr
      }

      const rows = job.respuestas.map((r) => ({
        evaluacion_id: evaluacionId,
        item_id: r.item_id,
        instancia_id: r.instancia_id,
        valor: convertirValor(r.valor, map),
        respondido_por: job.evaluador_id
      }))
      await upsertRespuestas(rows)

      for (const r of job.respuestas) {
        const ids = extraerPhotoIds(r.valor)
        for (const id of ids) {
          const path = map.get(id)
          if (!path) continue
          const { error: fErr } = await supabase
            .from('fotos')
            .insert({ evaluacion_id: evaluacionId, item_id: r.item_id, instancia_id: r.instancia_id, path })
          if (fErr && fErr.code !== '23505') throw fErr
        }
      }

      for (const id of job.photoIds) await deletePhoto(id)
      await deleteJob(job.id)
      ok++
    } catch {
      await putJob({ ...job, status: 'pending' })
      fail++
    }
  }
  // La cola se vació al menos una vez: el dispositivo volvió a tener señal.
  if (ok) void marcarSyncNube()
  return { ok, fail }
}

/** Dónde vive la foto de una incidencia en el bucket `evidencias`. */
export function pathFotoIncidencia(incidenteId: string, photoId: string): string {
  return `incidencias/${incidenteId}/${photoId}`
}

/**
 * Sube las incidencias reportadas desde la evaluación que todavía están locales.
 * Igual que la cola de respuestas: resuelve la evaluación por sucursal + fecha
 * (debe estar ACTIVA), sube las fotos al bucket `evidencias` y guarda la fila en
 * `incidentes` (ver supabase/incidencias.sql). Si algo falla, la incidencia se
 * queda pendiente en el teléfono y se reintenta en la próxima sincronización.
 *
 * La fila se inserta ANTES de subir las fotos a propósito: la política de storage
 * comprueba que el reporte ya exista y sea del evaluador que lo está subiendo. Por
 * eso el id lo genera el cliente y se manda en el insert; después se actualiza la
 * fila con los paths de las fotos. Un 23505 en el insert significa que una subida
 * anterior dejó la fila a medias: se sigue adelante para terminar las fotos.
 */
export async function sincronizarIncidentes(): Promise<{ ok: number; fail: number }> {
  const pendientes = await incidentesPendientes()
  let ok = 0
  let fail = 0
  for (const inc of pendientes) {
    try {
      const { data: ev, error: evErr } = await supabase
        .from('evaluaciones')
        .select('id')
        .eq('sucursal_id', inc.sucursal_id)
        .eq('fecha', inc.fecha)
        .eq('estado', 'ACTIVA')
        .maybeSingle()
      if (evErr) throw evErr
      if (!ev) throw new Error('La evaluación no está activa. El Líder debe abrirla antes de sincronizar incidencias.')
      const evaluacionId = ev.id as string

      const { error: insErr } = await supabase.from('incidencias').insert({
        id: inc.id,
        evaluacion_id: evaluacionId,
        evaluador_id: inc.evaluador_id,
        sucursal_id: inc.sucursal_id,
        fecha: inc.fecha,
        modulo_id: inc.modulo_id,
        descripcion: inc.descripcion
      })
      if (insErr && insErr.code !== '23505') throw insErr

      const paths: string[] = []
      for (const id of inc.photoIds) {
        const rec = await getPhotos([id]).then((r) => r[0])
        if (!rec) continue
        const path = pathFotoIncidencia(inc.id, id)
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, rec.blob, {
          contentType: rec.mime,
          upsert: true
        })
        if (upErr && !upErr.message.toLowerCase().includes('already exists')) throw upErr
        paths.push(path)
      }

      if (paths.length) {
        const { error: upRowErr } = await supabase.from('incidencias').update({ fotos: paths }).eq('id', inc.id)
        if (upRowErr) throw upRowErr
      }

      for (const id of inc.photoIds) await deletePhoto(id)
      await eliminarIncidente(inc.id)
      ok++
    } catch {
      fail++
    }
  }
  if (ok) void marcarSyncNube()
  return { ok, fail }
}