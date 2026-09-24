import { supabase } from '../supabase'
import { deleteDraft, getPhotos, deletePhoto, listQueue, putJob, deleteJob, type SyncJob, type DraftEval } from './db'
import { photoPath, convertirValor, extraerPhotoIds, valorSinFotos } from './transform'

export async function encolarRespuestas(draft: DraftEval): Promise<void> {
  const respuestas = Object.entries(draft.respuestas).map(([item_id, r]) => ({ item_id, valor: r.valor }))
  const photoIds = Array.from(
    new Set(respuestas.flatMap((r) => extraerPhotoIds(r.valor)))
  )
  const job: SyncJob = {
    id: crypto.randomUUID(),
    sucursal_id: draft.sucursal_id,
    evaluador_id: draft.evaluador_id,
    fecha: draft.fecha,
    respuestas,
    photoIds,
    status: 'pending',
    created_at: Date.now()
  }
  await putJob(job)
  await deleteDraft(draft.sucursal_id)
}

export async function guardarBorradorNube(
  evaluacionId: string,
  evaluadorId: string,
  respuestas: { item_id: string; valor: unknown }[]
): Promise<void> {
  if (!respuestas.length) return
  const rows = respuestas.map((r) => ({
    evaluacion_id: evaluacionId,
    item_id: r.item_id,
    valor: valorSinFotos(r.valor),
    respondido_por: evaluadorId
  }))
  const { error } = await supabase
    .from('respuestas')
    .upsert(rows, { onConflict: 'evaluacion_id,item_id' })
  if (error) throw error
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

      const rows = job.respuestas.map((r) => ({
        evaluacion_id: evaluacionId,
        item_id: r.item_id,
        valor: convertirValor(r.valor, map),
        respondido_por: job.evaluador_id
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
      await deleteJob(job.id)
      ok++
    } catch {
      await putJob({ ...job, status: 'pending' })
      fail++
    }
  }
  return { ok, fail }
}