import { jsPDF } from 'jspdf'
import type { DetalleEvaluacion } from '../data/indicadores'
import { obtenerEvaluacion, resumirEvaluacion } from '../data/indicadores'
import {
  conciliacionPorcentaje,
  colaboradorCumple,
  incumplimientosPorResponsable,
  itemsProporcion,
  opcionCumplida,
  opcionesAplicablesColaborador,
  unidadCumple,
  veredictoItem,
  type ValorChecklist,
  type ValorConciliacion,
  type ValorCumple,
  type ValorListaColaboradores,
  type ValorPlano,
  type ValorUnidadChecklist,
  type VeredictoItem
} from '../scoring'
import type { Item, Modulo, Respuesta } from '../types'
import { hijosOrdenados, itemsEnOrdenJerarquico } from '../hierarchy'
import { raicesDeModulo } from '../pasos'
import {
  colorPuntaje,
  fmt,
  formatoFecha,
  GRIS,
  GRIS_CLARO,
  MARINO,
  ROJO,
  VERDE,
  estadoPuntaje
} from './graficos'

export type FiltroPdfCumplimiento = 'ambos' | 'cumple' | 'no-cumple'

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 48
const CONTENT_W = PAGE_W - MARGIN_X * 2
const TOP = 62
const BOTTOM = PAGE_H - 54
const LINE = 13

type RGB = [number, number, number]

function opcionesDeSucursal(detalle: DetalleEvaluacion): Map<string, string[]> {
  const opciones = new Map<string, string[]>()
  for (const row of detalle.sucursalOpciones.filter((o) =>
    o.sucursal_id === detalle.evaluacion.sucursal_id && o.activa
  )) {
    const ids = opciones.get(row.item_id) ?? []
    ids.push(row.opcion_id)
    opciones.set(row.item_id, ids)
  }
  return opciones
}

function aplicarOpciones(item: Item, opciones: Map<string, string[]>): Item {
  if (item.tipo !== 'CHECKLIST' || !item.opciones?.length) return item
  const ids = opciones.get(item.id)
  return ids?.length ? { ...item, opciones: item.opciones.filter((o) => ids.includes(o.id)) } : item
}

export function filtrarDetallePdf(
  detalle: DetalleEvaluacion,
  filtro: FiltroPdfCumplimiento
): DetalleEvaluacion {
  const opciones = opcionesDeSucursal(detalle)
  const itemsPorId = new Map(detalle.items.map((item) => {
    const aplicado = aplicarOpciones(item, opciones)
    return [item.id, aplicado] as const
  }))
  const respuestas = detalle.respuestas.filter((respuesta) => {
    const item = itemsPorId.get(respuesta.item_id)
    if (!item || item.tipo === 'CONTENEDOR') return false
    const veredicto = veredictoItem(item, respuesta.valor)
    return filtro === 'ambos'
      ? veredicto === 'cumple' || veredicto === 'no-cumple'
      : veredicto === filtro
  })
  const modulosIncluidos = new Set(
    respuestas.map((respuesta) => itemsPorId.get(respuesta.item_id)?.modulo_id).filter(Boolean)
  )
  const instanciasIncluidas = new Set(
    respuestas.map((respuesta) => respuesta.instancia_id).filter((id): id is string => !!id)
  )
  return {
    ...detalle,
    respuestas,
    items: detalle.items
      .filter((item) => modulosIncluidos.has(item.modulo_id))
      .map((item) => itemsPorId.get(item.id) ?? item),
    modulos: detalle.modulos.filter((modulo) => modulosIncluidos.has(modulo.id)),
    instancias: detalle.instancias.filter((instancia) => instanciasIncluidas.has(instancia.id))
  }
}

class InformePdf {
  readonly doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  private y = TOP

  constructor(private readonly filtro?: FiltroPdfCumplimiento) {}

  private get anchoTexto(): number {
    return CONTENT_W
  }

  private nuevaPagina(): void {
    this.doc.addPage()
    this.y = TOP
  }

  private espacio(alto: number): void {
    if (this.y + alto > BOTTOM && this.y > TOP) this.nuevaPagina()
  }

