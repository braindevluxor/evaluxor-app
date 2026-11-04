import { supabase } from '../supabase'
import { avisar } from '../aviso'
import type { ReporteCargosDatos } from '../pdf/reporteCargos'
import { generarToken, type EnlaceCompartido, type EvaluacionPublica } from './compartir'

/**
 * Enlace público de las FALLAS POR CARGO de una evaluación (pantalla de
 * invitado): la bitácora de atención del trabajador.
 *
 * El Líder elige los cargos, se baja el reporte y puede mandarle el mismo
 * contenido en un link a quien no tiene cuenta en la app. Es el hermano del
 * enlace de conciliación (`compartir.ts`), con la misma forma de cerrar —
 * token de32 bytes, tabla cerrada a `anon`, una sola función abierta — y una
 * diferencia de fondo:
 *
 * **Acá el enlace guarda el reporte CONGELADO** (`datos`, jsonb) en el momento
 * de generarlo, en vez de recalcular al abrirse. Hay dos razones: las
 * reincidencias se deciden contra el histórico de la unidad, que habría que
 * devolver entero para recalcularlas (y un enlace público no debe exponer las
 * respuestas de todas las evaluaciones); y es una bitácora, así que lo que se
 * le manda al trabajador es lo que se le mandó. Si cambia, se genera otro.
 *
 * Las FOTOS viajan como rutas y no como URLs firmadas: las firma la pantalla
 * pública cada vez que alguien abre el enlace (una sesión anónima sí puede
 * firmar en Storage), así el link no se vence con el tiempo ni hay que
 * guardar URLs con caducidad en la base.
 *
 * Todo lo que hace este módulo es: generar un token, guardarlo, apagarlo y
 * leer el paquete que devuelve el RPC. Nada de edición: la pantalla pública no
 * tiene permiso de creación, edición ni borrado. Ver
 * `supabase/compartir-cargos.sql`.
 */

/** El paquete que devuelve `ver_cargos_compartidos` cuando el enlace sirve. */
export interface CargosPublicos {
  /** `null` cuando el token no existe o el enlace está apagado. */
  evaluacion: EvaluacionPublica | null
  /** El reporte congelado: mismo molde que el que bajan el PDF y el Excel. */
  datos: ReporteCargosDatos
  /** Cuándo se generó esta foto del reporte (`created_at` del enlace). */
  generado: string | null
}

/** El enlace tal como se le pega al trabajador. En el navegador sale del origen actual. */
export function urlCompartidaCargos(token: string): string {
  const base = typeof location !== 'undefined' ? location.origin : ''
  return `${base}/compartir/cargos/${token}`
}

export async function obtenerEnlaceCargos(evaluacionId: string): Promise<EnlaceCompartido | null> {
  const { data } = await supabase
    .from('cargos_compartidos')
    .select('evaluacion_id, token, activo, creado_at')
    .eq('evaluacion_id', evaluacionId)
    .maybeSingle()
  return (data as EnlaceCompartido | null) ?? null
}

/**
 * Genera (o regenera) el enlace de los cargos de una evaluación.
 *
 * Mismo criterio que el de conciliación: la PK de la tabla es la evaluación,
 * así que compartir de nuevo REEMPLAZA el token anterior (y el reporte) en vez
 * de acumular links viejos que nadie puede apagar. Por eso es reversible con
 * un solo `activo = false`.
 */
export async function compartirCargos(
  evaluacionId: string,
  datos: ReporteCargosDatos,
  creadoPor: string | null
): Promise<EnlaceCompartido> {
  const conFotos = await firmarFotosDeReporte(datos)
  const { data, error } = await supabase
    .from('cargos_compartidos')
    .upsert(
      { evaluacion_id: evaluacionId, token: generarToken(), datos: conFotos, activo: true, creado_por: creadoPor },
      { onConflict: 'evaluacion_id' }
    )
    .select('evaluacion_id, token, activo, creado_at')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo generar el enlace')
  return data as EnlaceCompartido
}

/** Cuánto duran las URLs firmadas que quedan guardadas dentro del enlace. */
const SEGUNDOS_DE_FIRMA = 60 * 60 * 24 * 365

/**
 * Pone las URLs ya firmadas de las fotos del reporte.
 *
 * Se firma ACÁ y con la sesión del que comparte, no con sesión anónima en la
 * pantalla pública: es la misma sesión con la que el detalle de la evaluación
 * muestra esas fotos, así que es la que sabemos que puede bajarlas.
 *
 * Si la firma falla —vencimiento que Storage no acepta, red caída— el enlace
 * se genera igual SIN fotos, y la pantalla pública cae en su firma de
 * respaldo. Nunca se rompe el link por esto.
 */
async function firmarFotosDeReporte(datos: ReporteCargosDatos): Promise<ReporteCargosDatos> {
  // Videos incluidos: el detalle los muestra con su póster y el visor sabe
  // reproducirlos, y el enlace pretende ser el mismo contenido que el detalle.
  const rutas = Array.from(new Set(datos.cargos.flatMap((c) => c.pendientes.flatMap((p) => p.fotos))))
  if (!rutas.length) return datos
  try {
    const { data, error } = await supabase.storage.from('evidencias').createSignedUrls(rutas, SEGUNDOS_DE_FIRMA)
    if (error) throw new Error(error.message)
    const firmadas: Record<string, string> = {}
    for (const firma of data ?? []) {
      // OJO: la librería devuelve DOS campos y sólo uno sirve. `signedURL` es
      // la ruta relativa que devuelve Storage (`/object/sign/…?token=…`),
      // que en el <img> se resolvería contra el origen de la APP (otro
      // dominio en producción, localhost en dev) y daría 404. `signedUrl`
      // (con la «l» minúscula) es la absoluta, con el host de Storage:
      // es la que usa `Fotogaleria` y es la única que carga.
      if (firma.signedUrl && firma.path) firmadas[firma.path] = firma.signedUrl
    }
    if (!Object.keys(firmadas).length) throw new Error('Storage no devolvió ninguna URL')
    return { ...datos, fotosFirmadas: firmadas }
  } catch (e) {
    // Nunca en silencio: un enlace sin fotos es un enlace a medio hacer, y el
    // que lo comparte es el único que puede verlo.
    avisar(
      `El enlace se generó SIN fotos: ${e instanceof Error ? e.message : 'no se pudieron firmar sus URLs'}`,
      'aviso'
    )
    return datos
  }
}

/** Apaga el enlace. No borra nada: el token deja de servir desde el próximo intento. */
export async function apagarEnlaceCargos(evaluacionId: string): Promise<void> {
  const { error } = await supabase
    .from('cargos_compartidos')
    .update({ activo: false })
    .eq('evaluacion_id', evaluacionId)
  if (error) throw new Error(error.message)
}

/**
 * Lee el reporte que corresponde a un token, SIN sesión.
 *
 * Devuelve `null` en los dos casos que la pantalla no debe distinguir: el
 * token no existe y el enlace está apagado. Si los distinguiera, habría que
 * adivinar tokens comparando respuestas.
 */
export async function leerCargosPublicos(token: string): Promise<CargosPublicos | null> {
  const { data, error } = await supabase.rpc('ver_cargos_compartidos', { p_token: token })
  if (error) throw new Error(error.message)
  const paquete = data as {
    evaluacion?: EvaluacionPublica | null
    datos?: ReporteCargosDatos
    generado?: string | null
  } | null
  if (!paquete?.evaluacion || !paquete.datos) return null
  return paquete as CargosPublicos
}
