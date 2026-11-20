import { supabase } from '../supabase'
import { generarToken } from './compartir'
import { evidenciasDeRespuestas } from '../inspeccionVehiculo'
import type { Item } from '../types'

/**
 * ENLACE PÚBLICO DE UNA INSPECCIÓN (y de la Revisión Pre-Entrega)
 * --------------------------------------------------------------
 * El PDF ya no pega las fotos: lleva un QR que apunta a ESTE enlace, que
 * muestra el detalle entero —la tabla de puntos con sus comentarios y el
 * material visual, fotos y videos— sin cuenta.
 *
 * Es el molde de `compartirCargos.ts`, con las mismas tres decisiones:
 *
 *  * La PK es la REVISIÓN: compartir de nuevo REEMPLAZA el enlace (y su
 *    reporte congelado) en vez de acumular links viejos que nadie puede
 *    apagar. Se apaga con `apagarEnlaceInspeccion`.
 *  * El detalle viaja CONGELADO en `datos`: es una inspección finalizada,
 *    así que lo que se le manda al que escanea es lo que se le entregó.
 *  * Las fotos viajan como RUTAS y con sus URLs ya firmadas (un año). Si la
 *    firma falla o falta alguna —una foto que todavía no se subió—, la
 *    pantalla pública firma las que falten con sesión anónima: una sesión
 *    anónima SÍ puede firmar en Storage, así que el enlace nunca queda
 *    a medio hacer por esto.
 *
 * Ver `supabase/compartir-inspeccion.sql`.
 */

/** Una fila de la tabla de puntos (la MISMA que imprime el PDF). */
export interface FilaInspeccion {
  etiqueta: string
  valor: string
  /** La sección (Estética / Mecánica / Gas) que la agrupa en el documento. */
  grupo?: string | null
}

/** Un bloque de evidencia: su pie y las rutas de sus fotos/videos. */
export interface EvidenciaInspeccion {
  pie: string
  rutas: string[]
}

/** El detalle congelado que muestra la página pública. */
export interface DetalleInspeccion {
  /** El nombre del módulo: es el título del documento y del enlace. */
  titulo: string
  fecha: string
  evaluador: string | null
  observaciones: string | null
  vehiculo: {
    placa?: string | null
    marca?: string | null
    modelo?: string | null
    color?: string | null
    anio?: string | null
    flota?: string | null
    kilometraje?: string | null
    combustible?: string | null
  }
  persona: {
    cedula?: string | null
    nombre?: string | null
    apellido?: string | null
    telefono?: string | null
    /** La firma dibujada (data URL): se muestra igual que en el PDF. */
    firma?: string | null
  }
  items: FilaInspeccion[]
  evidencias: EvidenciaInspeccion[]
  /** Ruta → URL firmada. Si falta alguna, la pantalla pública la firma. */
  fotosFirmadas?: Record<string, string>
}

/** El enlace tal como queda guardado (lo que muestra el botón de compartir). */
export interface EnlaceInspeccion {
  token: string
  activo: boolean
  creado_at: string
}

/** El paquete que devuelve `ver_inspeccion_compartida` cuando el enlace sirve. */
export interface InspeccionPublica {
  /** `null` cuando el token no existe o el enlace está apagado. */
  datos: DetalleInspeccion | null
  generado: string | null
}

/**
 * El detalle armado desde lo que la pantalla ya tiene en mano.
 *
 * Las evidencias salen de `evidenciasDeRespuestas`: su PIE y sus RUTAS en
 * Storage. Las fotos que todavía están SÓLO en el teléfono (sin subir) no
 * traen ruta y quedan afuera de acá — un enlace público no puede mostrar
 * un archivo que todavía no está en el servidor.
 */
export function armarDetalleInspeccion(o: {
  titulo: string
  fecha: string
  evaluador: string | null
  observaciones: string | null
  vehiculo: DetalleInspeccion['vehiculo']
  persona: DetalleInspeccion['persona']
  /** Las filas de la tabla, que ya armó para el PDF. */
  items: FilaInspeccion[]
  /** Los ítems evaluables, para resolver de qué punto es cada evidencia. */
  itemsEvaluables: Item[]
  respuestas: Record<string, unknown>
}): DetalleInspeccion {
  return {
    titulo: o.titulo,
    fecha: o.fecha,
    evaluador: o.evaluador,
    observaciones: o.observaciones,
    vehiculo: o.vehiculo,
    persona: o.persona,
    items: o.items,
    evidencias: evidenciasDeRespuestas(o.itemsEvaluables, o.respuestas).map((e) => ({
      pie: e.pie,
      rutas: e.paths
    }))
  }
}

/** El enlace tal como se le pega a quien escanea. En el navegador sale del origen actual. */
export function urlCompartidaInspeccion(token: string): string {
  const base = typeof location !== 'undefined' ? location.origin : ''
  return `${base}/compartir/inspeccion/${token}`
}

export async function obtenerEnlaceInspeccion(revisionId: string): Promise<EnlaceInspeccion | null> {
  const { data } = await supabase
    .from('inspecciones_compartidas')
    .select('token, activo, creado_at')
    .eq('revision_id', revisionId)
    .maybeSingle()
  return (data as EnlaceInspeccion | null) ?? null
}

