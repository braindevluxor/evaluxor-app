import type { jsPDF } from 'jspdf'
import type { RGB } from './graficos'
import { fmt, GRIS, GRIS_CLARO, MARINO } from './graficos'

/**
 * Controla el flujo vertical del documento: cursor `y`, márgenes, encabezado
 * de páginas interiores y pie de página numerado.
 */
export class Lienzo {
  readonly doc: jsPDF
  readonly W: number
  readonly H: number
  /** Margen izquierdo del contenido (3 cm ≈ 85 pt). */
  readonly M = 85
  /** Margen derecho del contenido (2 cm ≈ 57 pt). */
  readonly MD = 57
  readonly tw: number
  y = 0

  constructor(doc: jsPDF) {
    this.doc = doc
    this.W = doc.internal.pageSize.getWidth()
    this.H = doc.internal.pageSize.getHeight()
    this.tw = this.W - this.M - this.MD
    // jsPDF ya crea la primera página: se la encabeza y se posiciona el cursor.
    this.encabezado()
    this.y = 85
  }

  private encabezado(): void {
    const doc = this.doc
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...MARINO)
    doc.text('EvaLuxor · Evaluación 360°', this.M, 32)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRIS)
    doc.text(String(this.doc.getNumberOfPages()), this.W - this.MD, 32, { align: 'right' })
    doc.setDrawColor(...GRIS_CLARO)
    doc.setLineWidth(0.6)
    doc.line(this.M, 38, this.W - this.MD, 38)
  }

  /** Última línea dibujable antes del margen inferior (2 cm). */
  get limite(): number {
    return this.H - 58
  }

  /** Salta de página si el bloque (alto) no cabe. */
  asegurar(alto: number): void {
    if (this.y + alto > this.limite) this.nuevaPagina()
  }

  nuevaPagina(): void {
    this.doc.addPage()
    this.encabezado()
    this.y = 85
  }

  /** Pie de página con línea y metadato, para todas las páginas (llamar al final). */
  pie(meta: string): void {
    const total = this.doc.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i)
      const ph = this.doc.internal.pageSize.getHeight()
      this.doc.setDrawColor(...GRIS_CLARO)
      this.doc.setLineWidth(0.6)
      this.doc.line(this.M, ph - 20, this.W - this.MD, ph - 20)
      this.doc.setFont('helvetica', 'normal')
      this.doc.setFontSize(8.5)
      this.doc.setTextColor(...GRIS)
      this.doc.text(meta, this.M, ph - 13.5)
    }
  }

  /** Tarjeta de encabezado de módulo con puntaje y barra. */
  tarjetaModulo(nombre: string, detalle: string, pct: number | null, colorBarra: RGB): void {
    const doc = this.doc
    this.asegurar(40)
    const alto = 38
    const x = this.M
    const w = this.tw

    doc.setFillColor(...MARINO)
    doc.roundedRect(x, this.y, w, alto, 4, 4, 'F')
    doc.setFillColor(...colorBarra)
    doc.roundedRect(x, this.y + 4, 3, alto - 8, 1.5, 1.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(255, 255, 255)
    doc.text(nombre, x + 14, this.y + 15)

    const pctTxt = pct != null ? `${fmt(pct)}%` : 'Sin datos'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(238, 244, 251)
    doc.text(pctTxt, x + w - 14, this.y + 15, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(173, 194, 227)
    doc.text(detalle, x + 14, this.y + 27)

    if (pct != null) {
      doc.setFillColor(255, 255, 255)
      doc.roundedRect(x + 14, this.y + 31, w - 28, 3.6, 1.8, 1.8, 'F')
      const bw = Math.max(0, Math.min((w - 28) * (pct / 100), w - 28))
      if (bw > 0) {
        doc.setFillColor(...colorBarra)
        doc.roundedRect(x + 14, this.y + 31, bw, 3.6, 1.8, 1.8, 'F')
      }
    }
    this.y += alto + 10
  }
}