  private text(
    value: string,
    options: { size?: number; color?: RGB; bold?: boolean; italic?: boolean; indent?: number; line?: number } = {}
  ): void {
    const text = value.trim()
    if (!text) return
    const size = options.size ?? 9.5
    const lineHeight = options.line ?? LINE
    const indent = options.indent ?? 0
    this.doc.setFont('helvetica', options.bold ? 'bold' : options.italic ? 'italic' : 'normal')
    this.doc.setFontSize(size)
    this.doc.setTextColor(...(options.color ?? MARINO))
    const lines = this.doc.splitTextToSize(text, this.anchoTexto - indent) as string[]
    for (const line of lines) {
      this.espacio(lineHeight)
      this.doc.text(line, MARGIN_X + indent, this.y, { maxWidth: this.anchoTexto - indent })
      this.y += lineHeight
    }
  }

  private regla(): void {
    this.espacio(10)
    this.doc.setDrawColor(...GRIS_CLARO)
    this.doc.setLineWidth(0.7)
    this.doc.line(MARGIN_X, this.y, PAGE_W - MARGIN_X, this.y)
    this.y += 11
  }

  private titulo(text: string, nivel: 1 | 2 = 2): void {
    const size = nivel === 1 ? 21 : 13
    const gap = nivel === 1 ? 8 : 5
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(size)
    const lines = this.doc.splitTextToSize(text, this.anchoTexto) as string[]
    this.doc.setTextColor(...MARINO)
    for (const line of lines) {
      this.espacio(size + 4)
      this.doc.text(line, MARGIN_X, this.y, { maxWidth: this.anchoTexto })
      this.y += size + 4
    }
    this.y += gap
  }

  private franja(text: string, color: RGB = MARINO): void {
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(10)
    const lines = this.doc.splitTextToSize(text, this.anchoTexto - 24) as string[]
    for (const line of lines) {
      const height = 24
      this.espacio(height + 5)
      this.doc.setFillColor(...color)
      this.doc.roundedRect(MARGIN_X, this.y, CONTENT_W, height, 4, 4, 'F')
      this.doc.setTextColor(255, 255, 255)
      this.doc.text(line, MARGIN_X + 12, this.y + 16, { maxWidth: CONTENT_W - 24 })
      this.y += height + 3
    }
    this.y += 5
  }

  private metadatos(pares: [string, string][]): void {
    this.titulo('Datos de la evaluación')
    for (const [label, value] of pares) {
      this.text(label.toLocaleUpperCase('es'), { size: 7.5, color: GRIS, bold: true, line: 10 })
      this.text(value || '—', { size: 9.5, indent: 5, line: 12 })
      this.y += 3
    }
    this.regla()
  }

  private resumen(detalle: DetalleEvaluacion, respuestas: Respuesta[], items: Item[], opciones: Map<string, string[]>): void {
    const { puntaje, itemsBinarios } = resumirEvaluacion(
      detalle.evaluacion,
      respuestas,
      items,
      detalle.sucursalOpciones
    )
    const valores = respuestas.flatMap((respuesta) => {
      const item = items.find((candidate) => candidate.id === respuesta.item_id)
      return item ? [{ item: aplicarOpciones(item, opciones), valor: respuesta.valor }] : []
    })
    const { ok, total } = itemsProporcion(valores)
    const resultado = this.filtro && !itemsBinarios ? null : puntaje
    this.titulo('Resumen ejecutivo')
    this.espacio(72)
    const y0 = this.y
    const bg: RGB = [246, 248, 251]
    this.doc.setFillColor(...bg)
    this.doc.setDrawColor(...GRIS_CLARO)
    this.doc.roundedRect(MARGIN_X, y0, CONTENT_W, 64, 5, 5, 'FD')
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(22)
    this.doc.setTextColor(...(resultado == null ? GRIS : colorPuntaje(resultado)))
    this.doc.text(resultado == null ? '—' : `${fmt(resultado)}%`, MARGIN_X + 16, y0 + 28)
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(7.5)
    this.doc.setTextColor(...GRIS)
    this.doc.text('PUNTAJE DE EVALUACIÓN', MARGIN_X + 16, y0 + 43)
    this.doc.setFont('helvetica', 'normal')
    this.doc.setFontSize(9)
    this.doc.setTextColor(...MARINO)
    const resumenTexto = total
      ? `${fmt(ok)} de ${fmt(total)} puntos considerados en las respuestas incluidas.`
      : 'No hay respuestas puntuables en los resultados incluidos.'
    const resumenLines = this.doc.splitTextToSize(resumenTexto, CONTENT_W - 165) as string[]
    this.doc.text(resumenLines, MARGIN_X + 155, y0 + 28, { maxWidth: CONTENT_W - 170 })
    const estado = resultado == null ? 'Sin puntaje' : estadoPuntaje(resultado).texto
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(8)
    this.doc.setTextColor(...(resultado == null ? GRIS : colorPuntaje(resultado)))
    this.doc.text(estado, MARGIN_X + 155, y0 + 47)
    this.y += 77
    const modulosResumen = this.resumenModulos(detalle.modulos, respuestas, items, opciones)
    if (modulosResumen.length) {
      this.titulo('Resultado por módulo')
      for (const modulo of modulosResumen) {
        const label = modulo.pct == null ? 'Sin datos puntuables' : `${fmt(modulo.pct)}%`
        this.text(`${modulo.nombre} — ${label}`, { size: 9.5, bold: true })
      }
    }
  }