/** Cuánto duran las URLs firmadas que quedan guardadas dentro del enlace. */
const SEGUNDOS_DE_FIRMA = 60 * 60 * 24 * 365

/**
 * Genera (o regenera) el enlace de una inspección y devuelve su URL.
 *
 * La PK es la revisión, así que volver a compartir REEMPLAZA el token
 * anterior: el QR del PDF viejo deja de servir y el nuevo es el único
 * vigente. Por eso es reversible con un solo `activo = false`.
 */
export async function compartirInspeccion(
  revisionId: string,
  detalle: DetalleInspeccion,
  creadoPor: string | null
): Promise<{ token: string; url: string }> {
  const conFotos = await firmarEvidencias(detalle)
  const { data, error } = await supabase
    .from('inspecciones_compartidas')
    .upsert(
      {
        revision_id: revisionId,
        token: generarToken(),
        datos: conFotos,
        activo: true,
        creado_por: creadoPor
      },
      { onConflict: 'revision_id' }
    )
    .select('token')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo generar el enlace de la inspección.')
  const token = data.token as string
  return { token, url: urlCompartidaInspeccion(token) }
}

/**
 * Pone las URLs ya firmadas de las evidencias.
 *
 * Se firma ACÁ y con la sesión del que exporta —la misma con la que el
 * detalle de la app muestra esas fotos—, no con sesión anónima en la
 * pantalla pública: es la que sabemos que puede bajarlas.
 *
 * Si la firma falla, el enlace se genera igual SIN URLs firmadas y la
 * pantalla pública firma las rutas al abrirlo. Nunca se rompe el link por
 * esto: una inspección sin fotos end-to-end sigue siendo una inspección.
 */
async function firmarEvidencias(detalle: DetalleInspeccion): Promise<DetalleInspeccion> {
  const rutas = Array.from(new Set(detalle.evidencias.flatMap((e) => e.rutas)))
  if (!rutas.length) return detalle
  try {
    const { data, error } = await supabase.storage.from('evidencias').createSignedUrls(rutas, SEGUNDOS_DE_FIRMA)
    if (error) throw new Error(error.message)
    const firmadas: Record<string, string> = {}
    for (const firma of data ?? []) {
      // OJO: la librería devuelve DOS campos y sólo uno sirve. `signedURL` es
      // la ruta RELATIVA que devuelve Storage, que en un <img> se resolvería
      // contra el origen de la app (otro dominio en producción) y daría 404.
      // `signedUrl` (con la «l» minúscula) es la absoluta: es la que carga.
      if (firma.signedUrl && firma.path) firmadas[firma.path] = firma.signedUrl
    }
    return { ...detalle, fotosFirmadas: firmadas }
  } catch {
    return detalle
  }
}

/**
 * La URL del enlace de una inspección, creándolo si no existe.
 *
 * REUTILIZA el enlace activo en vez de regenerarlo: el QR va impreso en un
 * PDF que puede estar en papel, y volver a descargar el documento no puede
 * matar el QR de la copia que ya circula. Si no hay uno —o está apagado— se
 * crea recién, con el detalle de ahora.
 *
 * Lanza si no se puede (sin permiso, sin red): el llamador decide si sigue
 * sin QR o no exporta.
 */
export async function asegurarEnlaceInspeccion(
  revisionId: string,
  detalle: DetalleInspeccion,
  creadoPor: string | null
): Promise<string> {
  const existente = await obtenerEnlaceInspeccion(revisionId)
  if (existente?.activo) return urlCompartidaInspeccion(existente.token)
  const creado = await compartirInspeccion(revisionId, detalle, creadoPor)
  return creado.url
}

/** Apaga el enlace. No borra nada: el token deja de servir desde el próximo intento. */
export async function apagarEnlaceInspeccion(revisionId: string): Promise<void> {
  const { error } = await supabase
    .from('inspecciones_compartidas')
    .update({ activo: false })
    .eq('revision_id', revisionId)
  if (error) throw new Error(error.message)
}

/**
 * Lee el detalle que corresponde a un token, SIN sesión.
 *
 * Devuelve `null` en los dos casos que la pantalla no debe distinguir: el
 * token no existe y el enlace está apagado. Si los distinguiera, habría que
 * adivinar tokens comparando respuestas.
 */
export async function leerInspeccionPublica(token: string): Promise<InspeccionPublica | null> {
  const { data, error } = await supabase.rpc('ver_inspeccion_compartida', { p_token: token })
  if (error) {
    // La función todavía no existe: el bloque sin aplicar no es un enlace
    // roto, y decirlo con el mensaje crudo de PostgREST no le sirve a nadie.
    if (/could not find the function|schema cache|PGRST202/i.test(error.message)) {
      throw new Error(
        'El bloque compartir-inspeccion.sql todavía no está aplicado en la base. Pegalo en el SQL Editor de Supabase y volvé a abrir el enlace.'
      )
    }
    throw new Error(error.message)
  }
  const paquete = data as { datos?: DetalleInspeccion | null; generado?: string | null } | null
  if (!paquete?.datos) return null
  return paquete as InspeccionPublica
}
