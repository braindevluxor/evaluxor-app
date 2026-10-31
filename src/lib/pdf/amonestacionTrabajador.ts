import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cedula } from '../data/colaboradores'
import {
  ESTILO_TABLA,
  MARGEN,
  pintarBanda,
  pintarTextoLinea,
  pintarTituloSeccion,
  type Geometria
} from './composicion'
import { formatoFecha } from './graficos'
import { ponerLogoAlPie, xTextoDelPie } from './marcaPie'

/**
 * AMONESTACIÓN PARA UN TRABAJADOR, EN PDF
 * --------------------------------------
 * Un documento POR PERSONA y no por cargo: el llamado o la amonestación se
 * aplica a quien porta ese cargo en esa tienda, y el papel tiene que decir el
 * nombre de esa persona para que la firma signifique algo.
 *
 * Sólo se genera para AMONESTACIONES (decisión de producto): el llamado de
 * atención queda registrado en la base y se muestra en pantalla, sin
 * documento imprimible por trabajador.
 *
 * El desglose de puntos es el del CARGO en ESA VISITA —el scoring no atribuye
 * puntos sueltos a personas—, con su historia en la unidad: el documento no
 * miente diciendo qué le cayó al trabajador, dice qué le cayó al cargo que
 * ocupa y en qué visita, que es lo que se le está notificando.
 *
 * Composición: la familia de `composicion.ts` (banda, títulos, tabla) y el pie
 * con la marca, igual que el resto de los PDF.
 */
export interface AmonestacionDatos {
  /** La persona a la que se le aplica. */
  trabajador: { nombre: string; nacionalidad: string; dni: number }
  /** El cargo que ocupa en la tienda. */
  cargo: string
  /** Sucursal o departamento donde se midió. */
  unidad: string
  /** Fecha de la evaluación que originó el documento (YYYY-MM-DD). */
  fechaVisita: string
  /** Nota que sacó el cargo en ESA visita. `null` = no se le pudo medir nada. */
  nota: number | null
  /**
   * Los puntos que originan el documento: los del cargo en esa visita, con su
   * historia en la unidad (`puntosFalladosDeCargo`). Vacío = el nivel salió de
   * la nota y no de un desglose concreto.
   */
  puntos: { item: string; check: string | null; faltas: number; reincidencias: number; esReincidente: boolean }[]
}