  private resumenModulos(
    modulos: Modulo[],
    respuestas: Respuesta[],
    items: Item[],
    opciones: Map<string, string[]>
  ): { nombre: string; pct: number | null }[] {
    return modulos.map((modulo) => {
      const itemsModulo = items.filter((item) => item.modulo_id === modulo.id)
      const valores = respuestas.flatMap((respuesta) => {
        const item = itemsModulo.find((candidate) => candidate.id === respuesta.item_id)
        return item ? [{ item: aplicarOpciones(item, opciones), valor: respuesta.valor }] : []
      })
      const { ok, total } = itemsProporcion(valores)
      return { nombre: modulo.nombre, pct: total ? Math.round((ok / total) * 10000) / 100 : null }
    })
  }

  private estadoItem(item: Item, valor: unknown): { label: string; color: RGB } {
    const veredicto: VeredictoItem = veredictoItem(item, valor)
    if (veredicto === 'cumple') return { label: 'CUMPLE', color: VERDE }
    if (veredicto === 'no-cumple') return { label: 'NO CUMPLE', color: ROJO }
    if (veredicto === 'no-aplica') return { label: 'NO APLICA', color: GRIS }
    return { label: 'SIN VEREDICTO', color: GRIS }
  }

  private item(item: Item, valor: unknown): void {
    const estado = this.estadoItem(item, valor)
    this.titulo(item.texto)
    this.text(estado.label, { size: 8, color: estado.color, bold: true })
    const soloIncumplimientos = this.filtro === 'no-cumple'
    switch (item.tipo) {
      case 'CUMPLE_NO_CUMPLE':
        this.detalleCumple(valor)
        break
      case 'CHECKLIST':
        this.detalleChecklist(item, valor, soloIncumplimientos)
        break
      case 'CONCILIACION':
        this.detalleConciliacion(item, valor, soloIncumplimientos)
        break
      case 'LISTA_COLABORADORES':
        this.detalleColaboradores(item, valor, soloIncumplimientos)
        break
      case 'UNIDAD_CHECKLIST':
        this.detalleUnidades(item, valor, soloIncumplimientos)
        break
      case 'PLANO_XY':
        this.detallePlano(valor, soloIncumplimientos)
        break
    }
    this.regla()
  }

  private detalleCumple(valor: unknown): void {
    const v = valor as ValorCumple | null
    const evidencias = (v?.evidencias ?? []) as { comentario?: string; photoIds?: string[]; paths?: string[] }[]
    for (const evidencia of evidencias) {
      if (evidencia.comentario?.trim()) this.text(`• ${evidencia.comentario.trim()}`, { indent: 9 })
    }
    const fotos = evidencias.reduce((n, evidencia) =>
      n + (evidencia.photoIds?.length ?? evidencia.paths?.length ?? 0), 0)
    if (fotos) this.text(`Evidencias fotográficas adjuntas: ${fotos}.`, { color: GRIS, indent: 9 })
  }

  private detalleChecklist(item: Item, valor: unknown, soloIncumplimientos: boolean): void {
    const v = valor as ValorChecklist | null
    const opciones = ((item.opciones ?? []) as NonNullable<Item['opciones']>)
      .filter((opcion) => !(v?.informativos ?? []).includes(opcion.id))
    const mostrar = soloIncumplimientos
      ? opciones.filter((opcion) => !opcionCumplida(opcion, v, opcion.id))
      : opciones
    if (!mostrar.length) {
      this.text('Sin opciones pendientes en este filtro.', { color: GRIS, indent: 9 })
      return
    }
    for (const opcion of mostrar) {
      const cumple = opcionCumplida(opcion, v, opcion.id)
      const valorRango = v?.valores?.[opcion.id]
      const datoRango = opcion.tipo_respuesta === 'RANGO' && typeof valorRango === 'number'
        ? ` · valor ${fmt(valorRango)}${opcion.unidad ? ` ${opcion.unidad}` : ''} · mínimo ${opcion.minimo ?? '—'}`
        : ''
      this.text(`${cumple ? '✓' : '•'} ${opcion.etiqueta ?? opcion.id}${datoRango}`, {
        size: 9,
        color: cumple ? MARINO : ROJO,
        indent: 9
      })
    }
  }

