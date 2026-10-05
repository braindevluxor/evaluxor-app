import { supabase } from '../supabase'
import { causaSubida, detalleTecnico, errorSubida, mensajeSubida, type ErrorSubida } from '../subida'
import { bloqueosDeGuardado, explicacionBloqueos, type ReglasGuardado } from '../permisos-guardado'
import { deleteDraft, getPhotos, deletePhoto, listQueue, putJob, deleteJob, respuestasConInstancia, incidentesPendientes, eliminarIncidente, type SyncJob, type DraftEval } from './db'
import { photoPath, convertirValor, extraerPhotoIds, idsFotosRespuesta } from './transform'
import { normalizarResponsables, responsablesAColumna } from '../data/responsablesIncidencia'

export { respuestasConInstancia }

const TIEMPO_MAXIMO_PROCESANDO_MS = 15 * 60 * 1000
const fotosSubidasEnEstaSesion = new Set<string>()

export function trabajoProcesandoVencido(
  job: Pick<SyncJob, 'status' | 'processing_at'>,
  ahora = Date.now()
): boolean {
  return job.status === 'processing' && (
    typeof job.processing_at !== 'number' ||
    ahora - job.processing_at >= TIEMPO_MAXIMO_PROCESANDO_MS
  )
}

export function instanciasDeDraft(draft: DraftEval): { id: string; item_id: string; etiqueta: string; orden: number; api_id?: string; datos?: Record<string, unknown> }[] {
  return Object.entries(draft.instancias ?? {}).flatMap(([item_id, arr]) =>
    arr.map((ins, i) => ({ id: ins.id, item_id, etiqueta: ins.etiqueta, orden: typeof ins.orden === 'number' ? ins.orden : i, api_id: ins.api_id, datos: ins.datos }))
  )
}

