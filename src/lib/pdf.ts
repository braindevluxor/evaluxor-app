import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Item } from './types'
import type { DetalleEvaluacion } from './data/indicadores'
import { obtenerEvaluacion, resumirEvaluacion } from './data/indicadores'
import { etiquetaTipo, valorBinario, conciliacionTotal, conciliacionPorcentaje, type ValorConciliacion, type ValorCumple, type ValorChecklist } from './scoring'

const MARINO: [number, number, number] = [11, 37, 69]
const MARINO_CLARO: [number, number, number] = [238, 244, 251]
const VERDE: [number, number, number] = [22, 163, 74]
const AMBAR: [number, number, number] = [180, 83, 9]
const ROJO: [number, number, number] = [220, 38, 38]
const GRIS: [number, number, number] = [100, 116, 139]

function formatoFecha(fecha: string): string {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
}

function estadoPuntaje(p: number): { texto: string; color: [number, number, number] } {
  if (p >= 80) return { texto: 'CUMPLE', color: VERDE }
  if (p >= 60) return { texto: 'EN RIESGO', color: AMBAR }
  return { texto: 'NO CUMPLE', color: ROJO }
}

function textoValor(item: Item, valor: unknown): string {
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE': {
      const v = valor as ValorCumple | null
      const ev = v?.evidencias ?? []
      if (v?.value === null || v?.value === undefined) return 'Sin responder'
      const partes: string[] = []
      if (v.informativo) partes.push('INFORMATIVO (no descuenta)')
      partes.push(v.value ? 'Cumple' : 'No cumple')
      const c = ev.find((e) => e.comentario.trim())
      if (c) partes.push(`Comentario: ${c.comentario}`)
      const nFotos = ev.reduce((a, e) => a + e.photoIds.length, 0)
      if (nFotos > 0) partes.push(`${nFotos} foto(s)`)
      return partes.join(' · ')
    }
    case 'CHECKLIST': {
      const v = valor as ValorChecklist | null
      const sel = v?.selected ?? []
      const etiquetas = sel.map((id) => {
        const o = (item.opciones ?? []).find((x) => typeof x === 'object' && x.id === id)
        return o ? o.etiqueta : id
      })
      const nFotos = Object.values(v?.evidencias ?? {}).reduce((a, e) => a + e.photoIds.length, 0)
      if (!sel.length) return 'Ninguna opción marcada'
      const informativos = (v?.informativos ?? []).map((id) => {
        const o = (item.opciones ?? []).find((x) => typeof x === 'object' && x.id === id)
        return o ? o.etiqueta : id
      })
      const partes = [etiquetas.join(', ')]
      if (informativos.length) partes.push(`Informativo: ${informativos.join(', ')}`)
      if (nFotos > 0) partes.push(`${nFotos} foto(s)`)
      return partes.join('  ·  ')
    }
    case 'CONCILIACION': {
      const v = valor as ValorConciliacion | null
      const ps = v?.productos ?? []
      if (!ps.length) return 'Sin productos'
      const total = conciliacionTotal(v)
      const lineas = ps.map(
        (p) =>
          `${p.sku}${p.nombre ? ` — ${p.nombre}` : ''}` +
          `  Teórica: ${p.teorica ?? '—'} · Física: ${p.fisica ?? '—'} (${conciliacionPorcentaje(p) ?? '—'}%)`
      )
      if (v?.informativo) lineas.unshift('INFORMATIVO (no descuenta)')
      if (total != null) lineas.push(`Total: ${total}%`)
      return lineas.join('\n')
    }
    default:
      return 'Sin respuesta'
  }
}

export async function descargarPdf(id: string): Promise<void> {
  const detalle = await obtenerEvaluacion(id)
  if (!detalle) throw new Error('No se encontró la evaluación.')
  generarPdfResultado(detalle)
}