  private detalleConciliacion(item: Item, valor: unknown, soloIncumplimientos: boolean): void {
    const v = valor as ValorConciliacion | null
    const precio = item.contra_dato === 'FINAL_BASE'
    const productos = v?.productos ?? []
    const mostrar = soloIncumplimientos
      ? productos.filter((p) => typeof p.teorica === 'number' && typeof p.fisica === 'number' && p.teorica !== p.fisica)
      : productos
    if (!mostrar.length) {
      this.text('Sin productos para mostrar.', { color: GRIS, indent: 9 })
      return
    }
    for (const producto of mostrar) {
      const pct = conciliacionPorcentaje(producto)
      const dif = typeof producto.teorica === 'number' && typeof producto.fisica === 'number'
        ? Math.abs(producto.fisica - producto.teorica)
        : null
      const balance = dif == null || producto.fisica === producto.teorica
        ? 'Concilia'
        : `${producto.fisica! > producto.teorica! ? (dif === 1 ? 'Sobra' : 'Sobran') : (dif === 1 ? 'Falta' : 'Faltan')} ${fmt(dif)}`
      const nombre = [producto.sku, producto.nombre].filter(Boolean).join(' · ') || 'Producto sin identificar'
      this.text(nombre, { bold: true, indent: 9 })
      this.text(
        `${precio ? 'Sistema' : 'Teórica'}: ${producto.teorica ?? '—'}  |  ${precio ? 'Hablador' : 'Física'}: ${producto.fisica ?? '—'}  |  ${pct == null ? 'Sin datos' : `${fmt(pct)}% concilia`}  |  ${balance}`,
        { size: 8.8, indent: 18 }
      )
      if (producto.lastSync) this.text(`Sync: ${new Date(producto.lastSync).toLocaleString('es')}`, { size: 8, color: GRIS, indent: 18 })
    }
  }

  private detalleColaboradores(item: Item, valor: unknown, soloIncumplimientos: boolean): void {
    const v = valor as ValorListaColaboradores | null
    const opciones = item.opciones ?? []
    const colaboradores = (v?.colaboradores ?? []).filter((c) => c.aplica)
    const mostrar = colaboradores.filter((c) => {
      const aplican = opcionesAplicablesColaborador(c, opciones)
      return !soloIncumplimientos || (aplican.length > 0 && !colaboradorCumple(c, opciones))
    })
    if (!mostrar.length) {
      this.text('Sin colaboradores con incumplimientos para mostrar.', { color: GRIS, indent: 9 })
      return
    }
    for (const colaborador of mostrar) {
      this.text(`${colaborador.name} ${colaborador.lastname}${colaborador.role_name ? ` · ${colaborador.role_name}` : ''}`, {
        bold: true,
        indent: 9
      })
      const aplican = opcionesAplicablesColaborador(colaborador, opciones)
      const pendientes = aplican.filter((o) => !(colaborador.selected ?? []).includes(o.id))
      this.text(
        soloIncumplimientos
          ? `Pendiente: ${pendientes.map((o) => o.etiqueta).join(', ')}`
          : `${aplican.length - pendientes.length}/${aplican.length} puntos cumplidos${pendientes.length ? ` · Pendiente: ${pendientes.map((o) => o.etiqueta).join(', ')}` : ''}`,
        { indent: 18 }
      )
    }
  }

  private detalleUnidades(item: Item, valor: unknown, soloIncumplimientos: boolean): void {
    const v = valor as ValorUnidadChecklist | null
    const opciones = item.opciones ?? []
    const unidades = (v?.unidades ?? []).filter((u) => !soloIncumplimientos || !unidadCumple(u, opciones))
    if (!unidades.length) {
      this.text('Sin unidades con incumplimientos para mostrar.', { color: GRIS, indent: 9 })
      return
    }
    for (const unidad of unidades) {
      const faltan = opciones.filter((o) => !(unidad.selected ?? []).includes(o.id))
      this.text(unidad.codigo, { bold: true, indent: 9 })
      this.text(
        soloIncumplimientos
          ? `Pendiente: ${faltan.map((o) => o.etiqueta).join(', ')}`
          : `${opciones.length - faltan.length}/${opciones.length} puntos cumplidos${faltan.length ? ` · Pendiente: ${faltan.map((o) => o.etiqueta).join(', ')}` : ''}`,
        { indent: 18 }
      )
    }
  }

