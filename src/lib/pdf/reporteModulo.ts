/**
 * Reporte de un módulo, en PDF (botón «Descargar reporte» del dashboard del módulo).
 *
 * Dos bloques, en el orden en que se piden:
 *
 *   1. REINCIDENCIA EN LA FALTA DE CADA PUNTO de los checklists, agrupada por
 *      ítem: por cada punto, cuántas veces estuvo presente (esperadas), cuántas
 *      cumplió (cumplidas) y cuántas faltó (faltas), con el % de reincidencia.
 *   2. RESULTADO GENERAL POR ÍTEM, con el mismo gráfico de barras horizontales
 *      que el informe de evaluación usa para "Puntaje final por módulo"
 *      (`graficoBarrasModulos`), más la tabla de apoyo.
 *
 * Todo el dato sale de `resumenItemsModulo`, que el dashboard ya calcula para
 * las tarjetas: la reincidencia de un punto es `veces - cumplida`, la misma
 * definición que usa el área polar de `GraficoItem`. No se recalcula nada acá.
 *
 * Monocromo, como el resto de los PDF: negro sobre blanco, sin `·` (jsPDF
 * escribe con las fuentes estándar en WinAnsi y ese carácter sale corrupto).
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ResumenItemModulo } from '../data/indicadores'
import type { Item } from '../types'
import { etiquetaTipo } from '../scoring'
import { formatoFecha } from './graficos'

const MARGEN = 14
const TAMANO_FUENTE = 10

export interface ReporteModuloDatos {
  moduloNombre: string
  /** Fecha inicial del filtro (YYYY-MM-DD) o vacío = sin límite. */
  desde?: string | null
  /** Fecha final del filtro (YYYY-MM-DD) o vacío = hasta hoy. */
  hasta?: string | null
  /** Alcance elegido en los filtros: nombre de la sucursal o "Todas las sucursales". */
  alcance: string
  /** Evaluaciones del rango que aportaron datos al módulo. */
  evaluaciones: number
  /** Salida de `resumenItemsModulo` (mismo arreglo que alimenta las tarjetas). */
  resumen: ResumenItemModulo[]
}

export interface PuntoReincidencia {
  punto: string
  /** Veces que el punto estuvo presente (esperado) en el rango. */
  esperadas: number
  /** De esas, cuántas quedaron cumplidas. */
  cumplidas: number
  /** Veces que NO se cumplió: la reincidencia propiamente dicha. */
  faltas: number
  /** Faltas sobre esperadas, en % (0..100). null si nunca estuvo presente. */
  reincidencia: number | null
}

export interface BloqueReincidencia {
  item: Item
  puntos: PuntoReincidencia[]
  /** Suma del ítem (misma forma que un punto, para reimprimir como fila de cierre). */
  total: PuntoReincidencia
}

const redondear1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Puntos de cada CHECKLIST del módulo, ordenados de más faltas a menos (los que
 * nunca fallaron quedan al final, para que arriba esté lo que hay que atender).
 * Los ítems sin puntos de checklist no aportan bloque.
 */
export function filasReincidencia(resumen: ResumenItemModulo[]): BloqueReincidencia[] {
  return resumen
    .filter((r) => r.opciones && r.opciones.length > 0)
    .map((r) => {
      const puntos: PuntoReincidencia[] = (r.opciones ?? []).map((o) => {
        const faltas = Math.max(0, o.veces - o.cumplida)
        return {
          punto: o.etiqueta,
          esperadas: o.veces,
          cumplidas: o.cumplida,
          faltas,
          reincidencia: o.veces > 0 ? redondear1((faltas / o.veces) * 100) : null
        }
      })
      puntos.sort(
        (a, b) =>
          b.faltas - a.faltas ||
          b.esperadas - a.esperadas ||
          a.punto.localeCompare(b.punto, 'es')
      )
      return { item: r.item, puntos, total: totalizar(r.item, puntos) }
    })
    .filter((bloque) => bloque.puntos.length > 0)
}

function totalizar(item: Item, puntos: PuntoReincidencia[]): PuntoReincidencia {
  const esperadas = puntos.reduce((a, p) => a + p.esperadas, 0)
  const cumplidas = puntos.reduce((a, p) => a + p.cumplidas, 0)
  const faltas = puntos.reduce((a, p) => a + p.faltas, 0)
  return {
    punto: `Total de ${item.texto}`,
    esperadas,
    cumplidas,
    faltas,
    reincidencia: esperadas > 0 ? redondear1((faltas / esperadas) * 100) : null
  }
}

