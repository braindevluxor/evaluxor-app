/**
 * Composición compartida de los reportes en PDF: la familia visual del papel.
 *
 * Hay tres builders (informe completo, explicación de módulo y reporte por
 * cargos) porque son tres documentos distintos, pero se leen juntos y tienen
 * que verse de la misma casa: banda de marca arriba, títulos en marino con
 * regla suave, y tablas con cabecera coloreada y filas alternadas en vez de la
 * rejilla negra de contabilidad. Lo que define esa familia vive acá; allá sólo
 * queda el contenido y los detalles propios de cada documento (el paladar de
 * firma del informe, la pastilla de cifras del reporte por cargos).
 *
 * Cambiar el estilo de una tabla = cambiar `ESTILO_TABLA` y las tres salen
 * iguales. Los colores NO se inventan: salen de `graficos.ts`, la misma paleta
 * con la que el resto de los PDF pinta puntajes y rótulos.
 *
 * Sin `·` ni otros caracteres que jsPDF no escribe bien con las fuentes WinAnsi.
 */
import type { jsPDF } from 'jspdf'
import type { UserOptions } from 'jspdf-autotable'
import { FONDO, GRIS_CLARO, MARINO, MARINO_CLARO, type RGB } from './graficos'

/** Margen de todos los reportes, en mm. */
export const MARGEN = 14

/** Tamaño base de la tipografía, en pt. */
export const TAMANO_FUENTE = 10

/** Tinta de los textos: el negro puro vibra contra las cabeceras coloreadas. */
export const TINTA: RGB = [45, 52, 64]

/** Blanco de la tipografía sobre marino. */
export const BLANCO: RGB = [255, 255, 255]

/**
 * Dónde va a parar lo que se pinta: la posición de cursor del documento más el
 * ancho útil y el alto de la hoja. Se pasa y se devuelve en cada `pintar*` para
 * que el cursor siga siendo un `let` del builder de cada informe.
 */
export interface Geometria {
  y: number
  anchoUtil: number
  ancho: number
  alto: number
}

/**
 * Estilo de TODA tabla de los reportes: cabecera en marino con texto blanco,
 * filas alternadas en gris muy claro y separadores de 0,1 mm.
 *
 * Va como objeto para hacerle spread a cada `autoTable`: las columnas, las
 * celdas con `colSpan` y el pie son de cada documento, la familia visual es una
 * sola. `footStyles` sólo se ve cuando la tabla trae fila de total.
 */
export const ESTILO_TABLA: Partial<UserOptions> = {
  theme: 'striped',
  styles: {
    font: 'helvetica',
    fontSize: 9.5,
    cellPadding: [2, 3],
    textColor: TINTA,
    lineColor: GRIS_CLARO,
    lineWidth: 0.1,
    overflow: 'linebreak',
    valign: 'top'
  },
  headStyles: {
    fontStyle: 'bold',
    fillColor: MARINO,
    textColor: BLANCO,
    fontSize: 8.5,
    lineColor: MARINO,
    lineWidth: 0
  },
  footStyles: {
    fontStyle: 'bold',
    fillColor: MARINO_CLARO,
    textColor: MARINO,
    fontSize: 8.5,
    lineColor: MARINO,
    lineWidth: 0
  },
  bodyStyles: { fillColor: BLANCO },
  alternateRowStyles: { fillColor: FONDO },
  rowPageBreak: 'avoid',
  showHead: 'everyPage'
}

/**
 * Banda de marca con la que arranca un documento: el título en blanco sobre
 * marino y, debajo, el dato que hace falta para saber qué se está leyendo
 * (unidad y fecha, el nombre del módulo).
 *
 * Es para títulos cortos: va en una sola línea y sin salto de hoja, que es
 * como son los de los tres reportes. Si un día hace falta una banda larga, es
 * acá donde hay que darle el salto y no en cada builder.
 */
export function pintarBanda(pdf: jsPDF, titulo: string, subtitulo: string | null, geo: Geometria): number {
  const altoBanda = 21
  const y = geo.y > MARGEN + 1 ? geo.y + 3 : geo.y
  pdf.setFillColor(...MARINO)
  pdf.roundedRect(MARGEN, y, geo.anchoUtil, altoBanda, 2.5, 2.5, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor(...BLANCO)
  pdf.text((pdf.splitTextToSize(titulo, geo.anchoUtil - 12) as string[])[0], MARGEN + 6, y + 9.5)
  if (subtitulo) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(...MARINO_CLARO)
    pdf.text((pdf.splitTextToSize(subtitulo, geo.anchoUtil - 12) as string[])[0], MARGEN + 6, y + 15.5)
  }
  return y + altoBanda + 7
}

/**
 * Título de sección: marino en bold con una regla suave debajo, en lugar del
 * negro y el renglón de 0,25 que cruzaba la hoja entera.
 *
 * Deja un poco de aire arriba sólo si no es lo primero de la hoja: así el
 * primer título de cada documento queda pegado al margen.
 */
export function pintarTituloSeccion(pdf: jsPDF, value: string, geo: Geometria): number {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11.5)
  pdf.setTextColor(...MARINO)
  const lineas = pdf.splitTextToSize(value, geo.anchoUtil) as string[]
  const altoLinea = 5.6
  const separacionLinea = 8
  const espacioAnterior = geo.y > MARGEN + 1 ? 3 : 0
  const espacioPosterior = 8
  const desplazamientoLinea = Math.max(0, lineas.length - 1) * altoLinea + separacionLinea
  if (geo.y + espacioAnterior + desplazamientoLinea + espacioPosterior > geo.alto - MARGEN) {
    pdf.addPage()
    geo.y = MARGEN
  }
  geo.y += espacioAnterior
  lineas.forEach((linea, index) => pdf.text(linea, MARGEN, geo.y + index * altoLinea))
  pdf.setDrawColor(...GRIS_CLARO)
  pdf.setLineWidth(0.6)
  const posicionLinea = geo.y + desplazamientoLinea
  pdf.line(MARGEN, posicionLinea, geo.ancho, posicionLinea)
  return posicionLinea + espacioPosterior
}

/** Un renglón de texto corriente, con salto de hoja automático. */
export function pintarTextoLinea(
  pdf: jsPDF,
  value: string,
  geo: Geometria,
  opciones: { bold?: boolean; size?: number; gap?: number; color?: RGB } = {}
): number {
  const size = opciones.size ?? TAMANO_FUENTE
  pdf.setFont('helvetica', opciones.bold ? 'bold' : 'normal')
  pdf.setFontSize(size)
  pdf.setTextColor(...(opciones.color ?? TINTA))
  const lineas = pdf.splitTextToSize(value, geo.anchoUtil) as string[]
  const altoLinea = size * 0.42
  let y = geo.y
  if (y + lineas.length * altoLinea > geo.alto - MARGEN) {
    pdf.addPage()
    y = MARGEN
  }
  pdf.text(lineas, MARGEN, y)
  return y + lineas.length * altoLinea + (opciones.gap ?? 2)
}