  private detallePlano(valor: unknown, soloIncumplimientos: boolean): void {
    const v = valor as ValorPlano | null
    const planos = v?.planos ?? []
    const puntos = (v?.puntos ?? []).filter((p) => !soloIncumplimientos || p.cumple === false)
    if (!puntos.length) {
      this.text('Sin puntos con incumplimientos para mostrar.', { color: GRIS, indent: 9 })
      return
    }
    for (const punto of puntos) {
      const plano = planos.find((p) => p.id === punto.planoId)?.nombre
      this.text(`${punto.cumple ? 'Cumple' : 'No cumple'}${plano ? ` · ${plano}` : ''}`, {
        bold: true,
        color: punto.cumple ? VERDE : ROJO,
        indent: 9
      })
      if (punto.comentario?.trim()) this.text(punto.comentario.trim(), { indent: 18 })
    }
  }

  private modulo(modulo: Modulo, respuestas: Respuesta[], items: Item[], opciones: Map<string, string[]>): void {
    const itemsModulo = itemsEnOrdenJerarquico(items.filter((item) => item.modulo_id === modulo.id))
    const valores = respuestas.flatMap((respuesta) => {
      const item = itemsModulo.find((candidate) => candidate.id === respuesta.item_id)
      return item ? [{ item: aplicarOpciones(item, opciones), valor: respuesta.valor }] : []
    })
    const { ok, total } = itemsProporcion(valores)
    const pct = total ? Math.round((ok / total) * 10000) / 100 : null
    this.franja(`MÓDULO · ${modulo.nombre}`, colorPuntaje(pct ?? 0))

    for (const raiz of raicesDeModulo(itemsModulo)) {
      if (raiz.tipo === 'CONTENEDOR') {
        const hijos = hijosOrdenados(itemsModulo, raiz.id)
        const instancias = this.instanciasModulo(respuestas, raiz.id, modulo.id)
        if (!instancias.length && !this.filtro) {
          this.text(`${raiz.texto} · Sin registros capturados`, { size: 10, bold: true })
          continue
        }
        for (const instancia of instancias) {
          this.text(`${raiz.texto} · ${instancia.etiqueta}`, { size: 10, bold: true })
          for (const hijo of hijos) {
            const respuesta = respuestas.find((r) =>
              r.item_id === hijo.id && (r.instancia_id ?? null) === instancia.id
            )
            if (respuesta) this.item(aplicarOpciones(hijo, opciones), respuesta.valor)
          }
        }
      } else {
        const respuesta = respuestas.find((r) => r.item_id === raiz.id && !r.instancia_id)
        if (respuesta) this.item(aplicarOpciones(raiz, opciones), respuesta.valor)
      }
    }
  }

  private instanciasModulo(respuestas: Respuesta[], itemId: string, moduloId: string) {
    const ids = new Set(respuestas
      .filter((respuesta) => {
        const item = this.currentItems.find((candidate) => candidate.id === respuesta.item_id)
        return item?.modulo_id === moduloId && !!respuesta.instancia_id
      })
      .map((respuesta) => respuesta.instancia_id))
    return this.currentInstancias.filter((instancia) => instancia.item_id === itemId && ids.has(instancia.id))
  }

  private currentItems: Item[] = []
  private currentInstancias: DetalleEvaluacion['instancias'] = []

