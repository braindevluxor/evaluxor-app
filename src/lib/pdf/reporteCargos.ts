/**
 * Reporte POR CARGOS de una evaluación, en PDF.
 *
 * Responde a «quiero ver, para los cargos que yo elija, todos sus pendientes»:
 * un bloque por cargo seleccionado con los ítems en los que quedó mal, los
 * checks concretos que fallaron y cuántos puntos le costaron. Es el mismo
 * detalle que abre el modal «Fallas de…» del detalle de la evaluación, pero
 * impreso y con varios cargos juntos, para llevarlo a una reunión o dejarlo
 * como constancia.
 *
 * El dato NO se recalcula acá: el detalle pasa las fallas ya resueltas con
 * `fallasDeResponsable` (el mismo cálculo que pinta el modal y que reparte los
 * puntos igual que la tarjeta de porcentaje). Este archivo sólo compone el
 * documento.
 *
 * Monocromo, como el resto de los PDF del proyecto: negro sobre blanco, y sin
 * `·` ni otros caracteres que jsPDF no escribe bien con las fuentes WinAnsi.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { etiquetaTipo } from '../scoring'
import { formatoFecha } from './graficos'
import { ponerLogoAlPie, xTextoDelPie } from './marcaPie'

const MARGEN = 14
const TAMANO_FUENTE = 10

/** Un ítem que le salió mal a un cargo, tal como lo muestra el modal del detalle. */
export interface PendienteCargo {
  /** Ítem del que se descontó. */
  item: string
  /** Módulo al que pertenece el ítem; null si no se pudo resolver. */
  modulo: string | null
  /** Tipo de ítem (`CHECKLIST`, `CUMPLE_NO_CUMPLE`, …) para ubicar el origen. */
  tipo: string
  /** Puntos que este cargo tenía en el ítem y no logró. */
  perdidos: number
  /** Checks concretos que fallaron y se le atribuyen. Vacío si el ítem no es de checks. */
  checks: string[]
}

/** Un cargo del reporte, con lo que se le descontó. */
export interface CargoReporte {
  /** Nombre del cargo tal como aparece en la evaluación. */
  cargo: string
  /** Porcentaje logrado del cargo (0..100), o null si nunca se le midió nada. */
  porciento: number | null
  /** Suma de `perdidos` de sus pendientes. */
  perdidos: number
  /** Los ítems en los que quedó mal, del que más puntos costó al que menos. */
  pendientes: PendienteCargo[]
}

export interface ReporteCargosDatos {
  /** Nombre de la sucursal o departamento evaluado. */
  unidad: string
  /** Código o número de tienda, si lo hay. */
  referencia?: string | null
  /** Fecha de la evaluación (YYYY-MM-DD). */
  fecha: string
  /** Puntaje general de la evaluación (0..100), si ya está cerrada. */
  puntajeGeneral: number | null
  /** Los cargos elegidos para el reporte, en el orden en que se van a imprimir. */
  cargos: CargoReporte[]
}

const redondear2 = (n: number): number => Math.round(n * 100) / 100

const fmt = (n: number): string => (Number.isInteger(n) ? `${n}` : `${redondear2(n)}`)

const pct = (valor: number | null): string => (valor == null ? '-' : `${valor}%`)