export function generarPdfResultado(d: DetalleEvaluacion): void {
  const { evaluacion: ev, respuestas, items, modulos } = d
  const { puntaje } = resumirEvaluacion(ev, respuestas, items)

  const doc = new jsPDF()
  const W = doc.internal.pageSize.getWidth()
  const M = 14
  let y = 0

  doc.setFillColor(...MARINO)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('EvaLuxor · Evaluación 360°', M, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Informe de resultados', M, 21)

  const lineaEtiquetaValor = (etiqueta: string, valor: string) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...GRIS)
    doc.text(etiqueta, M, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...MARINO)
    doc.text(valor, 95, y)
    y += 6
  }

  y = 40
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...MARINO)
  doc.text('Datos de la evaluación', M, y)
  y += 8

  const suc = ev.sucursal
  lineaEtiquetaValor('Sucursal', suc?.nombre ?? ev.sucursal_id)
  if (suc?.shop_id) lineaEtiquetaValor('Nº tienda', suc.shop_id)
  if (suc?.direccion) lineaEtiquetaValor('Dirección', suc.direccion)
  lineaEtiquetaValor('Fecha de evaluación', formatoFecha(ev.fecha))
  lineaEtiquetaValor('Aperturada por', ev.aperturador?.nombre ?? '—')

  if (puntaje != null) {
    doc.setDrawColor(226, 232, 240)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(M, y - 5, W - M * 2, 20, 3, 3, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...MARINO)
    doc.text('Puntaje general', M + 6, y + 4)
    doc.setFontSize(16)
    doc.text(`${puntaje}%`, M + 6, y + 13)
    const est = estadoPuntaje(puntaje)
    doc.setFillColor(...est.color)
    doc.roundedRect(W - M - 40, y - 2, 34, 12, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(255, 255, 255)
    doc.text(est.texto, W - M - 23, y + 4, { align: 'center' })
    y += 24
  } else {
    y += 6
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['#', 'Módulo', 'Preguntas', 'Cumplidas', 'Puntaje']],
    body: (() => {
      const filas: (string | number)[][] = []
      for (const m of modulos) {
        const itemMod = items.filter((i) => i.modulo_id === m.id)
        const vals = respuestas
          .map((r) => {
            const it = itemMod.find((i) => i.id === r.item_id)
            return it ? valorBinario(it, r.valor) : null
          })
          .filter((x): x is boolean => x !== null)
        const ok = vals.filter(Boolean).length
        filas.push([
          filas.length + 1,
          m.nombre,
          itemMod.length,
          vals.length ? `${ok} de ${vals.length}` : '—',
          vals.length ? `${Math.round((ok / vals.length) * 10000) / 100}%` : '—'
        ])
      }
      return filas
    })(),
    theme: 'striped',
    headStyles: { fillColor: MARINO, textColor: 255, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, textColor: MARINO },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 'auto' },
      4: { halign: 'right' }
    }
  })

  for (const m of modulos) {
    const itemMod = items.filter((i) => i.modulo_id === m.id)
    const filas: (string | number)[][] = []
    const impulsos: { evaluacion_id: string; item: Item; valor: unknown }[] = []
    const vals: { item: Item; valor: unknown }[] = []
    for (const r of respuestas) {
      const it = itemMod.find((i) => i.id === r.item_id)
      if (it) {
        impulsos.push({ evaluacion_id: r.evaluacion_id, item: it, valor: r.valor })
        vals.push({ item: it, valor: r.valor })
      }
    }
    const bin = vals.map((x) => valorBinario(x.item, x.valor)).filter((x): x is boolean => x !== null)
    const punteo = bin.length ? Math.round((bin.filter(Boolean).length / bin.length) * 10000) / 100 : null

    doc.addPage()
    doc.setFillColor(...MARINO_CLARO)
    doc.roundedRect(M, 14, W - M * 2, 14, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...MARINO)
    doc.text(`Módulo: ${m.nombre}`, M + 5, 23)
    doc.setFontSize(9)
    const punteoTexto = punteo != null ? `Puntaje: ${punteo}% (${bin.filter(Boolean).length}/${bin.length})` : 'Sin ítems puntuables'
    doc.text(punteoTexto, W - M - 5, 23, { align: 'right' })

    for (const x of vals) {
      filas.push([x.item.texto, etiquetaTipo(x.item.tipo), textoValor(x.item, x.valor)])
    }
    if (!filas.length) {
      filas.push(['No hay respuestas en este módulo.', '', ''])
    }

    autoTable(doc, {
      startY: 32,
      margin: { left: M, right: M },
      head: [['Pregunta', 'Tipo', 'Respuesta']],
      body: filas,
      theme: 'striped',
      headStyles: { fillColor: MARINO, textColor: 255, fontSize: 9.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9, textColor: MARINO },
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 45, halign: 'center' },
        2: { cellWidth: 'auto' }
      }
    })
  }

  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    const ph = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRIS)
    const generado = `EvaLuxor · ${suc?.nombre ?? ''} · ${formatoFecha(ev.fecha)}`
    doc.text(generado, M, ph - 8)
    doc.text(`Página ${i} de ${totalPages}`, W - M, ph - 8, { align: 'right' })
  }

  const nombre = `informe-${(suc?.nombre ?? 'evaluacion').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${ev.fecha}.pdf`
  doc.save(nombre)
}