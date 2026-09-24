import { supabase } from '../supabase'
import { deleteDraft, getPhotos, deletePhoto, listQueue, putJob, deleteJob, parsearClaveRespuesta, type SyncJob, type DraftEval } from './db'
import { photoPath, convertirValor, extraerPhotoIds, valorSinFotos } from './transform'

export function instanciasDeDraft(draft: DraftEval): { id: string; item_id: string; etiqueta: string; orden: number }[] {
  return Object.entries(draft.instancias ?? {}).flatMap(([item_id, arr]) =>
    arr.map((ins, i) => ({ id: ins.id, item_id, etiqueta: ins.etiqueta, orden: typeof ins.orden === 'number' ? ins.orden : i }))
  )
}

export function respuestasConInstancia(draft: DraftEval): { item_id: string; instancia_id: string | null; valor: unknown }[] {
  return Object.entries(draft.respuestas).map(([k, r]) => ({ ...parsearClaveRespuesta(k), valor: r.valor }))
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

export async function guardarBorradorNube(
  evaluacionId: string,
  evaluadorId: string,
  respuestas: { item_id: string; instancia_id: string | null; valor: unknown }[],
  instancias: { id: string; item_id: string; etiqueta: string; orden: number }[] = []
): Promise<void> {
  if (!respuestas.length && !instancias.length) return
  if (instancias.length) {
    const rows = instancias.map((ins) => ({
      id: ins.id,
      evaluacion_id: evaluacionId,
      item_id: ins.item_id,
      etiqueta: ins.etiqueta,
      orden: ins.orden
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
          orden: ins.orden
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
  return { ok, fail }
}