  build(detalle: DetalleEvaluacion): jsPDF {
    const evaluacion = detalle.evaluacion
    const opciones = opcionesDeSucursal(detalle)
    const data = [
      ['Sucursal', evaluacion.sucursal?.nombre ?? evaluacion.sucursal_id],
      ...(evaluacion.sucursal?.shop_id ? [['N.º de tienda', evaluacion.sucursal.shop_id] as [string, string]] : []),
      ...(evaluacion.sucursal?.direccion ? [['Dirección', evaluacion.sucursal.direccion] as [string, string]] : []),
      ['Fecha', formatoFecha(evaluacion.fecha)],
      ['Aperturada por', evaluacion.aperturador?.nombre ?? '—'],
      ['Estado', evaluacion.estado],
      ...(this.filtro
        ? [['Filtro', this.filtro === 'ambos' ? 'Ambos · Cumple y No cumple' : this.filtro === 'cumple' ? 'Cumple' : 'No cumple'] as [string, string]]
        : [])
    ] as [string, string][]

    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(8)
    this.doc.setTextColor(...MARINO)
    this.titulo('Evaluación de sucursal', 1)
    this.text(`${evaluacion.sucursal?.nombre ?? 'Sucursal'} · ${formatoFecha(evaluacion.fecha)}`, {
      size: 11,
      color: GRIS
    })
    this.y += 12
    this.metadatos(data)
    this.resumen(detalle, detalle.respuestas, detalle.items, opciones)
    this.currentItems = detalle.items
    this.currentInstancias = detalle.instancias

    this.titulo('Detalle de resultados', 1)
    for (const modulo of detalle.modulos) {
      const moduloItems = detalle.items.filter((item) => item.modulo_id === modulo.id)
      if (!detalle.respuestas.some((respuesta) =>
        moduloItems.some((item) => item.id === respuesta.item_id)
      ) && this.filtro) continue
      this.modulo(modulo, detalle.respuestas, detalle.items, opciones)
    }

    const porResponsable = new Map<string, number>()
    for (const respuesta of detalle.respuestas) {
      const item = detalle.items.find((candidate) => candidate.id === respuesta.item_id)
      if (!item) continue
      for (const incumplimiento of incumplimientosPorResponsable(
        aplicarOpciones(item, opciones),
        respuesta.valor
      )) {
        porResponsable.set(
          incumplimiento.responsable,
          (porResponsable.get(incumplimiento.responsable) ?? 0) + incumplimiento.puntos
        )
      }
    }
    if (porResponsable.size) {
      this.titulo('Incumplimientos por responsable')
      for (const [nombre, puntos] of Array.from(porResponsable.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        this.text(`${nombre} — ${fmt(puntos)} puntos por atender`, { size: 9.5 })
      }
    }

    if (evaluacion.comentario_general?.trim()) {
      this.titulo('Comentario general')
      this.text(evaluacion.comentario_general.trim(), { size: 9.5 })
    }
    this.pies(evaluacion.sucursal?.nombre ?? 'Sucursal')
    return this.doc
  }

  private pies(sucursal: string): void {
    const total = this.doc.getNumberOfPages()
    for (let page = 1; page <= total; page++) {
      this.doc.setPage(page)
      this.doc.setDrawColor(...GRIS_CLARO)
      this.doc.setLineWidth(0.6)
      this.doc.setFont('helvetica', 'bold')
      this.doc.setFontSize(8)
      this.doc.setTextColor(...MARINO)
      this.doc.text('EVALUXOR  /  INFORME DE RESULTADOS', MARGIN_X, 34)
      this.doc.setDrawColor(...GRIS_CLARO)
      this.doc.line(MARGIN_X, 43, PAGE_W - MARGIN_X, 43)
      this.doc.line(MARGIN_X, PAGE_H - 35, PAGE_W - MARGIN_X, PAGE_H - 35)
      this.doc.setFont('helvetica', 'normal')
      this.doc.setFontSize(8)
      this.doc.setTextColor(...GRIS)
      this.doc.text(`EvaLuxor · ${sucursal} · ${fmt(page)} / ${fmt(total)}`, MARGIN_X, PAGE_H - 21)
    }
  }
}

export function buildPdfDocument(d: DetalleEvaluacion, filtro?: FiltroPdfCumplimiento): jsPDF {
  const detalle = filtro ? filtrarDetallePdf(d, filtro) : d
  return new InformePdf(filtro).build(detalle)
}

export function generarPdfResultado(d: DetalleEvaluacion): void {
  const doc = buildPdfDocument(d)
  const sucursal = d.evaluacion.sucursal?.nombre ?? 'evaluacion'
  const nombre = `informe-${sucursal.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${d.evaluacion.fecha}.pdf`
  doc.save(nombre)
}

export async function descargarPdf(id: string, filtro?: FiltroPdfCumplimiento): Promise<void> {
  const detalle = await obtenerEvaluacion(id)
  if (!detalle) throw new Error('No se encontró la evaluación.')
  if (!filtro) {
    generarPdfResultado(detalle)
    return
  }
  const doc = buildPdfDocument(detalle, filtro)
  const sucursal = detalle.evaluacion.sucursal?.nombre ?? 'evaluacion'
  const nombre = `informe-${sucursal.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${detalle.evaluacion.fecha}-${filtro}.pdf`
  doc.save(nombre)
}