/** Lo que suma el reporte entero: una sola línea de cierre del primer bloque. */
export function totalReincidencia(bloques: BloqueReincidencia[]): PuntoReincidencia {
  const esperadas = bloques.reduce((a, b) => a + b.total.esperadas, 0)
  const cumplidas = bloques.reduce((a, b) => a + b.total.cumplidas, 0)
  const faltas = bloques.reduce((a, b) => a + b.total.faltas, 0)
  return {
    punto: 'Total del módulo',
    esperadas,
    cumplidas,
    faltas,
    reincidencia: esperadas > 0 ? redondear1((faltas / esperadas) * 100) : null
  }
}

const pct = (valor: number | null): string => (valor == null ? '-' : `${fmtNum(valor)}%`)

const fmtNum = (n: number): string => (Number.isInteger(n) ? `${n}` : `${Math.round(n * 100) / 100}`)

export function buildReporteModulo(datos: ReporteModuloDatos): jsPDF {
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

  /** Rótulo de ítem dentro del primer bloque: más chico que un título de sección. */
  const subtitulo = (value: string) => {
    if (y + 16 > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9.5)
    pdf.setTextColor(0, 0, 0)
    const lineas = pdf.splitTextToSize(value, anchoUtil) as string[]
    pdf.text(lineas, MARGEN, y)
    y += lineas.length * 4.4 + 2
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

  /**
   * Mismo gráfico de barras horizontales que "Puntaje final por módulo" del
   * informe de evaluación: etiqueta a la izquierda, eje 0/25/50/75/100 y el %
   * a la derecha de cada barra. Acá lo consume por ítem.
   */
  const graficoBarras = (filas: { nombre: string; puntaje: number | null }[]) => {
    if (!filas.length) return
    const espacioEje = 9
    const espacioPosterior = 6
    const plotX = MARGEN + 82
    const plotWidth = ancho - MARGEN - plotX - 18
    const etiquetaX = MARGEN
    const etiquetaWidth = plotX - etiquetaX - 5

    // Si no entra ni una fila razonable, arranca hoja nueva en vez de aplastar.
    const disponible = () => alto - MARGEN - y - espacioEje - espacioPosterior
    if (disponible() / filas.length < 5) {
      pdf.addPage()
      y = MARGEN
    }

    const altoFila = Math.min(10, Math.max(4, disponible() / filas.length))
    const tamanoFuente = filas.length > 8 ? 7 : 8.5
    const ejeY = y + 4

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(0)
    pdf.setDrawColor(0)
    pdf.setLineWidth(0.2)
    for (const tick of [0, 25, 50, 75, 100]) {
      const tickX = plotX + (plotWidth * tick) / 100
      pdf.line(tickX, ejeY, tickX, ejeY + altoFila * filas.length)
      pdf.text(String(tick), tickX, ejeY - 1, {
        align: tick === 0 ? 'left' : tick === 100 ? 'right' : 'center'
      })
    }

    filas.forEach(({ nombre, puntaje }, index) => {
      const filaY = ejeY + index * altoFila
      const etiquetaLineas = pdf.splitTextToSize(nombre, etiquetaWidth) as string[]
      const lineas =
        etiquetaLineas.length > 2
          ? [etiquetaLineas[0], `${etiquetaLineas[1].slice(0, 24)}...`]
          : etiquetaLineas
      const altoTexto = tamanoFuente * 0.38
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(tamanoFuente)
      pdf.setTextColor(0)
      pdf.text(
        lineas,
        etiquetaX,
        filaY + Math.max(altoTexto, (altoFila - lineas.length * altoTexto) / 2 + altoTexto)
      )

      const barY = filaY + Math.max(0.8, (altoFila - 3.2) / 2)
      const porcentaje = puntaje == null ? null : Math.max(0, Math.min(100, puntaje))
      if (porcentaje !== null && porcentaje > 0) {
        pdf.setFillColor(105, 105, 105)
        pdf.setDrawColor(0)
        pdf.setLineWidth(0.25)
        pdf.rect(plotX, barY, (plotWidth * porcentaje) / 100, 3.2, 'FD')
      }
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(tamanoFuente)
      pdf.text(
        puntaje == null ? '-' : `${fmtNum(puntaje)}%`,
        plotX + plotWidth + 2,
        filaY + Math.max(altoTexto, altoFila / 2 + altoTexto / 3)
      )
    })
    y = ejeY + altoFila * filas.length + 3
  }

  // --- Encabezado -----------------------------------------------------------
  tituloSeccion(`Reporte del módulo: ${datos.moduloNombre}`)

  const periodo =
    datos.desde || datos.hasta
      ? `${datos.desde ? formatoFecha(datos.desde) : 'sin fecha inicial'} a ${
          datos.hasta ? formatoFecha(datos.hasta) : 'hoy'
        }`
      : 'Sin límite de fechas'

  tabla(
    ['Dato', 'Detalle'],
    [
      ['Módulo', datos.moduloNombre],
      ['Período', periodo],
      ['Alcance', datos.alcance],
      [
        'Evaluaciones en el rango',
        datos.evaluaciones ? `${datos.evaluaciones}` : 'Sin evaluaciones con datos'
      ],
      ['Generado', new Date().toLocaleDateString('es')]
    ],
    { columnStyles: { 0: { cellWidth: 52 } } }
  )

  // --- 1) Reincidencia por punto, agrupada por ítem -------------------------
  tituloSeccion('Reincidencia en la falta de cada punto (checklist)')
  textoLinea(
    'Por cada punto: cuántas veces estuvo presente en el rango (esperadas), cuántas cumplió ' +
      '(cumplidas) y cuántas faltó (faltas). La reincidencia es el % de faltas sobre las veces ' +
      'que el punto estuvo presente. Ordenado de más faltas a menos.',
    { size: 8.5, gap: 4 }
  )

  const bloques = filasReincidencia(datos.resumen)
  if (!bloques.length) {
    textoLinea('El modulo no tiene puntos de checklist con respuestas en el rango seleccionado.')
  }

  const COLUMNAS_PUNTOS = ['Punto del checklist', 'Esperadas', 'Cumplidas', 'Faltas', '% reincidencia']
  const ANCHOS_PUNTOS = {
    1: { cellWidth: 18, halign: 'right' as const },
    2: { cellWidth: 18, halign: 'right' as const },
    3: { cellWidth: 16, halign: 'right' as const },
    4: { cellWidth: 30, halign: 'right' as const }
  }

  for (const bloque of bloques) {
    subtitulo(bloque.item.texto)
    tabla(
      COLUMNAS_PUNTOS,
      [
        ...bloque.puntos.map((p) => [
          p.punto,
          `${p.esperadas}`,
          `${p.cumplidas}`,
          `${p.faltas}`,
          pct(p.reincidencia)
        ]),
        [
          `TOTAL ${bloque.item.texto}`,
          `${bloque.total.esperadas}`,
          `${bloque.total.cumplidas}`,
          `${bloque.total.faltas}`,
          pct(bloque.total.reincidencia)
        ]
      ],
      { columnStyles: ANCHOS_PUNTOS }
    )
    y += 2
  }

  const total = totalReincidencia(bloques)
  if (bloques.length) {
    textoLinea(
      `Total del módulo: ${total.faltas} falta(s) de ${total.esperadas} oportunidades (${pct(
        total.reincidencia
      )}) en ${bloques.length} ítem(s) con checklist.`,
      { bold: true, gap: 4 }
    )
  }

  // --- 2) Resultado general por ítem ----------------------------------------
  tituloSeccion('Resultado general por ítem')

  const barras = datos.resumen.map((r) => ({
    nombre: r.item.texto,
    puntaje: r.promedio == null ? null : Math.round(r.promedio * 1000) / 10
  }))
  if (barras.length) {
    graficoBarras(barras)
  } else {
    textoLinea('Sin ítems para graficar.')
  }

  y += 3
  tabla(
    ['Ítem', 'Tipo', 'Peso', 'Muestras', 'Promedio'],
    datos.resumen.map((r) => [
      r.item.texto,
      etiquetaTipo(r.item.tipo),
      r.peso > 0 ? `${r.peso}%` : '-',
      `${r.muestras}`,
      pct(r.promedio == null ? null : Math.round(r.promedio * 1000) / 10)
    ]),
    {
      columnStyles: {
        1: { cellWidth: 34 },
        2: { cellWidth: 16, halign: 'right' },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 26, halign: 'right' }
      }
    }
  )

  textoLinea(
    'Promedio = cumplimiento medio de las respuestas puntuables del ítem en el rango (0 a 100%).',
    { size: 8, gap: 2 }
  )

  // --- Pie: de qué módulo y de qué rango es, en todas las hojas -------------
  const pie = `${datos.moduloNombre} | ${datos.alcance} | ${periodo}`
  for (let hoja = 1; hoja <= pdf.getNumberOfPages(); hoja++) {
    pdf.setPage(hoja)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(130, 140, 150)
    pdf.text(pie, MARGEN, alto - 7)
  }

  return pdf
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function descargarReporteModulo(datos: ReporteModuloDatos): Promise<void> {
  const pdf = buildReporteModulo(datos)
  const nombre = slug(datos.moduloNombre) || 'modulo'
  const sufijo = [datos.desde, datos.hasta].filter(Boolean).join('-') || 'rango'
  pdf.save(`reporte-${nombre}-${sufijo}.pdf`)
}
