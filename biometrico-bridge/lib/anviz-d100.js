// =============================================================================
// Driver del lector biométrico Anviz D100.
// =============================================================================
// Qué se puede hacer hoy, en este equipo, con el D100 conectado por USB:
//
//   El Windows lo reconoce (ver lib/usb.js) como "Finger Module USB Device",
//   un CD-ROM virtual: el instalador del software de Anviz. No es un canal de
//   datos, así que por USB NO se pueden leer los marcajes. Tampoco aparece como
//   puerto serie ni con IP propia.
//
//   Los marcajes se bajan con el software de PC de Anviz (AnvizTime /
//   BioAccess / Anviz F2), que habla con el equipo. Desde ahí se exporta el
//   reporte y se deja en `data/`. `lib/archivos.js` lo lee tolerando los
//   formatos que usan esas versiones.
//
//   Si en algún momento el equipo se enchuga de otra forma y Windows lo expone
//   como puerto serie o con IP propia, `leerMarcajesPorRed` queda listo para
//   talking con él; se documenta en el README cómo activarlo.
//
// Cuando haya un canal directo, se completa `leerMarcajesDelDispositivo`.
// =============================================================================

import { detectarLector } from './usb.js'
import { leerMarcajesDeArchivos, leerArchivo } from './archivos.js'

export const MODELO = 'D100'
export const MARCA = 'Anviz'

// --- Utilidades ---------------------------------------------------------------

function enRango(fecha, desde, hasta) {
  const f = new Date(fecha)
  if (Number.isNaN(f.getTime())) return false
  const d = desde ? new Date(desde) : null
  const h = hasta ? new Date(hasta) : null
  if (d && !Number.isNaN(d.getTime()) && f < d) return false
  if (h && !Number.isNaN(h.getTime()) && f > h) return false
  return true
}

// --- Estado del lector (real, no inventado) -----------------------------------

/** Estado real del lector por USB. No usa mock: informa lo que Windows ve. */
export async function leerDispositivo() {
  const deteccion = await detectarLector()

  if (!deteccion.conectado) {
    return {
      conectado: false,
      modelo: null,
      marca: MARCA,
      serial: null,
      mensaje: deteccion.mensaje
    }
  }

  return {
    conectado: true,
    modelo: deteccion.modelo,
    marca: MARCA,
    serial: deteccion.serial,
    transporte: deteccion.transporte,
    transporteEtiqueta: deteccion.transporteEtiqueta,
    // `sirve` = por este transporte se pueden leer marcajes. Con el CD-ROM
    // virtual es false, y la web lo dice en vez de prometer una sincronización
    // que no va a traer datos.
    sirve: deteccion.sirve,
    mensaje: deteccion.mensaje
  }
}

// --- Marcajes -----------------------------------------------------------------

/**
 * Marcajes del equipo, leyendo los reportes exportados a `data/`.
 * `opts.modo` fuerza el origen: 'real' (default) o 'demo' para la demo.
 */
export async function leerMarcajes(desde, hasta, opts = {}) {
  if (opts.modo === 'demo') {
    const { generarDemo } = await import('./demo.js')
    return generarDemo().filter((m) => enRango(m.fecha, desde, hasta))
  }
  const { marcajes } = leerMarcajesDeArchivos()
  return marcajes.filter((m) => enRango(m.fecha, desde, hasta))
}

/** De dónde salieron los marcajes: útil para que la web lo muestre. */
export async function origenDeMarcajes() {
  return leerMarcajesDeArchivos().detalle
}

/** Lee un archivo puntual (para probar una exportación recién hecha). */
export async function leerArchivoPuntual(ruta) {
  return leerArchivo(ruta).marcajes
}
