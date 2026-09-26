import type { jsPDF } from 'jspdf'
import type { Lienzo } from './lienzo'
import {
  AMBAR,
  AMBAR_CLARO,
  GRIS,
  GRIS_CLARO,
  MARINO,
  ROJO,
  ROJO_CLARO,
  TEAL,
  VERDE,
  VERDE_CLARO,
  barra,
  cajaCheck,
  chip,
  fmt,
  type RGB
} from './graficos'
import type { Item, Opcion } from '../types'
import {
  colaboradorCumple,
  conciliacionPorcentaje,
  etiquetaTipo,
  formatearLastSync,
  formatearPrecioBase,
  opcionCumplida,
  unidadCumple,
  type ValorChecklist,
  type ValorConciliacion,
  type ValorCumple,
  type ValorListaColaboradores,
  type ValorUnidadChecklist
} from '../scoring'

const PAD = 8
const PADT = 7
const CHIP_COL = 78

function lineas(doc: jsPDF, texto: string, w: number): string[] {
  return (doc.splitTextToSize(texto, Math.max(10, w)) as string[]) ?? []
}

interface ChipTxt {
  texto: string
  fondo: RGB
  color: RGB
}

/** Cabecera de tarjeta: pregunta en negrita + chips apilados a la derecha. */
function cabecera(li: Lienzo, x0: number, y0: number, w: number, item: Item, chips: ChipTxt[]): number {
  const doc = li.doc
  const qW = w - PAD * 2 - (chips.length ? CHIP_COL : 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...MARINO)
  const q = lineas(doc, item.texto, qW)
  q.forEach((ln, i) => doc.text(ln, x0 + PAD, y0 + PADT + 7 + i * 11))

  let yc = y0 + PADT + 2
  for (const c of chips) {
    chip(doc, c.texto, x0 + w - PAD - CHIP_COL, yc, c.fondo, c.color, CHIP_COL - 5)
    yc += 14
  }
  return PADT * 2 + Math.max(17, q.length * 11 + 4)
}

/** Marco blanco con borde sutil y acento de color a la izquierda. */
function marco(li: Lienzo, x0: number, y0: number, w: number, h: number, acento?: RGB): void {
  const doc = li.doc
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...GRIS_CLARO)
  doc.setLineWidth(0.5)
  doc.roundedRect(x0, y0, w, h, 4, 4, 'FD')
  if (acento) {
    doc.setFillColor(...acento)
    doc.roundedRect(x0, y0 + 2, 2.8, h - 4, 1.4, 1.4, 'F')
  }
}

function divisor(li: Lienzo, x0: number, y0: number, w: number): void {
  const doc = li.doc
  doc.setDrawColor(...GRIS_CLARO)
  doc.setLineWidth(0.6)
  doc.line(x0 + PAD, y0, x0 + w - PAD, y0)
}

/** Metadatos del ítem (tipo, peso, responsables) como línea final de la tarjeta. */
function meta(li: Lienzo, x0: number, y0: number, w: number, item: Item): void {
  const partes: string[] = [etiquetaTipo(item.tipo).toUpperCase()]
  if (typeof item.puntaje === 'number' && item.puntaje > 0) partes.push(`Peso ${fmt(item.puntaje)}`)
  if (item.responsables?.length) partes.push(`Responsable: ${item.responsables.join(', ')}`)
  if (!partes.length) return
  const doc = li.doc
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GRIS)
  doc.text(partes.join('  ·  '), x0 + w - PAD, y0, { align: 'right' })
}

/** Metadatos de progreso para el pie de lista de una tarjeta. */
function resumenCuadro(li: Lienzo, x0: number, y0: number, w: number, texto: string, pct: number): void {
  const doc = li.doc
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.3)
  doc.setTextColor(...MARINO)
  doc.text(texto, x0 + PAD, y0 + 4)
  const ancho = w - PAD * 2
  doc.setFillColor(...GRIS_CLARO)
  doc.roundedRect(x0 + PAD, y0 + 9, ancho, 4.6, 2.3, 2.3, 'F')
  const bw = Math.max(0, Math.min((ancho * pct) / 100, ancho))
  if (bw > 0) {
    doc.setFillColor(...(pct >= 80 ? VERDE : pct >= 60 ? AMBAR : ROJO))
    doc.roundedRect(x0 + PAD, y0 + 9, bw, 4.6, 2.3, 2.3, 'F')
  }
}

