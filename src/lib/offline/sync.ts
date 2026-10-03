import { supabase } from '../supabase'
import { causaSubida, detalleTecnico, errorSubida, type ErrorSubida } from '../subida'
import { deleteDraft, getPhotos, deletePhoto, listQueue, putJob, deleteJob, respuestasConInstancia, incidentesPendientes, eliminarIncidente, type SyncJob, type DraftEval } from './db'
import { photoPath, convertirValor, extraerPhotoIds, idsFotosRespuesta, valorSinFotos } from './transform'
import { normalizarResponsables, responsablesAColumna } from '../data/responsablesIncidencia'

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

type FilaInstancia = {
  id: string
  evaluacion_id: string
  item_id: string
  etiqueta: string
  orden: number
  api_id: string | null
  datos: unknown
}

type FilaRespuesta = {
  evaluacion_id: string
  item_id: string
  instancia_id: string | null
  valor: unknown
  respondido_por: string
}

/** Por qué un ítem del lote no se pudo subir. */
export type MotivoDescarte = 'item_borrado' | 'sin_permiso'

/** Ítems del lote que no se pudieron subir, y por qué. */
export interface Descarte {
  item_ids: string[]
  motivos: MotivoDescarte[]
}

/** Agrupa filas por ítem, conservando el orden en que llegaron. */
function agruparPorItem<T extends { item_id: string }>(filas: T[]): [string, T[]][] {
  const grupos = new Map<string, T[]>()
  for (const f of filas) {
    const g = grupos.get(f.item_id)
    if (g) g.push(f)
    else grupos.set(f.item_id, [f])
  }
  return [...grupos]
}

function unirDescartes(a: Descarte, b: Descarte): Descarte {
  return {
    item_ids: [...new Set([...a.item_ids, ...b.item_ids])],
    motivos: [...new Set([...a.motivos, ...b.motivos])]
  }
}

/**
 * De los `ids` dados, cuáles siguen existiendo en `items`. Devuelve `null` si la
 * consulta falló: sin eso no se puede atribuir el descarte y conviene propagar el
 * error original antes que descartar respuestas de más.
 *
 * Es confiable porque `items_select` es `using (true)`: el catálogo entero es
 * legible, así que un id que no aparece de verdad fue borrado.
 */
async function itemsQueSobreviven(ids: string[]): Promise<Set<string> | null> {
  if (!ids.length) return new Set()
  const { data, error } = await supabase.from('items').select('id').in('id', ids)
  if (error) return null
  return new Set((data ?? []).map((r) => r.id as string))
}

/**
 * Un upsert que se manda entero y, si RLS lo rechaza, se reintenta ítem por ítem.
 *
 * El caso real (42501 en `instancias_grupo`): al evaluador le quedó un registro de
 * una sección que después quedó desactivada, o de un módulo que le dieron de
 * baja. `puede_manejar_instancia` devuelve false para ese ítem, el upsert del
 * lote entero se rechaza, y el resto del avance se queda trabado en el teléfono
 * para siempre. El servidor no dice qué fila fue, así que en el camino de error
 * se aísla y se descarta solo lo que no pasa.
 *
 * El camino rápido es el de siempre (una sola llamada): esto solo corre cuando el
 * lote entero fue rechazado. Y si tampoco pasa ningún grupo, el problema no es de
 * un ítem (evaluación cerrada, módulo dado de baja para todo) y se propaga el
 * error del lote, que es más informativo.
 */
async function upsertAislado<T extends { item_id: string }>(
  filas: T[],
  enviar: (grupo: T[]) => PromiseLike<{ error: unknown }>
): Promise<Descarte> {
  if (!filas.length) return { item_ids: [], motivos: [] }

  const todo = await enviar(filas)
  if (!todo.error) return { item_ids: [], motivos: [] }
  if (causaSubida(todo.error) !== 'rechazada') throw todo.error

  const grupos = agruparPorItem(filas)
  const sinPermiso: string[] = []
  for (const [item_id, grupo] of grupos) {
    const r = await enviar(grupo)
    if (!r.error) continue
    if (causaSubida(r.error) !== 'rechazada') throw r.error
    sinPermiso.push(item_id)
  }
  if (sinPermiso.length === grupos.length) throw todo.error
  return { item_ids: sinPermiso, motivos: ['sin_permiso'] }
}

