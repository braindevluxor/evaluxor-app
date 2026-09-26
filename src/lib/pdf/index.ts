import { jsPDF } from 'jspdf'
import type { DetalleEvaluacion } from '../data/indicadores'
import { obtenerEvaluacion, resumirEvaluacion } from '../data/indicadores'
import type { Item, Respuesta, InstanciaGrupo } from '../types'
import { itemsEnOrdenJerarquico, hijosOrdenados } from '../hierarchy'
import { raicesDeModulo } from '../pasos'
import { itemsProporcion, incumplimientosPorResponsable } from '../scoring'
import { Lienzo } from './lienzo'
import { renderItem } from './items'
import {
  FONDO,
  GRIS,
  GRIS_CLARO,
  MARINO,
  MARINO_CLARO,
  MARINO_MEDIO,
  ROJO,
  barra,
  chip,
  colorPuntaje,
  fmt,
  formatoFecha,
  rotuloSeccion,
  estadoPuntaje
} from './graficos'

function lineasDoc(doc: jsPDF, texto: string, w: number): string[] {
  return (doc.splitTextToSize(texto, Math.max(10, w)) as string[]) ?? []
}

/** Grilla de 2 columnas con etiqueta/valor para los datos de la evaluación. */
function datosGrid(li: Lienzo, pares: [string, string][]): void {
  const doc = li.doc
  li.asegurar(40)
  rotuloSeccion(doc, 'Datos de la evaluación', li.M, li.y, li.tw)
  li.y += 13

  const cols = 2
  const filas = Math.max(1, Math.ceil(pares.length / cols))
  const h = filas * 30 + 16
  li.asegurar(h + 10)
  const x0 = li.M
  const w = li.tw
  const y0 = li.y

  doc.setFillColor(...FONDO)
  doc.setDrawColor(...GRIS_CLARO)
  doc.setLineWidth(0.5)
  doc.roundedRect(x0, y0, w, h, 4, 4, 'FD')

  const colW = w / cols
  pares.forEach(([lb, val], i) => {
    const col = i % cols
    const fila = Math.floor(i / cols)
    const cx = x0 + 12 + col * colW
    const cy = y0 + 19 + fila * 30
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GRIS)
    doc.text(lb.toUpperCase(), cx, cy - 2)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...MARINO)
    doc.text(val, cx, cy + 13, { maxWidth: colW - 16 })
  })
  li.y = y0 + h + 15
}