// ---------------------------------------------------------------------------
// CUMPLE / NO CUMPLE
// ---------------------------------------------------------------------------
export function renderCumple(li: Lienzo, item: Item, valor: unknown): number {
  const doc = li.doc
  const v = valor as ValorCumple | null
  const evs = v?.evidencias ?? []
  const informativo = !!v?.informativo
  const resp = typeof v?.value === 'boolean' ? v.value : null

  const estado: ChipTxt =
    resp === null
      ? { texto: 'SIN RESPONDER', fondo: GRIS_CLARO, color: GRIS }
      : resp
        ? { texto: 'CUMPLE', fondo: VERDE_CLARO, color: VERDE }
        : { texto: 'NO CUMPLE', fondo: ROJO_CLARO, color: ROJO }

  const comentarios = evs.map((e) => e.comentario.trim()).filter(Boolean)
  const nFotos = evs.reduce((a, e) => a + e.photoIds.length, 0)

  const x0 = li.M
  const w = li.tw
  const qW = w - PAD * 2 - CHIP_COL
  const nQ = lineas(doc, item.texto, qW).length
  const alCuerpo = PADT * 2 + Math.max(17, nQ * 11 + 4)
  const nComments = comentarios.reduce((a, c) => a + lineas(doc, c, w - PAD * 2).length, 0)
  const alBody = (informativo ? 17 : 0) + nComments * 11 + (nFotos > 0 ? 12 : !informativo && !comentarios.length ? 11 : 0)
  const h = alCuerpo + 8 + alBody + 6

  li.asegurar(h + 9)
  const y0 = li.y
  marco(li, x0, y0, w, h, estado.color)
  cabecera(li, x0, y0, w, item, [estado])

  let yy = y0 + alCuerpo
  divisor(li, x0, yy, w)
  yy += 6
  if (informativo) {
    chip(doc, 'Informativo', x0 + PAD, yy - 1, AMBAR_CLARO, AMBAR, w - PAD * 2, 7.2)
    yy += 17
  }
  for (const c of comentarios) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(...GRIS)
    for (const ln of lineas(doc, c, w - PAD * 2)) {
      doc.text(ln, x0 + PAD, yy + 4)
      yy += 11
    }
  }
  if (nFotos > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...TEAL)
    doc.text(`${nFotos} foto(s) adjunta(s)`, x0 + PAD, yy + 5)
  } else if (!informativo && !comentarios.length) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...GRIS)
    doc.text('Sin comentarios ni evidencias', x0 + PAD, yy + 4)
  }
  meta(li, x0, y0 + h - 4, w, item)
  return h
}