/** Registros de secciones repetibles. Las políticas los governing `puede_manejar_instancia`. */
async function subirInstancias(inst: FilaInstancia[]): Promise<Descarte> {
  return upsertAislado(inst, (grupo) => supabase.from('instancias_grupo').upsert(grupo, { onConflict: 'id' }))
}

/**
 * Respuestas. El upsert va por la RPC `upsert_respuestas` (schema.sql): declara
 * el predicado exacto de cada índice parcial (directas y por registro), algo que
 * PostgREST no puede expresar con `on_conflict`. Aplica las políticas RLS de
 * respuestas igual que un upsert directo.
 *
 * Agrupar por ítem no rompe los índices: las dos claves únicas llevan `item_id`.
 */
async function subirRespuestas(resp: FilaRespuesta[]): Promise<Descarte> {
  return upsertAislado(resp, (grupo) => supabase.rpc('upsert_respuestas', { rows: grupo }))
}

/**
 * Sube registros (instancias) y respuestas, y se recupera de dos rechazos.
 *
 * 23503 (ítem borrado): alguien editó la plantilla y borró un ítem que el
 * evaluador ya había respondido. La fila apunta a un id que ya no está en
 * `items`. Se le pregunta al catálogo cuáles de los nuestros siguen existiendo y
 * se sube solo esa parte. Si el filtro no saca nada, la FK que falló era otra y
 * se propaga el error original en vez de insistir en loop.
 *
 * 42501 (sin permiso): lo resuelve `upsertAislado`, sin sacar nada del lote.
 */
async function subirLote(inst: FilaInstancia[], resp: FilaRespuesta[]): Promise<Descarte> {
  let instLote = inst
  let respLote = resp

  const intentar = async (): Promise<Descarte> => {
    // Las instancias van antes que sus respuestas (FK).
    return unirDescartes(await subirInstancias(instLote), await subirRespuestas(respLote))
  }

  try {
    return await intentar()
  } catch (e) {
    if (causaSubida(e) !== 'item_borrado') throw e

    const ids = [...new Set([...inst, ...resp].map((f) => f.item_id))]
    const existen = await itemsQueSobreviven(ids)
    if (!existen) throw e

    const descartados = ids.filter((id) => !existen.has(id))
    const instVivas = inst.filter((f) => existen.has(f.item_id))
    const respVivas = resp.filter((f) => existen.has(f.item_id))
    // Nada cambió: la FK que falló no es la de `items`.
    if (!descartados.length || (!instVivas.length && !respVivas.length)) throw e

    instLote = instVivas
    respLote = respVivas
    return unirDescartes({ item_ids: descartados, motivos: ['item_borrado'] }, await intentar())
  }
}

/**
 * Un 42501 tiene cuatro causas posibles (evaluación no activa, ítem desactivado,
 * asignación dada de baja, módulo no habilitado en la sucursal) y el mensaje las
 * adivinaba todas. El cliente solo puede distinguir la primera con certeza, y es
 * la más común: se consulta y se dice la verdad en vez de seguir probando.
 */
async function precisarCausaDePermiso(e: ErrorSubida, evaluacionId: string): Promise<ErrorSubida> {
  if (e.causa !== 'rechazada') return e
  const { data } = await supabase.from('evaluaciones').select('estado').eq('id', evaluacionId).maybeSingle()
  const estado = (data as { estado?: string } | null)?.estado
  if (!estado || estado === 'ACTIVA') return e
  const err = new Error(e.message) as ErrorSubida
  err.causa = 'evaluacion_cerrada'
  err.detalle = e.detalle
  return err
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
): Promise<Descarte> {
  if (!respuestas.length && !instancias.length) return { item_ids: [], motivos: [] }
  const instRows: FilaInstancia[] = instancias.map((ins) => ({
    id: ins.id,
    evaluacion_id: evaluacionId,
    item_id: ins.item_id,
    etiqueta: ins.etiqueta,
    orden: ins.orden,
    api_id: ins.api_id ?? null,
    datos: ins.datos ?? null
  }))
  const respRows: FilaRespuesta[] = respuestas.map((r) => ({
    evaluacion_id: evaluacionId,
    item_id: r.item_id,
    instancia_id: r.instancia_id,
    valor: valorSinFotos(r.valor),
    respondido_por: evaluadorId
  }))
  let descarte: Descarte
  try {
    descarte = await subirLote(instRows, respRows)
  } catch (e) {
    // Se propaga tipado (causa + detalle técnico) para que la pantalla diga qué
    // pasó de verdad en vez de culpar siempre a la conexión.
    throw await precisarCausaDePermiso(errorSubida(e, 'guardar el avance'), evaluacionId)
  }
  // La subida terminó bien: queda registrada como última sincronización del usuario.
  void marcarSyncNube()
  return descarte
}