export function buildReporteCargos(datos: ReporteCargosDatos): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false })
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - MARGEN * 2
  let y = MARGEN

  const textoLinea = (
    value: string,
    options: { bold?: boolean; size?: number; gap?: number } = {}
  ) => {
    const size = options.size ?? TAMANO_FUENTE
    pdf.setFont('helvetica', options.bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    pdf.setTextColor(0, 0, 0)
    const lineas = pdf.splitTextToSize(value, anchoUtil) as string[]
    const altoLinea = size * 0.42
    if (y + lineas.length * altoLinea > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    pdf.text(lineas, MARGEN, y)
    y += lineas.length * altoLinea + (options.gap ?? 2)
  }

  const tituloSeccion = (value: string) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(TAMANO_FUENTE)
    pdf.setTextColor(0, 0, 0)
    const lineas = pdf.splitTextToSize(value, anchoUtil) as string[]
    const altoLinea = 5.2
    const separacionLinea = 8
    const espacioPosterior = 8
    const desplazamientoLinea = Math.max(0, lineas.length - 1) * altoLinea + separacionLinea
    if (y + desplazamientoLinea + espacioPosterior > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    lineas.forEach((linea, index) => pdf.text(linea, MARGEN, y + index * altoLinea))
    pdf.setDrawColor(0)
    pdf.setLineWidth(0.25)
    const posicionLinea = y + desplazamientoLinea
    pdf.line(MARGEN, posicionLinea, ancho - MARGEN, posicionLinea)
    y = posicionLinea + espacioPosterior
  }

  /** Rótulo de un cargo: encabezado del bloque, más chico que un título de sección. */
  const subtitulo = (value: string, detalle: string) => {
    if (y + 16 > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10.5)
    pdf.setTextColor(0, 0, 0)
    const lineas = pdf.splitTextToSize(value, anchoUtil) as string[]
    pdf.text(lineas, MARGEN, y)
    y += lineas.length * 4.8
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor(90, 90, 90)
    const resumen = pdf.splitTextToSize(detalle, anchoUtil) as string[]
    pdf.text(resumen, MARGEN, y)
    y += resumen.length * 3.8 + 2
  }

  type Celda = string | { content: string; colSpan?: number; styles?: Record<string, unknown> }

  const tabla = (
    headers: string[],
    rows: Celda[][],
    opciones?: { columnStyles?: Record<number, { cellWidth?: number; halign?: 'left' | 'center' | 'right' }> }
  ) => {
    if (!rows.length) return
    autoTable(pdf, {
      head: [headers],
      body: rows,
      startY: y,
      margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: TAMANO_FUENTE,
        cellPadding: 1.4,
        textColor: 0,
        lineColor: 0,
        lineWidth: 0.2,
        overflow: 'linebreak',
        valign: 'top'
      },
      headStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], textColor: 0 },
      bodyStyles: { fillColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles: opciones?.columnStyles ?? {},
      rowPageBreak: 'avoid',
      showHead: 'everyPage'
    })
    y = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    y += 3
  }

  // --- Encabezado -----------------------------------------------------------
  tituloSeccion('Reporte por cargos: pendientes')

  const referencia = datos.referencia?.trim()
  tabla(
    ['Dato', 'Detalle'],
    [
      ['Unidad evaluada', datos.unidad],
      ...(referencia ? [['Referencia', referencia]] : []),
      ['Fecha de evaluación', formatoFecha(datos.fecha)],
      [
        'Puntaje general',
        datos.puntajeGeneral == null ? 'Sin puntaje (evaluación abierta)' : `${fmt(datos.puntajeGeneral)}%`
      ],
      ['Cargos en el reporte', `${datos.cargos.length}`],
      ['Generado', new Date().toLocaleDateString('es')]
    ],
    { columnStyles: { 0: { cellWidth: 52 } } }
  )

  if (!datos.cargos.length) {
    textoLinea('No se seleccionó ningún cargo.')
    return conPie(pdf, alto)
  }

  // --- Resumen por cargo ----------------------------------------------------
  tituloSeccion('Resumen por cargo')
  tabla(
    ['Cargo', 'Nota', 'Ítems con pendientes', 'Puntos no cumplidos'],
    datos.cargos.map((cargo) => [
      cargo.cargo,
      { content: pct(cargo.porciento), styles: { halign: 'right' } },
      { content: `${cargo.pendientes.length}`, styles: { halign: 'right' } },
      { content: fmt(cargo.perdidos), styles: { halign: 'right' } }
    ]),
    {
      columnStyles: {
        1: { cellWidth: 20, halign: 'right' },
        2: { cellWidth: 36, halign: 'right' },
        3: { cellWidth: 34, halign: 'right' }
      }
    }
  )
  textoLinea(
    'La nota del cargo es logrado sobre lo posible, con los mismos pesos que el resto de la app. ' +
      'Los puntos no cumplidos son los que se le descontaron por los ítems de cada bloque.',
    { size: 8, gap: 4 }
  )

  // --- Un bloque por cargo --------------------------------------------------
  for (const cargo of datos.cargos) {
    tituloSeccion(`Cargo: ${cargo.cargo}`)
    textoLinea(
      `Nota del cargo: ${pct(cargo.porciento)}  |  Puntos no cumplidos: ${fmt(
        cargo.perdidos
      )}  |  Ítems con pendientes: ${cargo.pendientes.length}`,
      { size: 9, gap: 4 }
    )

    if (!cargo.pendientes.length) {
      textoLinea('Este cargo no tiene ítems con pendientes en esta evaluación.')
      continue
    }

    for (const pendiente of cargo.pendientes) {
      // El ítem va como subtítulo y los checks (o el tipo, si no es de checks)
      // en la tabla: decir sólo «Checklist de higiene» no explica nada, los
      // checks concretos sí, y son la razón de ser de este reporte.
      subtitulo(pendiente.item, `${pendiente.modulo ?? 'Sin módulo'} | ${etiquetaTipo(pendiente.tipo)}`)

      if (pendiente.checks.length) {
        tabla(
          ['Punto del checklist sin cumplir', 'Puntos'],
          [
            ...pendiente.checks.map((check) => [check, { content: '', styles: {} }]),
            [
              { content: `TOTAL de «${pendiente.item}»`, styles: { fontStyle: 'bold' } },
              { content: fmt(pendiente.perdidos), styles: { fontStyle: 'bold', halign: 'right' } }
            ]
          ],
          { columnStyles: { 1: { cellWidth: 22, halign: 'right' } } }
        )
      } else {
        // Ítems binarios y de plano: el ítem entero es la falla. Se imprime una
        // sola fila con los puntos, sin repetir «el ítem falló», que sería
        // tautológico.
        tabla(
          ['Falla', 'Puntos'],
          [
            [
              { content: `Ítem completo (${etiquetaTipo(pendiente.tipo)})`, styles: {} },
              { content: fmt(pendiente.perdidos), styles: { halign: 'right' } }
            ]
          ],
          { columnStyles: { 1: { cellWidth: 22, halign: 'right' } } }
        )
      }
    }
  }

  return conPie(pdf, alto)

  /**
   * Marca y texto al pie de todas las hojas. Se hace al final porque recién
   * entonces se sabe cuántas páginas tiene el documento.
   */
  function conPie(documento: jsPDF, altoHoja: number): jsPDF {
    const etiquetaCargos = datos.cargos.length === 1 ? '1 cargo' : `${datos.cargos.length} cargos`
    const pie = `${datos.unidad} | ${formatoFecha(datos.fecha)} | Reporte por cargos | ${etiquetaCargos}`
    for (let hoja = 1; hoja <= documento.getNumberOfPages(); hoja++) {
      documento.setPage(hoja)
      documento.setFont('helvetica', 'normal')
      documento.setFontSize(7)
      documento.setTextColor(130, 140, 150)
      ponerLogoAlPie(documento, MARGEN, altoHoja - 7)
      documento.text(pie, xTextoDelPie(MARGEN), altoHoja - 7)
    }
    return documento
  }
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function descargarReporteCargos(datos: ReporteCargosDatos): void {
  const pdf = buildReporteCargos(datos)
  const unidad = slug(datos.unidad) || 'evaluacion'
  pdf.save(`pendientes-por-cargo-${unidad}-${datos.fecha}.pdf`)
}