// ---------------------------------------------------------------------------
// CHECKLIST
// ---------------------------------------------------------------------------
export function renderChecklist(li: Lienzo, item: Item, valor: unknown): number {
  const doc = li.doc
  const v = valor as ValorChecklist | null
  const opts = ((item.opciones ?? []) as Opcion[]).filter((o) => !(v?.informativos ?? []).includes(o.id))
  const sel = v?.selected ?? []
  const fallas = opts.filter((o) => !opcionCumplida(o, v, o.id))
  const correctas = opts.length - fallas.length
  const pct = opts.length ? (correctas / opts.length) * 100 : 100

  const x0 = li.M
  const w = li.tw
  const anchoRow = w - PAD * 2
  const qW = w - PAD * 2 - CHIP_COL
  const nQ = lineas(doc, item.texto, qW).length
  const alCuerpo = PADT * 2 + Math.max(17, nQ * 11 + 4)

  let alRows = 0
  for (const o of opts) {
    const wLabel = anchoRow - (o.tipo_respuesta === 'RANGO' ? 190 : 28)
    const nl = lineas(doc, o.etiqueta ?? o.id, wLabel).length
    alRows += o.tipo_respuesta === 'RANGO' ? Math.max(16, nl * 9.5 + 12) + 3 : Math.max(13, nl * 9.5 + 4)
  }
  const h = alCuerpo + 8 + alRows + 34 + (v?.informativos?.length ? 12 : 0) + 4

  li.asegurar(h + 9)
  const y0 = li.y
  const colorBar = fallas.length ? (pct < 60 ? ROJO : AMBAR) : VERDE
  marco(li, x0, y0, w, h, colorBar)
  cabecera(li, x0, y0, w, item, [
    fallas.length
      ? { texto: `${fallas.length} FALTA(S)`, fondo: ROJO_CLARO, color: ROJO }
      : { texto: 'OK', fondo: VERDE_CLARO, color: VERDE }
  ])

  let yy = y0 + alCuerpo
  divisor(li, x0, yy, w)
  yy += 5

  for (const o of opts) {
    const ok = opcionCumplida(o, v, o.id)
    const selected = sel.includes(o.id)
    const rango = o.tipo_respuesta === 'RANGO'
    const caja: 'ok' | 'fail' | 'off' = ok ? 'ok' : selected ? 'fail' : 'off'
    cajaCheck(doc, x0 + PAD, yy - 4.5, 8, caja)

    const wLabel = anchoRow - (rango ? 188 : 28)
    const label = o.etiqueta ?? o.id
    doc.setFont('helvetica', ok ? 'normal' : 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...(ok ? MARINO : ROJO))
    const lnLabel = lineas(doc, label, wLabel)
    lnLabel.forEach((ln, i) => doc.text(ln, x0 + PAD + 12, yy + 4.5 + i * 9.5))

    if (rango) {
      const valorIngresado = (v?.valores ?? {})[o.id]
      const max = o.maximo ?? Math.max((o.minimo ?? 0) * 2, 100)
      const bx = x0 + w - PAD - 190
      const bw = 104
      const pctR = typeof valorIngresado === 'number' && max > 0 ? Math.max(0, Math.min(100, (valorIngresado / max) * 100)) : 0
      barra(doc, bx, yy + 1.5, bw, 4.2, pctR, ok ? VERDE : ROJO, GRIS_CLARO)
      const txt = `${typeof valorIngresado === 'number' ? fmt(valorIngresado) : '—'}${o.unidad ? ' ' + o.unidad : ''} · mín ${o.minimo ?? '—'}`
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...GRIS)
      doc.text(txt, bx - 5, yy + 9.5, { align: 'right', maxWidth: 72 })
    }
    yy += rango ? Math.max(16, lnLabel.length * 9.5 + 12) + 3 : Math.max(13, lnLabel.length * 9.5 + 4)
  }

  yy += 1
  divisor(li, x0, yy, w)
  yy += 6
  resumenCuadro(li, x0, yy, w, `${correctas} de ${opts.length} opciones cumplidas`, pct)
  if (v?.informativos?.length) {
    chip(doc, `${v.informativos.length} informativo(s) sin puntuar`, x0 + PAD, yy + 15, AMBAR_CLARO, AMBAR, w - PAD * 2, 7.2)
  }
  meta(li, x0, y0 + h - 4, w, item)
  return h
}

