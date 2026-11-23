/**
 * LA TASA DE CAMBIO DEL TABULADOR: BCV, CON ALTERNATIVA MANUAL
 * ------------------------------------------------------------
 * La tasa que muestra el tabulador es la DEL BCV —DolarAPI la publica con
 * CORS abierto (`Access-Control-Allow-Origin: *`), así que el navegador la
 * pide directo, sin proxy ni función de servidor— y, como ALTERNATIVA, la
 * que se cargue a mano.
 *
 * El orden de la pantalla: **manual → BCV → tasa del archivo** (la que
 * trae el Excel y queda como respaldo cuando no hay red ni valor cargado).
 *
 * La manual vive en `localStorage` (no en la base): es una preferencia de
 * visualización de quien consulta, el tabulador sigue siendo de SÓLO
 * LECTURA y así no hace falta ni política de escritura ni SQL nuevo —y
 * tampoco la pisa el import del Excel.
 */

/** Lo que la pantalla muestra: el valor y de dónde salió. */
export interface TasaBcv {
  valor: number
  /** `fechaActualizacion` de la API, ISO. */
  fecha: string
}

const URL_TASA = 'https://ve.dolarapi.com/v1/dolares'
const CLAVE_MANUAL = 'luxor_tabulador_tasa_manual'

/**
 * La tasa oficial (BCV) del día, o `null` si no hay red, si la API no
 * contesta o si viene sin el valor oficial —cualquier falla es eso: nada,
 * y la pantalla se queda con la tasa manual o la del archivo.
 */
export async function obtenerTasaBcv(signal?: AbortSignal): Promise<TasaBcv | null> {
  try {
    const respuesta = await fetch(URL_TASA, { signal })
    if (!respuesta.ok) return null
    const datos: unknown = await respuesta.json()
    if (!Array.isArray(datos)) return null
    const oficial = datos.find(
      (d): d is { fuente: string; promedio: number; fechaActualizacion?: string } =>
        !!d &&
        typeof d === 'object' &&
        (d as { fuente?: unknown }).fuente === 'oficial' &&
        typeof (d as { promedio?: unknown }).promedio === 'number'
    )
    if (!oficial) return null
    return { valor: oficial.promedio, fecha: String(oficial.fechaActualizacion ?? '') }
  } catch {
    return null
  }
}

/**
 * La tasa cargada a mano, o `null` si no hay.
 *
 * `localStorage` puede no existir (modo privado) o estar lleno: ahí no se
 * guarda nada y la pantalla sigue con la BCV.
 */
export function leerTasaManual(): number | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_MANUAL)
    if (!crudo) return null
    const valor = Number(crudo)
    return Number.isFinite(valor) && valor > 0 ? valor : null
  } catch {
    return null
  }
}

/** Guarda la tasa manual (sólo valores positivos; `null` la borra). */
export function guardarTasaManual(valor: number | null): void {
  try {
    if (valor == null) {
      window.localStorage.removeItem(CLAVE_MANUAL)
      return
    }
    if (Number.isFinite(valor) && valor > 0) {
      window.localStorage.setItem(CLAVE_MANUAL, String(valor))
    }
  } catch {
    // Sin localStorage no hay manual: la pantalla se queda con la BCV.
  }
}
