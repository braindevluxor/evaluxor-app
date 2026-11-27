import type { jsPDF } from 'jspdf'
import logoPie from '../../assets/logo-pie.png?inline'

/**
 * Marca al pie de las hojas de los reportes.
 *
 * El logo entra al bundle como data URL (`?inline`) y no se descarga en el
 * momento: `buildPdfDocument` es síncrono y no hay dónde esperar una petición
 * dentro suyo. Así el pie sale igual sin conexión, que es la condición normal
 * del trabajo de campo.
 */

/** Ancho del logo en el papel, en mm. Moderado: identifica sin competir. */
export const ANCHO_LOGO_PIE = 26

/** El logo como data URL, para los reportes que se pintan en HTML antes de volcarse al PDF. */
export { logoPie }

/** Proporción del archivo recortado a su contenido (400 x 129). */
const PROPORCION_LOGO_PIE = 400 / 129

/** Alto derivado del ancho: la marca nunca se deforma. */
export const ALTO_LOGO_PIE = ANCHO_LOGO_PIE / PROPORCION_LOGO_PIE

/** Hueco entre la marca y el texto del pie. */
const HUECO_LOGO_PIE = 3

/** Columna donde arranca el texto del pie, dejando la marca alineada a la izquierda. */
export const xTextoDelPie = (margen: number): number => margen + ANCHO_LOGO_PIE + HUECO_LOGO_PIE

/**
 * Dibuja la marca a la izquierda de la banda de pie, centrada sobre la misma
 * línea en la que va el texto.
 *
 * @param yLinea línea de base donde cae el texto del pie.
 */
export function ponerLogoAlPie(pdf: jsPDF, x: number, yLinea: number): void {
  // El texto de 7pt se apoya en la base, así que su centro óptico está medio
  // alto de mayúscula por encima (~0,9mm). Centrar la marca ahí deja las dos
  // cosas a la misma altura en vez de con el logo colgando.
  const centro = yLinea - 0.9
  pdf.addImage(logoPie, 'PNG', x, centro - ALTO_LOGO_PIE / 2, ANCHO_LOGO_PIE, ALTO_LOGO_PIE)
}