export async function procesarCola(): Promise<{ ok: number; fail: number; descartes: Descarte[]; errores: string[] }> {
  const jobs = await listQueue()
  let ok = 0
  let fail = 0
  const errores: string[] = []
  // Ítems que el catálogo ya no tiene, por trabajo. La cola no se traba por
  // ellos: se suben las respuestas que siguen vigentes y el resto se avisa.
  const descartes: Descarte[] = []
  for (const job of jobs) {
    if (job.status === 'processing') continue
    await putJob({ ...job, status: 'processing' })
    const photoIds = idsFotosRespuesta(job.respuestas, job.photoIds)

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
      for (const id of photoIds) {
        const rec = await getPhotos([id]).then((r) => r[0])
        if (!rec) throw new Error(`No se encontró la foto local ${id}; la evaluación quedó pendiente y no se descartó.`)
        const path = photoPath(job.id, 'evidencia', id)
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, rec.blob, {
          contentType: rec.mime,
          upsert: false
        })
        if (upErr && !/already exists|already-exists|duplicate/i.test(upErr.message)) throw upErr
        map.set(id, path)
      }

      const instRows: FilaInstancia[] = (job.instancias ?? []).map((ins) => ({
        id: ins.id,
        evaluacion_id: evaluacionId,
        item_id: ins.item_id,
        etiqueta: ins.etiqueta,
        orden: ins.orden,
        api_id: ins.api_id ?? null,
        datos: ins.datos ?? null
      }))

      const rows: FilaRespuesta[] = job.respuestas.map((r) => ({
        evaluacion_id: evaluacionId,
        item_id: r.item_id,
        instancia_id: r.instancia_id,
        valor: convertirValor(r.valor, map),
        respondido_por: job.evaluador_id
      }))
      const descarte = await subirLote(instRows, rows)
      if (descarte.item_ids.length) descartes.push(descarte)

      // Solo van fotos de respuestas que el servidor aceptó: una fila en `fotos`
      // también lleva `item_id` y rebotaría con la misma FK.
      const sinDescartar = job.respuestas.filter((r) => !descarte.item_ids.includes(r.item_id))
      for (const r of sinDescartar) {
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

      for (const id of photoIds) await deletePhoto(id)
      await deleteJob(job.id)
      ok++
    } catch (error) {
      const detalle = `${job.id}: ${detalleTecnico(error)}`
      errores.push(detalle)
      console.error('No se pudo sincronizar la evaluación y sus evidencias:', detalle, error)
      await putJob({ ...job, status: 'pending' })
      fail++
    }
  }
  // La cola se vació al menos una vez: el dispositivo volvió a tener señal.
  if (ok) void marcarSyncNube()
  return { ok, fail, descartes, errores }
}

/** Dónde vive la foto de una incidencia en el bucket `evidencias`. */
export function pathFotoIncidencia(incidenteId: string, photoId: string): string {
  return `incidencias/${incidenteId}/${photoId}`
}

/**
 * Sube las incidencias reportadas desde la evaluación que todavía están locales.
 * Igual que la cola de respuestas: resuelve la evaluación por sucursal + fecha
 * (debe estar ACTIVA), sube las fotos al bucket `evidencias` y guarda la fila en
 * `incidentes` (ver supabase/schema.sql). Si algo falla, la incidencia se
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
        descripcion: inc.descripcion,
        // `por_validar` viaja al servidor a propósito: el Líder tiene que poder
        // ver desde la nube que ese cargo se escribió a mano y todavía no se
        // confirmó contra el catálogo.
        responsables: responsablesAColumna(normalizarResponsables(inc.responsables))
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