export function buildAmonestacion(datos: AmonestacionDatos): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false })
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - MARGEN * 2
  let y = MARGEN

  const geo = (): Geometria => ({ y, anchoUtil, ancho, alto })

  const textoLinea = (value: string, opciones: { bold?: boolean; size?: number; gap?: number; color?: [number, number, number] } = {}) => {
    y = pintarTextoLinea(pdf, value, geo(), opciones)
  }
  const tituloSeccion = (value: string) => {
    y = pintarTituloSeccion(pdf, value, geo())
  }

  const hoy = new Date().toLocaleDateString('es')
  const visita = new Date(`${datos.fechaVisita}T12:00:00`).toLocaleDateString('es')

  // --- Banda -----------------------------------------------------------------
  y = pintarBanda(pdf, 'Amonestación', `${datos.trabajador.nombre} · C.I. ${cedula(datos.trabajador)}`, geo())

  // --- Datos -----------------------------------------------------------------
  tituloSeccion('Datos')
  autoTable(pdf, {
    ...ESTILO_TABLA,
    head: [['Dato', 'Detalle']],
    body: [
      ['Trabajador', datos.trabajador.nombre],
      ['Cédula', cedula(datos.trabajador)],
      ['Cargo', datos.cargo],
      ['Unidad', datos.unidad],
      ['Visita del', formatoFecha(datos.fechaVisita)],
      ['Nota del cargo en la visita', datos.nota == null ? 'Sin nota' : `${datos.nota}%`],
      ['Emitido el', hoy]
    ],
    startY: y,
    margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
    columnStyles: { 0: { cellWidth: 58 } }
  })
  y = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
  y += 4

  // --- Puntos ----------------------------------------------------------------
  tituloSeccion('Puntos que originan esta amonestación')
  if (!datos.puntos.length) {
    textoLinea(
      'La nota del cargo en esta visita quedó por debajo del umbral sin un desglose de puntos atribuible: el documento se emite por ese resultado.',
      { color: [100, 116, 139] }
    )
  } else {
    autoTable(pdf, {
      ...ESTILO_TABLA,
      head: [['Punto del cargo', 'Faltas en la unidad', 'Reincidencia']],
      body: datos.puntos.map((p) => [
        p.check ? p.check : `${p.item} (ítem completo)`,
        { content: `${p.faltas}`, styles: { halign: 'right' as const } },
        p.esReincidente ? 'Sí' : 'No'
      ]),
      startY: y,
      margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
      columnStyles: { 1: { cellWidth: 34, halign: 'right' }, 2: { cellWidth: 26, halign: 'center' } }
    })
    y = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    y += 4
    const reincidencias = datos.puntos.filter((p) => p.esReincidente).length
    // Copia estable y corta: sin conjugaciones que cambien con el número (un
    // texto que depende de «1 punto / 2 puntos» obliga a dos frases distintas).
    textoLinea(
      reincidencias
        ? `${reincidencias} de ${datos.puntos.length} con reincidencia en la evaluación inmediata anterior.`
        : 'Sin reincidencias en la evaluación inmediata anterior.',
      { size: 9, gap: 4, color: [100, 116, 139] }
    )
  }

  // --- Constancia ------------------------------------------------------------
  tituloSeccion('Constancia')
  textoLinea(
    `Se deja constancia de que ${datos.trabajador.nombre}, ${cedula(datos.trabajador)}, en su calidad de ${datos.cargo} de ${datos.unidad}, ` +
      `fue notificado(a) de la amonestación derivada del resultado de la evaluación realizada el ${visita}, en la que el cargo obtuvo ` +
      `${datos.nota == null ? 'una nota inferior al umbral' : `${datos.nota}%`} y registró los puntos detallados en este documento.`,
    { gap: 6 }
  )
  textoLinea(
    'Se recuerda que los puntos no cumplidos se revisan en la siguiente evaluación, donde los que vuelvan a caer se contabilizan como reincidencias.',
    { size: 9, gap: 10, color: [100, 116, 139] }
  )

  // --- Firmas ----------------------------------------------------------------
  const anchoCampo = (anchoUtil - 14) / 2
  const segundaColumna = MARGEN + anchoCampo + 14
  const firma = (etiqueta: string, x: number, lineaY: number) => {
    pdf.setDrawColor(100, 116, 139)
    pdf.setLineWidth(0.25)
    pdf.line(x, lineaY, x + anchoCampo, lineaY)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(45, 52, 64)
    pdf.text(etiqueta, x, lineaY + 5)
  }
  if (y + 30 > alto - MARGEN) {
    pdf.addPage()
    y = MARGEN
  }
  firma('Trabajador(a)', MARGEN, y + 18)
  firma('Responsable', segundaColumna, y + 18)

  // --- Pie -------------------------------------------------------------------
  const pie = `${datos.unidad} | Amonestación | ${datos.trabajador.nombre}`
  for (let hoja = 1; hoja <= pdf.getNumberOfPages(); hoja++) {
    pdf.setPage(hoja)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(130, 140, 150)
    ponerLogoAlPie(pdf, MARGEN, alto - 7)
    pdf.text(pie, xTextoDelPie(MARGEN), alto - 7)
  }

  return pdf
}

/** Genera y descarga el PDF de una amonestación, con el nombre de la persona. */
export function descargarAmonestacion(datos: AmonestacionDatos): void {
  const pdf = buildAmonestacion(datos)
  const dni = `${datos.trabajador.nacionalidad || 'V'}${datos.trabajador.dni}`
  pdf.save(`amonestacion-${dni}-${datos.fechaVisita}.pdf`)
}
