import type { jsPDF } from 'jspdf'

export type RGB = [number, number, number]

/** Paleta corporativa del informe. */
export const MARINO: RGB = [11, 37, 69]
export const MARINO_MEDIO: RGB = [54, 88, 141]
export const MARINO_CLARO: RGB = [233, 240, 250]
export const VERDE: RGB = [21, 128, 61]
export const VERDE_CLARO: RGB = [231, 246, 237]
export const AMBAR: RGB = [180, 83, 9]
export const AMBAR_CLARO: RGB = [252, 243, 230]
export const ROJO: RGB = [200, 30, 30]
export const ROJO_CLARO: RGB = [253, 233, 233]
export const GRIS: RGB = [100, 116, 139]
export const GRIS_CLARO: RGB = [220, 226, 234]
export const FONDO: RGB = [248, 250, 252]
export const ORO: RGB = [200, 164, 82]
export const TEAL: RGB = [13, 148, 136]

export function formatoFecha(fecha: string): string {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${Math.round(n * 100) / 100}`
}

export function estadoPuntaje(p: number): { texto: string; color: RGB; fondo: RGB } {
  if (p >= 80) return { texto: 'CUMPLE', color: VERDE, fondo: VERDE_CLARO }
  if (p >= 60) return { texto: 'EN RIESGO', color: AMBAR, fondo: AMBAR_CLARO }
  return { texto: 'NO CUMPLE', color: ROJO, fondo: ROJO_CLARO }
}

export function colorPuntaje(p: number): RGB {
  return estadoPuntaje(p).color
}

/**
 * Barra de progreso con extremos redondeados.
 * `pct` en 0..100. Si se omite el color, se elige según el umbral.
 */
export function barra(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  pct: number,
  color?: RGB,
  track: RGB = GRIS_CLARO
): void {
  const radio = Math.min(h / 2, 2.5)
  doc.setFillColor(...track)
  doc.roundedRect(x, y, w, h, radio, radio, 'F')
  const ancho = Math.max(0, Math.min((w * pct) / 100, w))
  if (ancho > 0) {
    const c: RGB = color ?? colorPuntaje(pct)
    doc.setFillColor(...c)
    doc.roundedRect(x, y, ancho, h, radio, radio, 'F')
  }
}

/** Chip con leyenda en mayúsculas; devuelve el ancho usado. */
export function chip(
  doc: jsPDF,
  texto: string,
  x: number,
  y: number,
  fondo: RGB,
  colorTexto: RGB,
  maxW: number,
  tamaño = 7.4
): number {
  const t = texto.toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(tamaño)
  const textoW = Math.min(doc.getTextWidth(t), Math.max(6, maxW - 12))
  const w = textoW + 11
  const h = tamaño + 5.6
  doc.setFillColor(...fondo)
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F')
  doc.setTextColor(...colorTexto)
  doc.text(t, x + w / 2, y + h / 2 + tamaño * 0.35, { align: 'center', maxWidth: w - 6 })
  return w
}

type EstadoCheck = 'ok' | 'fail' | 'off'
/** Casilla de verificación dibujada (ok → marca ✓, fail → aspa roja, off → vacía). */
export function cajaCheck(doc: jsPDF, x: number, y: number, l: number, estado: EstadoCheck): void {
  doc.setLineWidth(1)
  if (estado === 'ok') {
    doc.setFillColor(...MARINO)
    doc.roundedRect(x, y, l, l, 1.2, 1.2, 'F')
    doc.setDrawColor(255, 255, 255)
    doc.setLineWidth(1.15)
    doc.setLineCap('round')
    doc.line(x + l * 0.22, y + l * 0.52, x + l * 0.42, y + l * 0.7)
    doc.line(x + l * 0.42, y + l * 0.7, x + l * 0.8, y + l * 0.28)
  } else {
    doc.setFillColor(255, 255, 255)
    const borde: RGB = estado === 'fail' ? ROJO : GRIS_CLARO
    doc.setDrawColor(...borde)
    doc.setLineWidth(estado === 'fail' ? 1.15 : 0.9)
    doc.roundedRect(x, y, l, l, 1.2, 1.2, 'FD')
    if (estado === 'fail') {
      doc.setDrawColor(...ROJO)
      doc.setLineCap('round')
      doc.line(x + l * 0.3, y + l * 0.3, x + l * 0.7, y + l * 0.7)
      doc.line(x + l * 0.7, y + l * 0.3, x + l * 0.3, y + l * 0.7)
    }
  }
}

/** Convierte a mayúsculas y dibuja texto con tamaño fijo; devuelve el ancho. */
export function trazoLinea(doc: jsPDF, texto: string, x: number, y: number, maxW: number, size: number, color: RGB): number {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(size)
  doc.setTextColor(...color)
  const t = doc.splitTextToSize(texto, maxW) as string[]
  doc.text(t, x, y)
  return doc.getTextWidth(t[0])
}

/** Rótulo de sección: texto en mayúsculas gris + línea inferior sutil. */
export function rotuloSeccion(doc: jsPDF, texto: string, x: number, y: number, w: number): void {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...GRIS)
  doc.text(texto.toUpperCase(), x, y)
  const tw = doc.getTextWidth(texto.toUpperCase())
  if (tw < w - 16) {
    doc.setDrawColor(...GRIS_CLARO)
    doc.setLineWidth(0.6)
    doc.line(x + tw + 8, y - 2, x + w, y - 2)
  }
}

/** Cuadrito de leyenda + texto. */
export function leyenda(doc: jsPDF, x: number, y: number, color: RGB, texto: string): number {
  doc.setFillColor(...color)
  doc.roundedRect(x, y, 8, 8, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...GRIS)
  doc.text(texto, x + 12, y + 6)
  return x + 12 + doc.getTextWidth(texto)
}