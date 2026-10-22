import { supabase } from '../supabase'
import {
  eliminarPreEntrega,
  getPhotos,
  marcarPreEntregaEnviada,
  preEntregasPendientes,
  type PreEntregaRecord
} from './db'
import { guardarRevisionPreEntrega } from '../data/revisionPreEntrega'

/** Carpeta de las fotos en el bucket: pre-entrega/<revision_id>/<foto_id>.<ext>. */
const CARPETA = 'pre-entrega'

function extensionDe(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  return 'jpg'
}

/**
 * Sube una revisión al servidor: primero la fila y después sus fotos.
 *
 * El orden va así porque la política de storage exige que la revisión ya exista
 * para poder escribir bajo `pre-entrega/<id>/`. Al terminar:
 * - si es un borrador, queda en el dispositivo como `enviado` (se puede seguir
 *   editando; al tocarlo vuelve a `pendiente`);
 * - si ya está finalizada, se borra de local con sus fotos.
 *
 * Una foto que falla sube igual la revisión (el PDF ya salió): no se corta la
 * entrega por una evidencia, pero tampoco se da por enviada una revisión que no
 * llegó.
 */
export async function subirRevisionPreEntrega(rev: PreEntregaRecord): Promise<void> {
  await guardarRevisionPreEntrega(cargaDe(rev))

  const fotos = await getPhotos(rev.photoIds)
  for (const f of fotos) {
    const path = `${CARPETA}/${rev.id}/${f.id}.${extensionDe(f.mime)}`
    const { error } = await supabase.storage.from('evidencias').upload(path, f.blob, {
      contentType: f.mime,
      upsert: true
    })
    if (error) throw error
  }

  if (rev.estado === 'FINALIZADA') await eliminarPreEntrega(rev.id)
  else await marcarPreEntregaEnviada(rev.id)
}

/**
 * Sube las revisiones pre-entrega que quedaron en el dispositivo.
 *
 * Una revisión que falla queda pendiente para el siguiente intento (no se
 * reintenta en bucle cerrado): el rechazo del servidor lo ve OfflineContext.
 */
export async function sincronizarRevisionesPreEntrega(): Promise<{ ok: number; fail: number }> {
  const pendientes = await preEntregasPendientes()
  let ok = 0
  let fail = 0

  for (const rev of pendientes) {
    try {
      await subirRevisionPreEntrega(rev)
      ok++
    } catch {
      fail++
    }
  }

  return { ok, fail }
}

function cargaDe(r: PreEntregaRecord) {
  return {
    id: r.id,
    evaluador_id: r.evaluador_id,
    sucursal_id: r.sucursal_id,
    modulo_id: r.modulo_id,
    placa: r.placa,
    vehiculo: r.vehiculo,
    chofer: r.chofer,
    chofer_firma: r.chofer_firma,
    observaciones: r.observaciones,
    respuestas: r.respuestas,
    estado: r.estado,
    fecha: r.fecha
  }
}
