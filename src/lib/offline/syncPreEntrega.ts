import { supabase } from '../supabase'
import {
  eliminarPreEntrega,
  getPhotos,
  marcarPreEntregaEnviada,
  preEntregasPendientes,
  type PreEntregaRecord
} from './db'
import { guardarRevisionPreEntrega } from '../data/revisionPreEntrega'
import { CARPETA_INSPECCION } from '../fotos'
import { convertirValor } from './transform'

/** Carpeta de las fotos en el bucket: pre-entrega/<revision_id>/<foto_id>.<ext>. */
const CARPETA = CARPETA_INSPECCION

function extensionDe(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  return 'jpg'
}

/**
 * Sube una revisión al servidor: primero la fila, después sus fotos y al final
 * la fila otra vez, ya con las respuestas apuntando al bucket.
 *
 * El primer guardado va antes que las fotos porque la política de storage exige
 * que la revisión ya exista para poder escribir bajo `pre-entrega/<id>/`.
 *
 * El segundo guardado es el que hace que la inspección se pueda ver desde
 * cualquier equipo: las respuestas crudas traen `photoIds`, que son ids de
 * IndexedDB y sólo existen en el teléfono que sacó la foto. Recién cuando
 * `convertirValor` los cambia por los `paths` del bucket queda algo que el
 * historial y el PDF puedan pintar en otro dispositivo. Sin esa segunda pasada
 * la fila del servidor guardaba ids colgando (mismo criterio que la subida de
 * evaluaciones, ver `convertirValor` en `transform.ts`).
 *
 * Al terminar:
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
  /** id local → ruta en el bucket: lo que convierte las respuestas al final. */
  const mapa = new Map<string, string>()
  for (const f of fotos) {
    const path = `${CARPETA}/${rev.id}/${f.id}.${extensionDe(f.mime)}`
    const { error } = await supabase.storage.from('evidencias').upload(path, f.blob, {
      contentType: f.mime,
      upsert: true
    })
    if (error) throw error
    mapa.set(f.id, path)
  }

  // Segunda pasada, sólo si algo subió: con el mapa se reescriben las
  // respuestas. Si ninguna foto estuvo disponible no se vuelve a tocar la fila,
  // que ya quedó guardada con lo que había.
  if (mapa.size) await guardarRevisionPreEntrega(cargaDe(rev, mapa))

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

/**
 * La carga que se manda al servidor.
 *
 * Con `mapa` (id local → ruta en el bucket) cada respuesta pasa por
 * `convertirValor`, que cambia los `photoIds` locales por los `paths` ya
 * subidos. Sin mapa se manda tal cual, que es lo que sirve para el primer
 * guardado —la fila tiene que existir antes que sus fotos— y para las revisiones
 * que no llevan ninguna evidencia.
 */
function cargaDe(r: PreEntregaRecord, mapa?: Map<string, string>) {
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
    respuestas: mapa?.size
      ? Object.fromEntries(
          Object.entries(r.respuestas).map(([itemId, valor]) => [itemId, convertirValor(valor, mapa)])
        )
      : r.respuestas,
    estado: r.estado,
    fecha: r.fecha
  }
}