async function subirFotosDeRespuestas(
  evaluacionId: string,
  respuestas: { item_id: string; valor: unknown }[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const respuesta of respuestas) {
    for (const id of extraerPhotoIds(respuesta.valor)) {
      if (map.has(id)) continue
      const path = photoPath(evaluacionId, 'evidencia', id)
      if (fotosSubidasEnEstaSesion.has(path)) {
        map.set(id, path)
        continue
      }
      const rec = await getPhotos([id]).then((r) => r[0])
      if (!rec) throw new Error(`No se encontró la foto local ${id}; no se sincronizó el borrador con sus evidencias.`)
      const { error } = await supabase.storage.from('evidencias').upload(path, rec.blob, {
        contentType: rec.mime,
        upsert: false
      })
      if (error && !/already exists|already-exists|duplicate/i.test(error.message)) throw error
      fotosSubidasEnEstaSesion.add(path)
      map.set(id, path)
    }
  }
  return map
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

/** Cuántos ids entran por consulta al catálogo: van en la URL y tienen un tope. */
const idsPorConsulta = 100

/**
 * Los datos que hay que mirar para saber qué regla de RLS falló. Todos están
 * abiertos a autenticados salvo `asignaciones_modulos`, del que cada usuario ve
 * solo las suyas (política `asignaciones_modulos_select`), que es justo lo que
 * hace falta: si el módulo del ítem no aparece ahí con `activa`, no lo tiene.
 *
 * Devuelve `null` si falta algo: sin los datos completos es mejor no explicar
 * nada que explicar la mitad y dejar al evaluador creyendo a medias.
 */
async function reglasDeGuardado(sucursalId: string | undefined, itemIds: string[]): Promise<ReglasGuardado | null> {
  if (!sucursalId || !itemIds.length) return null
  try {
    // Los ids van en la URL del POST, así que un avance largo se reparte: metidos
    // todos en un `in` una evaluación con muchas respuestas llegaría a cortar la
    // petición, y perder el diagnóstico por eso sería perderlo justamente en el
    // caso grande, que es donde más ítems puede haber bloqueados.
    const trozos: string[][] = []
    for (let i = 0; i < itemIds.length; i += idsPorConsulta) trozos.push(itemIds.slice(i, i + idsPorConsulta))
    const [consultas, asignaciones, deLaSucursal] = await Promise.all([
      Promise.all(trozos.map((ids) => supabase.from('items').select('id, modulo_id').in('id', ids))),
      supabase.from('asignaciones_modulos').select('modulo_id').eq('activa', true),
      supabase.from('sucursal_modulos').select('modulo_id').eq('sucursal_id', sucursalId).eq('activa', true)
    ])
    if (asignaciones.error || deLaSucursal.error) return null
    if (consultas.some((c) => c.error)) return null

    const filas = consultas.flatMap((c) => (c.data ?? []) as { id: string; modulo_id: string | null }[])
    const moduloDeItem = new Map<string, string | null>(filas.map((f) => [f.id, f.modulo_id ?? null]))

    // Los nombres van aparte para poder decir «Almacén» y no un UUID. Si esta
    // consulta falla se sigue igual: el nombre es para que se entienda, no para
    // detectar el bloqueo.
    const nombreDeModulo = new Map<string, string>()
    const modulos = [...new Set(filas.map((f) => f.modulo_id).filter((id): id is string => !!id))]
    if (modulos.length) {
      const { data } = await supabase.from('modulos').select('id, nombre').in('id', modulos)
      for (const m of (data ?? []) as { id: string; nombre: string }[]) nombreDeModulo.set(m.id, m.nombre)
    }

    return {
      asignados: new Set((asignaciones.data ?? []).map((a) => (a as { modulo_id: string }).modulo_id)),
      habilitadosSucursal: new Set((deLaSucursal.data ?? []).map((s) => (s as { modulo_id: string }).modulo_id)),
      moduloDeItem,
      nombreDeModulo
    }
  } catch {
    return null
  }
}

/**
 * Un 42501 tiene cuatro causas posibles (evaluación no activa, ítem desactivado,
 * asignación dada de baja, módulo no habilitado en la sucursal) y el mensaje las
 * adivinaba todas: se le mostraba al evaluador el texto crudo de Postgres,
 * `new row violates row-level security policy for table "instancias_grupo"`.
 *
 * La evaluación se consulta y se afirma con certeza, que es el caso más común.
 * Si sigue abierta se le pregunta al catálogo las otras dos reglas que el
 * evaluador sí puede leer (ver `lib/permisos-guardado.ts`) y el motivo concreto
 * queda en `explicacion`. Si algo de eso falla, el error vuelve como estaba:
 * peor un motivo genérico que un motivo inventado.
 */
async function explicarPermiso(e: ErrorSubida, evaluacionId: string, itemIds: string[]): Promise<ErrorSubida> {
  if (e.causa !== 'rechazada') return e
  const { data } = await supabase.from('evaluaciones').select('estado, sucursal_id').eq('id', evaluacionId).maybeSingle()
  const evaluacion = data as { estado?: string; sucursal_id?: string } | null
  const estado = evaluacion?.estado
  if (!estado) return e

  if (estado !== 'ACTIVA') {
    const err = new Error(e.message) as ErrorSubida
    err.causa = 'evaluacion_cerrada'
    err.detalle = e.detalle
    return err
  }

  const reglas = await reglasDeGuardado(evaluacion.sucursal_id, itemIds)
  const explicacion = reglas ? explicacionBloqueos(bloqueosDeGuardado(reglas)) : null
  if (explicacion) e.explicacion = explicacion
  return e
}

/**
 * Lo mismo para la cola: se tipa el error y se le pregunta qué ítems eran, para
 * poder nombrarle al evaluador la regla que falló en vez de dejarle la interna de
 * Postgres en la franja de arriba de la pantalla.
 *
 * Sin evaluación resuelta no hay nada que preguntar: un 42501 sin evaluación es
 * un rechazo que no se puede atribuir, y `errorSubida` ya lo deja como
 * `rechazada`, que es lo honesto.
 */
async function explicarRechazoDeSync(
  error: unknown,
  evaluacionId: string,
  job: Pick<SyncJob, 'respuestas' | 'instancias'>
): Promise<ErrorSubida> {
  const tipado = errorSubida(error, 'sincronizar')
  if (!evaluacionId || tipado.causa !== 'rechazada') return tipado
  const itemIds = [...new Set([...(job.instancias ?? []), ...job.respuestas].map((f) => f.item_id))]
  return explicarPermiso(tipado, evaluacionId, itemIds)
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
  let descarte: Descarte
  try {
    const fotos = await subirFotosDeRespuestas(evaluacionId, respuestas)
    const respRows: FilaRespuesta[] = respuestas.map((r) => ({
      evaluacion_id: evaluacionId,
      item_id: r.item_id,
      instancia_id: r.instancia_id,
      valor: convertirValor(r.valor, fotos),
      respondido_por: evaluadorId
    }))
    descarte = await subirLote(instRows, respRows)
  } catch (e) {
    // Se propaga tipado (causa + detalle técnico + explicación si se pudo saber
    // qué regla falló) para que la pantalla diga qué pasó de verdad en vez de
    // culpar siempre a la conexión.
    const itemIds = [...new Set([...instancias, ...respuestas].map((f) => f.item_id))]
    throw await explicarPermiso(errorSubida(e, 'guardar el avance'), evaluacionId, itemIds)
  }
  // La subida terminó bien: queda registrada como última sincronización del usuario.
  void marcarSyncNube()
  return descarte
}

export async function procesarCola(): Promise<{
  ok: number
  fail: number
  descartes: Descarte[]
  errores: string[]
  mensajes: string[]
}> {
  const jobs = await listQueue()
  let ok = 0
  let fail = 0
  const errores: string[] = []
  // Lo mismo que `errores`, pero escrito para que lo lea quien está en el local
  // y no una consola. Antes la cola solo tenía la interna de Postgres, que en el
  // teléfono se leía como `42501 · new row violates row-level security policy
  // for table "instancias_grupo"`: un mensaje que no dice qué hacer.
  const mensajes: string[] = []
  // Ítems que el catálogo ya no tiene, por trabajo. La cola no se traba por
  // ellos: se suben las respuestas que siguen vigentes y el resto se avisa.
  const descartes: Descarte[] = []
  for (const queuedJob of jobs) {
    let job = queuedJob
    if (job.status === 'processing') {
      if (!trabajoProcesandoVencido(job)) continue
      // Versiones anteriores no guardaban cuándo empezó el trabajo; esos estados
      // son abandonados y deben volver a intentar la carga de sus fotos.
      job = { ...job, status: 'pending' }
      await putJob(job)
    }
    job = { ...job, status: 'processing', processing_at: Date.now() }
    await putJob(job)
    const photoIds = idsFotosRespuesta(job.respuestas, job.photoIds)
    // Se resuelve adentro del try pero el motivo del rechazo hay que nombrarlo en
    // el catch, así que vive acá arriba.
    let evaluacionId = ''

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
      evaluacionId = ev.id as string

      const map = new Map<string, string>()
      for (const id of photoIds) {
        const rec = await getPhotos([id]).then((r) => r[0])
        if (!rec) throw new Error(`No se encontró la foto local ${id}; la evaluación quedó pendiente y no se descartó.`)
        const path = photoPath(evaluacionId, 'evidencia', id)
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
      const tipado = await explicarRechazoDeSync(error, evaluacionId, job)
      const detalle = `${job.id}: ${detalleTecnico(tipado)}`
      errores.push(detalle)
      mensajes.push(tipado.explicacion ?? `${mensajeSubida(tipado.causa, 'sincronizar').titulo}. Tu avance sigue en el teléfono.`)
      console.error('No se pudo sincronizar la evaluación y sus evidencias:', detalle, error)
      await putJob({ ...job, status: 'pending' })
      fail++
    }
  }
  // La cola se vació al menos una vez: el dispositivo volvió a tener señal.
  if (ok) void marcarSyncNube()
  return { ok, fail, descartes, errores, mensajes }
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