/** Resumen e interpretación: nota total, lectura general y por módulo. */
function resumenInterpretacion(
  li: Lienzo,
  puntaje: number | null,
  ok: number,
  total: number,
  modulos: { nombre: string; pct: number | null }[]
): void {
  const doc = li.doc
  li.asegurar(40)
  const y0 = li.y
  rotuloSeccion(doc, 'Puntaje general', li.M, y0, li.tw)
  li.y = y0 + 13

  const est = estadoPuntaje(puntaje ?? 0)
  const pctOk = total > 0 ? (ok / total) * 100 : 0

  const p1 = !total
    ? 'No se registran respuestas puntuables, por lo que no es posible calcular el nivel de cumplimiento. Se recomienda completar la evaluación.'
    : `El informe registra un cumplimiento general de ${fmt(pctOk)}% (${fmt(ok)} de ${fmt(total)} puntos alcanzados). ${
        est.texto === 'CUMPLE'
          ? 'La sucursal alcanza el estándar mínimo aceptado (80% o más) y consolida un desempeño satisfactorio.'
          : est.texto === 'EN RIESGO'
            ? 'La sucursal se ubica en un nivel de riesgo (60–79%): no alcanza el estándar esperado y requiere acciones de mejora sobre las fallas detectadas.'
            : 'La sucursal está por debajo del nivel mínimo de cumplimiento (menos del 60%): se requiere un plan de acción correctivo con prioridad en los módulos de menor desempeño.'
      }`

  const conPct = modulos.filter((m): m is { nombre: string; pct: number } => m.pct != null)
  let p2: string | null = null
  if (conPct.length >= 2) {
    const mejor = conPct.reduce((a, b) => (b.pct > a.pct ? b : a))
    const peor = conPct.reduce((a, b) => (b.pct < a.pct ? b : a))
    if (mejor.pct !== peor.pct) {
      p2 = `El mejor desempeño se registra en “${mejor.nombre}” (${fmt(mejor.pct)}%), mientras que “${peor.nombre}” (${fmt(peor.pct)}%) concentra el mayor número de desviaciones y es prioritario dentro del plan de acción.`
    }
  }

  // Se miden los textos para dimensionar la tarjeta.
  const x0 = li.M
  const w = li.tw
  const rx = x0 + 132
  const rw = w - (rx - x0) - 20
  const p1L: string[] = doc.splitTextToSize(p1, rw) as string[]
  const p2L: string[] = p2 ? (doc.splitTextToSize(p2, rw) as string[]) : []
  const rows = Math.min(modulos.length, 4)
  const h = 128 + p1L.length * 11 + p2L.length * 11 + rows * 32
  li.asegurar(h + 8)
  const yy0 = li.y

  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(...GRIS_CLARO)
  doc.setLineWidth(0.5)
  doc.roundedRect(x0, yy0, w, h, 4, 4, 'FD')

  // Columna izquierda: nota total + estado.
  const cx = x0 + 70
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(...MARINO)
  doc.text(`${puntaje ?? '—'}%`, cx, yy0 + 32, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...GRIS)
  doc.text('NOTA TOTAL', cx, yy0 + 44, { align: 'center' })
  chip(doc, est.texto, cx - 30, yy0 + 54, est.fondo, est.color, 60)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRIS)
  doc.text(`${fmt(ok)} de ${fmt(total)} puntos`, cx, yy0 + 82, { align: 'center' })

  // Columna derecha: interpretación.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...MARINO_MEDIO)
  doc.text('RESUMEN E INTERPRETACIÓN', rx, yy0 + 26)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...GRIS)
  doc.text(p1L, rx, yy0 + 40)
  let yTxt = yy0 + 40 + p1L.length * 11
  if (p2L.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MARINO_MEDIO)
    doc.text(p2L, rx, yTxt)
    yTxt += p2L.length * 11
  }

  // Filas por módulo con su lectura.
  const filasY = yTxt + 12
  modulos.slice(0, 4).forEach((m, i) => {
    const ly = filasY + i * 32
    const color = colorPuntaje(m.pct ?? 0)
    doc.setFillColor(...color)
    doc.roundedRect(rx, ly - 4, 7, 7, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...MARINO)
    doc.text(m.nombre, rx + 12, ly, { maxWidth: rw - 72 })
    const pctTxt = m.pct != null ? `${fmt(m.pct)}%` : '—'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...color)
    doc.text(pctTxt, rx + rw, ly, { align: 'right' })
    const frase = m.pct == null ? 'Sin ítems puntuables' : m.pct >= 80 ? 'Cumple el estándar' : m.pct >= 60 ? 'Requiere seguimiento' : 'No alcanza el estándar'
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    doc.text(frase, rx + 12, ly + 13)
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.2)
  doc.setTextColor(...GRIS)
  doc.text('Ref.: 80% o más cumple · 60–79% en riesgo · menos de 60% no cumple', x0 + 12, yy0 + h - 10, { maxWidth: w - 24 })

  li.y = yy0 + h + 14
}