// ---------------------------------------------------------------------------
// CONCILIACIÓN
// ---------------------------------------------------------------------------
export function renderConciliacion(li: Lienzo, item: Item, valor: unknown): number {
  const doc = li.doc
  const v = valor as ValorConciliacion | null
  const ps = v?.productos ?? []

  const x0 = li.M
  const w = li.tw
  const anchoRow = w - PAD * 2
  const qW = w - PAD * 2 - CHIP_COL
  const nQ = lineas(doc, item.texto, qW).length
  const alCuerpo = PADT * 2 + Math.max(17, nQ * 11 + 4)

  const maxQ = Math.max(1, ...ps.map((p) => Math.max(p.teorica ?? 0, p.fisica ?? 0)))
  let alRows = 0
  for (const p of ps) {
    const tieneInfo = p.soh != null || !!p.lastSync || p.finalBase != null
    alRows += 37 + (tieneInfo ? 9 : 0)
  }
  const h = alCuerpo + 8 + (ps.length ? alRows + 16 : 18) + 20

  const escaneados = ps.filter((p) => typeof p?.teorica === 'number' && typeof p?.fisica === 'number')
  const coinciden = escaneados.filter((p) => p.fisica === p.teorica).length
  const colorBar = escaneados.length && coinciden === escaneados.length ? VERDE : ROJO
  const perOk = escaneados.length ? (coinciden / escaneados.length) * 100 : 100

  li.asegurar(h + 9)
  const y0 = li.y
  marco(li, x0, y0, w, h, colorBar)
  cabecera(li, x0, y0, w, item, [
    coinciden === escaneados.length && escaneados.length
      ? { texto: 'COINCIDE', fondo: VERDE_CLARO, color: VERDE }
      : { texto: 'DIFERENCIAS', fondo: ROJO_CLARO, color: ROJO }
  ])

  let yy = y0 + alCuerpo
  divisor(li, x0, yy, w)
  yy += 6

  if (!ps.length) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(...GRIS)
    doc.text('Sin productos registrados', x0 + PAD, yy + 4)
    meta(li, x0, y0 + h - 4, w, item)
    return h
  }

  const bx = x0 + PAD + 58
  const bw = anchoRow - 58 - 46
  for (const p of ps) {
    const pctP = conciliacionPorcentaje(p)
    const okP = p.fisica === p.teorica
    const tieneInfo = p.soh != null || !!p.lastSync || p.finalBase != null

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...MARINO)
    const nom = [p.sku, p.nombre].filter(Boolean).join(' — ')
    doc.text(nom, x0 + PAD, yy + 4, { maxWidth: w - PAD * 2 - 70 })
    if (typeof pctP === 'number') {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.6)
      doc.setTextColor(...(okP ? VERDE : ROJO))
      doc.text(`${fmt(pctP)}%`, x0 + w - PAD - 12, yy + 4, { align: 'right', maxWidth: 60 })
    }
    yy += 12

    const valorBar = (vN: number | null | undefined) =>
      typeof vN === 'number' && Number.isFinite(vN) && Math.abs(vN) > 0
        ? Math.min(100, (Math.abs(vN) / maxQ) * 100)
        : 0
    const filaBarra = (et: string, vN: number | null | undefined, color: RGB, val: string) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...color)
      doc.text(et, x0 + PAD, yy + 4)
      barra(doc, bx, yy + 1, bw, 4.4, valorBar(vN), color)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...MARINO)
      doc.text(val, bx + bw + 3, yy + 4.2)
      yy += 10.5
    }
    filaBarra('TEÓRICA', p.teorica, GRIS, `${p.teorica ?? '—'}`)
    filaBarra('FÍSICA', p.fisica, MARINO, `${p.fisica ?? '—'}`)

    if (tieneInfo) {
      const infos: string[] = []
      if (p.soh != null) infos.push(`SOH ${p.soh}`)
      if (p.lastSync) infos.push(`Sync ${formatearLastSync(p.lastSync)}`)
      if (p.finalBase != null) infos.push(`Precio ${formatearPrecioBase(p.finalBase)}`)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.8)
      doc.setTextColor(...GRIS)
      doc.text(infos.join(' · '), x0 + PAD, yy + 3)
      yy += 9
    }
    yy += 4
  }

  yy += 1
  divisor(li, x0, yy, w)
  yy += 6
  resumenCuadro(li, x0, yy, w, `${coinciden} de ${escaneados.length} productos en coincidencia`, perOk)
  meta(li, x0, y0 + h - 4, w, item)
  return h
}

