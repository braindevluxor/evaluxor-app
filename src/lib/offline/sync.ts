import { supabase } from '../supabase'
import { getDraft, deleteDraft, getPhotos, deletePhoto, listQueue, putJob, deleteJob, type SyncJob, type DraftEval } from './db'
import { photoPath, convertirValor, extraerPhotoIds } from './transform'

export async function guardarBorradorEnCola(draft: DraftEval): Promise<void> {
  const offlineUuid = crypto.randomUUID()
  const respuestas = Object.entries(draft.respuestas).map(([item_id, r]) => ({ item_id, valor: r.valor }))
  const photoIds = Array.from(
    new Set(respuestas.flatMap((r) => extraerPhotoIds(r.valor)))
  )
  const job: SyncJob = {
    offline_uuid: offlineUuid,
    sucursal_id: draft.sucursal_id,
    evaluador_id: draft.evaluador_id,
    fecha: draft.fecha,
    comentario_general: draft.comentario_general,
    puntuacion: draft.puntuacion,
    respuestas,
    photoIds,
    status: 'pending',
    created_at: Date.now()
  }
  await putJob(job)
  await deleteDraft(draft.sucursal_id)
}

export async function procesarCola(): Promise<{ ok: number; fail: number }> {
  const jobs = await listQueue()
  let ok = 0
  let fail = 0
  for (const job of jobs) {
    if (job.status === 'processing') continue
    await putJob({ ...job, status: 'processing' })

    let evaluacionId: string | null = null
    try {
      const map = new Map<string, string>()
      for (const id of job.photoIds) {
        const rec = await getPhotos([id]).then((r) => r[0])
        if (!rec) continue
        const path = photoPath(job.offline_uuid, 'evidencia', id)
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, rec.blob, {
          contentType: rec.mime,
          upsert: true
        })
        if (upErr && !upErr.message.toLowerCase().includes('already exists')) throw upErr
        map.set(id, path)
      }

      const ins = {
        offline_uuid: job.offline_uuid,
        sucursal_id: job.sucursal_id,
        evaluador_id: job.evaluador_id,
        fecha: job.fecha,
        comentario_general: job.comentario_general || null,
        puntuacion: job.puntuacion
      }

      const { data: nueva, error: evErr } = await supabase
        .from('evaluaciones')
        .insert(ins)
        .select('id')
        .single()

      if (evErr) {
        if (evErr.code === '23505') {
          const { data: existente, error: exErr } = await supabase
            .from('evaluaciones')
            .select('id')
            .eq('offline_uuid', job.offline_uuid)
            .single()
          if (exErr) throw exErr
          evaluacionId = existente.id
        } else {
          throw evErr
        }
      } else {
        evaluacionId = nueva.id
      }

      const rows = job.respuestas.map((r) => ({
        evaluacion_id: evaluacionId as string,
        item_id: r.item_id,
        valor: convertirValor(r.valor, map)
      }))
      const { error: rErr } = await supabase
        .from('respuestas')
        .upsert(rows, { onConflict: 'evaluacion_id,item_id' })
      if (rErr) throw rErr

      for (const r of job.respuestas) {
        const ids = extraerPhotoIds(r.valor)
        for (const id of ids) {
          const path = map.get(id)
          if (!path) continue
          const { error: fErr } = await supabase
            .from('fotos')
            .insert({ evaluacion_id: evaluacionId, item_id: r.item_id, path })
          if (fErr && fErr.code !== '23505') throw fErr
        }
      }

      for (const id of job.photoIds) await deletePhoto(id)
      await deleteJob(job.offline_uuid)
      ok++
    } catch {
      await putJob({ ...job, status: 'pending' })
      fail++
    }
  }
  return { ok, fail }
}

export async function crearBorradorRaw(sucursalId: string, evaluadorId: string): Promise<DraftEval> {
  const existing = await getDraft(sucursalId)
  if (existing) return existing
  return {
    sucursal_id: sucursalId,
    evaluador_id: evaluadorId,
    fecha: new Date().toISOString().slice(0, 10),
    comentario_general: '',
    puntuacion: null,
    respuestas: {},
    updated_at: Date.now()
  }
}