/** Sección repetible (CONTENEDOR): banda de título + registros con sus ítems. */
function renderSeccion(
  li: Lienzo,
  raiz: Item,
  itemMod: Item[],
  respuestas: Respuesta[],
  instancias: InstanciaGrupo[],
  aplicarOpciones: (item: Item) => Item
): void {
  const doc = li.doc
  const insts = instancias.filter((x) => x.item_id === raiz.id).sort((a, b) => a.orden - b.orden)
  const hijos = hijosOrdenados(itemMod, raiz.id)

  // Banda de título
  li.asegurar(32)
  const x0 = li.M
  const w = li.tw
  const y0 = li.y
  const nQ = lineasDoc(doc, raiz.texto, w - 50).length
  const h = Math.max(26, nQ * 11 + 16)

  doc.setFillColor(...FONDO)
  doc.setDrawColor(...GRIS_CLARO)
  doc.setLineWidth(0.5)
  doc.roundedRect(x0, y0, w, h, 4, 4, 'FD')
  doc.setFillColor(...MARINO)
  doc.roundedRect(x0, y0 + 2, 2.8, h - 4, 1.4, 1.4, 'F')

  const chipW = chip(doc, 'Sección', x0 + 10, y0 + h / 2 - 6.8, MARINO_CLARO, MARINO, 70)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...MARINO)
  doc.text(raiz.texto, x0 + 10 + chipW + 6, y0 + h / 2 + 2, { maxWidth: w - 24 - chipW - 80 })
  if (typeof raiz.puntaje === 'number' && raiz.puntaje > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    doc.text(`PESO ${fmt(raiz.puntaje)}`, x0 + w - 14, y0 + h / 2 + 2, { align: 'right' })
  }
  li.y = y0 + h + 8

  if (!insts.length) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9.5)
    doc.setTextColor(...GRIS)
    doc.text('Sección sin registros capturados', li.M, li.y + 4)
    li.y += 10
    return
  }

  insts.forEach((inst, i) => {
    li.asegurar(18)
    const x1 = li.M
    const y1 = li.y
    doc.setFillColor(...MARINO_MEDIO)
    doc.roundedRect(x1, y1 - 4.6, 3, 14, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...MARINO)
    doc.text(`REGISTRO ${i + 1} · ${inst.etiqueta}`, x1 + 11, y1 + 5)
    if (inst.datos && Object.keys(inst.datos).length) {
      const dt = Object.entries(inst.datos)
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('  ·  ')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...GRIS)
      doc.text(dt, x1 + li.tw - 14, y1 + 5, { align: 'right', maxWidth: li.tw * 0.48 })
    }
    li.y = y1 + 7
    for (const hijo of hijos) {
      const r = respuestas.find((x) => x.item_id === hijo.id && (x.instancia_id ?? null) === inst.id)
      if (r) renderItem(li, aplicarOpciones(hijo), r.valor)
    }
  })
}