// ---------------------------------------------------------------------------
// LISTA (colaboradores / unidades) — estructura común
// ---------------------------------------------------------------------------
function renderListaBase(li: Lienzo, item: Item, filas: { titulo: string; estado: ChipTxt; detalle: string }[]): number {
  const doc = li.doc
  const x0 = li.M
  const w = li.tw
  const anchoRow = w - PAD * 2
  const qW = w - PAD * 2 - CHIP_COL
  const nQ = lineas(doc, item.texto, qW).length
  const alCuerpo = PADT * 2 + Math.max(17, nQ * 11 + 4)

  let alRows = 0
  const resRows: { l1: string[]; l2: string[] }[] = []
  for (const f of filas) {
    const l1 = lineas(doc, f.titulo, anchoRow - 84)
    const l2 = lineas(doc, f.detalle, anchoRow - 28)
    resRows.push({ l1, l2 })
    alRows += Math.max(13, l1.length * 9.5 + 4) + (l2.length ? l2.length * 8.5 + 3 : 0)
  }
  const h = alCuerpo + 8 + alRows + 18 + 20
  const total = filas.length
  const cumplen = filas.filter((f) => f.estado.color === VERDE).length
  const pct = total ? (cumplen / total) * 100 : 100

  li.asegurar(h + 9)
  const y0 = li.y
  marco(li, x0, y0, w, h, pct >= 80 ? VERDE : pct >= 60 ? AMBAR : ROJO)
  cabecera(li, x0, y0, w, item, [
    cumplen === total && total
      ? { texto: 'OK', fondo: VERDE_CLARO, color: VERDE }
      : { texto: 'PENDIENTE', fondo: AMBAR_CLARO, color: AMBAR }
  ])

  let yy = y0 + alCuerpo
  divisor(li, x0, yy, w)
  yy += 5

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i]
    const r = resRows[i]
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...MARINO)
    r.l1.forEach((ln, i2) => doc.text(ln, x0 + PAD, yy + 4.4 + i2 * 9.5))
    chip(doc, f.estado.texto, x0 + w - PAD - 72, yy, f.estado.fondo, f.estado.color, 72)
    yy += Math.max(13, r.l1.length * 9.5 + 4)
    if (r.l2.length) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...ROJO)
      r.l2.forEach((ln, i2) => doc.text(ln, x0 + PAD + 2, yy + 3 + i2 * 8.5))
      yy += r.l2.length * 8.5 + 3
    }
  }

  yy += 1
  divisor(li, x0, yy, w)
  yy += 6.5
  resumenCuadro(li, x0, yy, w, `${cumplen} de ${total} completos`, pct)
  meta(li, x0, y0 + h - 4, w, item)
  return h
}

export function renderColaboradores(li: Lienzo, item: Item, valor: unknown): number {
  const v = valor as ValorListaColaboradores | null
  const cols = v?.colaboradores ?? []
  const opts = item.opciones ?? []

  const filas = cols.map((c) => {
    const aplica = c.aplica
    const cumple = aplica ? colaboradorCumple(c, opts) : false
    const estado: ChipTxt = !aplica
      ? { texto: 'NO APLICA', fondo: GRIS_CLARO, color: GRIS }
      : cumple
        ? { texto: 'CUMPLE', fondo: VERDE_CLARO, color: VERDE }
        : { texto: 'INCOMPLETO', fondo: ROJO_CLARO, color: ROJO }
    const faltan = aplica
      ? opts.filter((o) => !(c.selected ?? []).includes(o.id)).map((o) => o.etiqueta ?? o.id)
      : []
    const detalle = aplica
      ? faltan.length
        ? `Falta: ${faltan.join(', ')}`
        : `${c.selected?.length ?? 0}/${opts.length} requerimientos cumplidos`
      : ''
    return {
      titulo: `${c.name} ${c.lastname}${c.role_name ? ` · ${c.role_name}` : ''}`,
      estado,
      detalle
    }
  })
  return renderListaBase(li, item, filas)
}

export function renderUnidades(li: Lienzo, item: Item, valor: unknown): number {
  const v = valor as ValorUnidadChecklist | null
  const unids = v?.unidades ?? []
  const opts = item.opciones ?? []

  const filas = unids.map((u) => {
    const cumple = unidadCumple(u, opts)
    const faltan = opts.filter((o) => !(u.selected ?? []).includes(o.id)).map((o) => o.etiqueta ?? o.id)
    const detalle = !cumple ? `Falta: ${faltan.join(', ')}` : `${u.selected?.length ?? 0}/${opts.length} requerimientos`
    return {
      titulo: u.codigo,
      estado: cumple
        ? { texto: 'OK', fondo: VERDE_CLARO, color: VERDE }
        : { texto: 'INCOMPLETO', fondo: ROJO_CLARO, color: ROJO },
      detalle
    }
  })
  return renderListaBase(li, item, filas)
}

/** Despacho por tipo de ítem; avanza el cursor. */
export function renderItem(li: Lienzo, item: Item, valor: unknown): void {
  let h: number
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE':
      h = renderCumple(li, item, valor)
      break
    case 'CHECKLIST':
      h = renderChecklist(li, item, valor)
      break
    case 'CONCILIACION':
      h = renderConciliacion(li, item, valor)
      break
    case 'LISTA_COLABORADORES':
      h = renderColaboradores(li, item, valor)
      break
    case 'UNIDAD_CHECKLIST':
      h = renderUnidades(li, item, valor)
      break
    default:
      h = renderCumple(li, item, valor)
  }
  li.y += h + 7
}