export function buildPdfDocument(d: DetalleEvaluacion): jsPDF {
  const { evaluacion: ev, respuestas, items, modulos, sucursalOpciones, instancias } = d
  const suc = ev.sucursal
  const { puntaje } = resumirEvaluacion(ev, respuestas, items, sucursalOpciones)

  const aplicaOpciones = new Map<string, string[]>()
  for (const o of sucursalOpciones.filter((x) => x.sucursal_id === ev.sucursal_id && x.activa)) {
    const arr = aplicaOpciones.get(o.item_id) ?? []
    arr.push(o.opcion_id)
    aplicaOpciones.set(o.item_id, arr)
  }
  const aplicarOpciones = (item: Item): Item => {
    if (item.tipo !== 'CHECKLIST' || !item.opciones?.length) return item
    const ids = aplicaOpciones.get(item.id)
    if (!ids?.length) return item
    return { ...item, opciones: item.opciones.filter((o) => ids.includes(o.id)) }
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const li = new Lienzo(doc)

  const pares: [string, string][] = [
    ['Sucursal', suc?.nombre ?? ev.sucursal_id],
    ...(suc?.shop_id ? ([['Nº tienda', suc.shop_id]] as [string, string][]) : []),
    ...(suc?.direccion ? ([['Dirección', suc.direccion]] as [string, string][]) : []),
    ['Fecha de evaluación', formatoFecha(ev.fecha)],
    ['Aperturada por', ev.aperturador?.nombre ?? '—'],
    ['Estado', ev.estado]
  ]
  datosGrid(li, pares)

  // Totales por módulo (portada + detalle).
  let okTotal = 0
  let totalTotal = 0
  const modulosResumen = modulos.map((m) => {
    const itemMod = itemsEnOrdenJerarquico(items.filter((i) => i.modulo_id === m.id))
    const vals = respuestas
      .map((r) => {
        const it = itemMod.find((i) => i.id === r.item_id)
        return it ? { item: aplicarOpciones(it), valor: r.valor } : null
      })
      .filter((x): x is { item: Item; valor: unknown } => !!x)
    const { ok, total } = itemsProporcion(vals)
    okTotal += ok
    totalTotal += total
    const pct = total > 0 ? Math.round((ok / total) * 10000) / 100 : null
    return { nombre: m.nombre, pct }
  })

  resumenInterpretacion(li, puntaje, okTotal, totalTotal, modulosResumen)

  // Detalle por módulo.
  modulos.forEach((m, idx) => {
    li.nuevaPagina()
    const itemMod = itemsEnOrdenJerarquico(items.filter((i) => i.modulo_id === m.id))

    let preguntas = 0
    for (const raiz of raicesDeModulo(itemMod)) {
      if (raiz.tipo === 'CONTENEDOR') {
        const insts = instancias.filter((x) => x.item_id === raiz.id)
        preguntas += hijosOrdenados(itemMod, raiz.id).length * Math.max(1, insts.length)
      } else {
        preguntas += 1
      }
    }

    const vals = respuestas
      .map((r) => {
        const it = itemMod.find((i) => i.id === r.item_id)
        return it ? { item: aplicarOpciones(it), valor: r.valor } : null
      })
      .filter((x): x is { item: Item; valor: unknown } => !!x)
    const { ok, total } = itemsProporcion(vals)
    const pct = total > 0 ? Math.round((ok / total) * 10000) / 100 : null

    li.tarjetaModulo(`Módulo ${idx + 1} · ${m.nombre}`, `${preguntas} preguntas puntuables · ${fmt(ok)}/${fmt(total)} puntos`, pct, colorPuntaje(pct ?? 0))

    for (const raiz of raicesDeModulo(itemMod)) {
      if (raiz.tipo === 'CONTENEDOR') {
        renderSeccion(li, raiz, itemMod, respuestas, instancias, aplicarOpciones)
        continue
      }
      const r = respuestas.find((x) => x.item_id === raiz.id && !x.instancia_id)
      if (r) renderItem(li, aplicarOpciones(raiz), r.valor)
    }
  })

  // Incumplimientos por responsable.
  const acum = new Map<string, number>()
  for (const r of respuestas) {
    const it = items.find((i) => i.id === r.item_id)
    if (!it) continue
    for (const a of incumplimientosPorResponsable(aplicarOpciones(it), r.valor)) {
      acum.set(a.responsable, (acum.get(a.responsable) ?? 0) + a.puntos)
    }
  }
  if (acum.size) {
    li.nuevaPagina()
    const filas = Array.from(acum.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 14)
    li.asegurar(30)
    const y0 = li.y
    rotuloSeccion(doc, 'Incumplimientos por responsable', li.M, y0, li.tw)
    li.y = y0 + 13

    const maxP = Math.max(1, ...filas.map(([, n]) => n))
    for (const [nombre, puntos] of filas) {
      li.asegurar(20)
      const yy = li.y
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...MARINO)
      doc.text(nombre, li.M, yy + 4.5, { maxWidth: li.tw - 120 })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.8)
      doc.setTextColor(...ROJO)
      doc.text(`-${fmt(puntos)}`, li.M + li.tw - 16, yy + 4.5, { align: 'right' })
      barra(doc, li.M, yy + 9, li.tw, 5, (puntos / maxP) * 100, ROJO)
      li.y = yy + 21
    }
  }

  // Comentario general.
  if (ev.comentario_general?.trim()) {
    li.asegurar(40)
    const y0 = li.y
    rotuloSeccion(doc, 'Comentario general', li.M, y0, li.tw)
    li.y = y0 + 13

    const x0 = li.M
    const w = li.tw
    const lineas = doc.splitTextToSize(ev.comentario_general!, w - 28) as string[]
    const h = lineas.length * 13.5 + 24
    li.asegurar(h + 10)
    const y1 = li.y
    doc.setFillColor(...FONDO)
    doc.setDrawColor(...GRIS_CLARO)
    doc.setLineWidth(0.5)
    doc.roundedRect(x0, y1, w, h, 4, 4, 'FD')
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(10)
    doc.setTextColor(...MARINO)
    lineas.forEach((ln, i) => doc.text(ln, x0 + 14, y1 + 20 + i * 13.5))
    li.y = y1 + h + 14
  }

  li.pie(`EvaLuxor · ${suc?.nombre ?? ''} · ${formatoFecha(ev.fecha)}`)
  return doc
}

export function generarPdfResultado(d: DetalleEvaluacion): void {
  const doc = buildPdfDocument(d)
  const suc = d.evaluacion.sucursal
  const nombre = `informe-${(suc?.nombre ?? 'evaluacion').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${d.evaluacion.fecha}.pdf`
  doc.save(nombre)
}

export async function descargarPdf(id: string): Promise<void> {
  const detalle = await obtenerEvaluacion(id)
  if (!detalle) throw new Error('No se encontró la evaluación.')
  generarPdfResultado(detalle)
}