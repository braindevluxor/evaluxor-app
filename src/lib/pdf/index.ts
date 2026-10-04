import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { DetalleEvaluacion } from '../data/indicadores'
import { listarPerfilesSync, obtenerEvaluacion, resumirEvaluacion } from '../data/indicadores'
import {
  colaboradorCumple,
  conciliacionPorcentaje,
  formatearPrecioBase,
  perdidaGuardadaConciliacion,
  resumenPerdidaConciliacion,
  conSeccionesPonderadas,
  incumplimientosPorResponsable,
  opcionCumplida,
  opcionesAplicablesColaborador,
  proporcionItem,
  puntajePonderado,
  tieneRespuesta,
  unidadCumple,
  valorPorResponsable,
  veredictoItem,
  type ValorResponsable,
  type ValorChecklist,
  type ValorConciliacion,
  type ValorCumple,
  type ValorListaColaboradores,
  type ValorPlano,
  type ValorUnidadChecklist
} from '../scoring'
import type { Item, Modulo, Respuesta } from '../types'
import { hijosOrdenados, itemsEnOrdenJerarquico } from '../hierarchy'
import { raicesDeModulo } from '../pasos'
import { BRANCH_CENTRAL, normalizarResponsables, type ResponsableIncidencia } from '../data/responsablesIncidencia'
import { listarResponsables, type ResponsableCatalogo } from '../data/responsables'
import { ETIQUETAS_ROL } from '../roles'
import { supabase } from '../supabase'
import { ordenarTrabajadores } from '../data/colaboradores'

export type FiltroPdfCumplimiento = 'ambos' | 'cumple' | 'no-cumple'

export interface IncidenciaPdf {
  descripcion: string
  responsables: ResponsableIncidencia[]
}

export interface ResultadosCargos {
  sucursal: ValorResponsable[]
  central: ValorResponsable[]
}

export function clasificarResultadosCargos(
  resultados: ValorResponsable[],
  catalogoSucursal: ResponsableCatalogo[],
  catalogoCentral: ResponsableCatalogo[]
): ResultadosCargos {
  const clavesSucursal = new Set(catalogoSucursal.map(({ cargo }) => claveCargo(cargo)))
  const clavesCentral = new Set(catalogoCentral.map(({ cargo }) => claveCargo(cargo)))
  const grupos: ResultadosCargos = { sucursal: [], central: [] }

  for (const resultado of resultados) {
    const clave = claveCargo(resultado.responsable)
    if (clavesSucursal.has(clave)) grupos.sucursal.push(resultado)
    else if (clavesCentral.has(clave)) grupos.central.push(resultado)
  }
  const gruposOrdenados: ValorResponsable[][] = [grupos.sucursal, grupos.central]
  for (const grupo of gruposOrdenados) {
    grupo.sort((a, b) =>
      (b.porciento ?? -1) - (a.porciento ?? -1) ||
      b.logrado - a.logrado ||
      a.responsable.localeCompare(b.responsable)
    )
  }
  return grupos
}

function claveCargo(cargo: string): string {
  return cargo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function ocultarCentroCodigoEvaluacion(codigo: string): string {
  const compacto = codigo.replace(/-/g, '')
  if (!/^[\da-f]{32}$/i.test(compacto)) return codigo
  const enmascarado = `${compacto.slice(0, 12)}********${compacto.slice(20)}`
  return `${enmascarado.slice(0, 8)}-${enmascarado.slice(8, 12)}-${enmascarado.slice(12, 16)}-${enmascarado.slice(16, 20)}-${enmascarado.slice(20)}`
}

const MARGEN = 14
const TAMANO_FUENTE = 10
const fmt = (value: number): string => Number.isInteger(value) ? `${value}` : `${Math.round(value * 100) / 100}`
const texto = (value: unknown): string => String(value ?? '')

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

function puntajeModulo(detalle: DetalleEvaluacion, moduloId: string, opciones: Map<string, string[]>): number | null {
  const itemsModulo = detalle.items.filter((item) => item.modulo_id === moduloId)
  const itemsPorId = new Map(itemsModulo.map((item) => [item.id, aplicarOpciones(item, opciones)]))
  const binarios = detalle.respuestas.flatMap((respuesta) => {
    const item = itemsPorId.get(respuesta.item_id)
    if (!item) return []
    const proporcion = proporcionItem(item, respuesta.valor)
    return proporcion === null ? [] : [{ item, cumple: proporcion }]
  })
  return binarios.length
    ? puntajePonderado(conSeccionesPonderadas(detalle.items, binarios))
    : null
}

export function buildPdfDocument(
  detalle: DetalleEvaluacion,
  filtro?: FiltroPdfCumplimiento,
  perfiles: Readonly<Record<string, { nombre: string; rol?: keyof typeof ETIQUETAS_ROL }>> = {},
  incidencias: IncidenciaPdf[] = [],
  catalogoCargos: { sucursal: ResponsableCatalogo[]; central: ResponsableCatalogo[] } = { sucursal: [], central: [] }
): jsPDF {
  const resumenDetalle = detalle
  const contenido = filtro ? filtrarDetallePdf(detalle, filtro) : detalle
  const opciones = opcionesDeSucursal(contenido)
  const soloIncumplimientos = filtro === 'no-cumple'
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false })
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - MARGEN * 2
  let y = MARGEN

  const textoLinea = (value: string, options: { bold?: boolean; size?: number; gap?: number } = {}) => {
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

  const tabla = (headers: string[], rows: string[][], columnaFirma?: number) => {
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
      columnStyles: columnaFirma === 2
        ? { 0: { cellWidth: 52 }, 1: { cellWidth: 45 }, 2: { cellWidth: 85 } }
        : {},
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0 && data.cell.raw === '✓') {
          data.cell.text = []
        }
        if (data.section === 'body' && data.column.index === columnaFirma) {
          data.cell.styles.minCellHeight = 14
        }
      },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === columnaFirma) {
          pdf.setDrawColor(0)
          pdf.setLineWidth(0.2)
          pdf.line(
            data.cell.x + 3,
            data.cell.y + data.cell.height - 3,
            data.cell.x + data.cell.width - 3,
            data.cell.y + data.cell.height - 3
          )
          return
        }
        if (data.section !== 'body' || data.column.index !== 0 || data.cell.raw !== '✓') return
        const left = data.cell.x + data.cell.width / 2 - 1.2
        const middle = data.cell.y + data.cell.height / 2
        pdf.setDrawColor(0)
        pdf.setLineWidth(0.55)
        pdf.line(left, middle, left + 0.8, middle + 0.8)
        pdf.line(left + 0.8, middle + 0.8, left + 2.2, middle - 1)
      }
    })
    y = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    y += 3
  }

  const graficoBarrasModulos = (datos: { nombre: string; puntaje: number | null }[]) => {
    const plotX = MARGEN + 82
    const plotWidth = ancho - MARGEN - plotX - 18
    const etiquetaX = MARGEN
    const etiquetaWidth = plotX - etiquetaX - 5
    const espacioEje = 9
    const espacioFirmas = 24
    const altoDisponible = Math.max(0, alto - MARGEN - y - espacioEje - espacioFirmas)
    const altoFila = datos.length ? Math.min(10, altoDisponible / datos.length) : 0
    const tamanoFuente = datos.length > 8 ? 7 : 8.5
    const ejeY = y + 4

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(0)
    pdf.setDrawColor(0)
    pdf.setLineWidth(0.2)
    for (const tick of [0, 25, 50, 75, 100]) {
      const tickX = plotX + plotWidth * tick / 100
      pdf.line(tickX, ejeY, tickX, ejeY + altoFila * datos.length)
      pdf.text(String(tick), tickX, ejeY - 1, { align: tick === 0 ? 'left' : tick === 100 ? 'right' : 'center' })
    }

    datos.forEach(({ nombre, puntaje }, index) => {
      const filaY = ejeY + index * altoFila
      const etiquetaLineas = pdf.splitTextToSize(nombre, etiquetaWidth) as string[]
      const lineas = etiquetaLineas.length > 2
        ? [etiquetaLineas[0], `${etiquetaLineas[1].slice(0, 24)}…`]
        : etiquetaLineas
      const altoTexto = tamanoFuente * 0.38
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(tamanoFuente)
      pdf.setTextColor(0)
      pdf.text(lineas, etiquetaX, filaY + Math.max(altoTexto, (altoFila - lineas.length * altoTexto) / 2 + altoTexto))

      const barY = filaY + Math.max(0.8, (altoFila - 3.2) / 2)
      const porcentaje = puntaje == null ? null : Math.max(0, Math.min(100, puntaje))
      if (porcentaje !== null && porcentaje > 0) {
        pdf.setFillColor(105, 105, 105)
        pdf.setDrawColor(0)
        pdf.setLineWidth(0.25)
        pdf.rect(plotX, barY, plotWidth * porcentaje / 100, 3.2, 'FD')
      }
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(tamanoFuente)
      pdf.text(puntaje == null ? '—' : `${fmt(puntaje)}%`, plotX + plotWidth + 2, filaY + Math.max(altoTexto, altoFila / 2 + altoTexto / 3))
    })
    y = ejeY + altoFila * datos.length + 3
  }

  const ev = resumenDetalle.evaluacion
  const fecha = new Date(`${ev.fecha}T12:00:00`).toLocaleDateString('es')
  const resumen = resumirEvaluacion(ev, resumenDetalle.respuestas, resumenDetalle.items, resumenDetalle.sucursalOpciones)
  const opcionesResumen = opcionesDeSucursal(resumenDetalle)

  tituloSeccion('Datos de la tienda')
  tabla(['Dato de la tienda', 'Información'], [
    ['Código de evaluación', ocultarCentroCodigoEvaluacion(ev.id)],
    ['Sucursal', texto(ev.sucursal?.nombre ?? '—')],
    ['Código de tienda', texto(ev.sucursal?.shop_id ?? '—')],
    ['Dirección', texto(ev.sucursal?.direccion ?? '—')],
    ['Fecha de evaluación', fecha],
    ...(filtro ? [['Filtro del informe', filtro === 'ambos' ? 'Ambos' : filtro === 'cumple' ? 'Cumple' : 'No cumple']] : [])
  ])
  tituloSeccion('Puntuación general')
  textoLinea(resumen.puntaje == null ? 'Sin puntaje' : `${fmt(resumen.puntaje)}%`, { bold: true, gap: 3 })

  const respuestasPorUsuario = new Map<string, number>()
  for (const respuesta of resumenDetalle.respuestas) {
    if (!respuesta.respondido_por) continue
    const item = resumenDetalle.items.find((candidate) => candidate.id === respuesta.item_id)
    if (!item || !tieneRespuesta(item, respuesta.valor)) continue
    respuestasPorUsuario.set(
      respuesta.respondido_por,
      (respuestasPorUsuario.get(respuesta.respondido_por) ?? 0) + 1
    )
  }
  tituloSeccion('Personal evaluador')
  textoLinea(`${respuestasPorUsuario.size} usuario${respuestasPorUsuario.size === 1 ? ' subió' : 's subieron'} información.`)
  tabla(['Personal evaluador', 'Información registrada', 'Firma'], [...respuestasPorUsuario.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, cantidad]) => {
      const perfil = perfiles[id]
      const nombreRol = perfil?.rol ? `\n${ETIQUETAS_ROL[perfil.rol]}` : ''
      return [
        `${perfil?.nombre ?? `Usuario ${id.slice(0, 8)}`}${nombreRol}`,
        `${cantidad} ítem${cantidad === 1 ? '' : 's'} con respuesta`,
        ''
      ]
    }), 2)

  tituloSeccion('Puntaje final por módulo')
  graficoBarrasModulos(resumenDetalle.modulos.map((modulo) => {
    const resultado = puntajeModulo(resumenDetalle, modulo.id, opcionesResumen)
    return { nombre: modulo.nombre, puntaje: resultado }
  }))
  y += 4
  const anchoFirma = (anchoUtil - 20) / 2
  for (const [index, cargo] of ['Gerente de Talento Humano', 'Gerente Corporativo'].entries()) {
    const x = MARGEN + 10 + index * (anchoFirma + 20)
    const lineaY = y + 8
    pdf.setDrawColor(0)
    pdf.setLineWidth(0.25)
    pdf.line(x, lineaY, x + anchoFirma, lineaY)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(0)
    pdf.text(cargo, x + anchoFirma / 2, lineaY + 5, { align: 'center' })
  }

  pdf.addPage()
  y = MARGEN

  const checklist = (item: Item, valor: unknown) => {
    const v = valor as ValorChecklist | null
    const opcionesItem = (item.opciones ?? []).filter((option) => !(v?.informativos ?? []).includes(option.id))
    const rows = opcionesItem.map((option) => ({ option, cumple: opcionCumplida(option, v, option.id) }))
      .filter((row) => !soloIncumplimientos || !row.cumple)
      .sort((a, b) => Number(b.cumple) - Number(a.cumple))
    if (!rows.length) {
      textoLinea('No hay opciones para mostrar en este filtro.')
      return
    }
    const mostrarResponsables = rows.some((row) => !row.cumple)
    tabla(
      ['Estado', 'Descripción', ...(mostrarResponsables ? ['Responsable'] : [])],
      rows.map(({ option, cumple }) => {
        const descripcion = option.tipo_respuesta === 'RANGO'
          ? `${option.etiqueta}: ${v?.valores?.[option.id] ?? '—'}${option.unidad ? ` ${option.unidad}` : ''} (mín. ${option.minimo ?? '—'})`
          : option.etiqueta
        const responsables = cumple
          ? []
          : v?.responsablesPorOpcion?.[option.id]?.length
            ? v.responsablesPorOpcion[option.id]
            : v?.responsablesGerente
              ? [v.responsablesGerente]
              : option.responsables?.length
                ? option.responsables
                : option.responsable
                  ? [option.responsable]
                  : item.responsables ?? []
        return [cumple ? '✓' : 'X', descripcion, ...(mostrarResponsables ? [responsables.join(', ') || '—'] : [])]
      })
    )
  }

  const dibujarDetalleItem = (item: Item, valor: unknown) => {
    const itemAplicado = aplicarOpciones(item, opciones)
    const resultado = veredictoItem(itemAplicado, valor)
    const estado = resultado === 'cumple' ? 'CUMPLE' : resultado === 'no-cumple' ? 'NO CUMPLE' : resultado === 'no-aplica' ? 'NO APLICA' : 'SIN VEREDICTO'
    textoLinea(`${item.texto} — ${estado}`, { bold: true, gap: 1 })

    switch (item.tipo) {
      case 'CHECKLIST':
        checklist(itemAplicado, valor)
        break
      case 'CUMPLE_NO_CUMPLE': {
        const v = valor as ValorCumple | null
        const comentarios = (v?.evidencias ?? []).map((evidencia) => evidencia.comentario?.trim()).filter(Boolean)
        for (const comentario of comentarios) textoLinea(`• ${comentario}`)
        break
      }
      case 'CONCILIACION': {
        const v = valor as ValorConciliacion | null
        const precio = item.contra_dato === 'FINAL_BASE'
        const contraDato = item.contra_dato ?? 'SOH'
        const productos = (v?.productos ?? []).filter((product) => !soloIncumplimientos ||
          (typeof product.teorica === 'number' && typeof product.fisica === 'number' && product.teorica !== product.fisica))
        tabla(
          [
            precio ? 'Sistema' : 'Teórica',
            precio ? 'Hablador' : 'Física',
            'SKU',
            'Producto',
            'Estado',
            ...(!precio ? ['Pérdida estimada'] : [])
          ],
          productos.map((product) => {
            const porcentaje = conciliacionPorcentaje(product)
            const perdida = perdidaGuardadaConciliacion(product, contraDato)
            return [
              texto(product.teorica ?? '—'),
              texto(product.fisica ?? '—'),
              product.sku || '—',
              product.nombre || '—',
              porcentaje == null ? 'Sin datos' : `${fmt(porcentaje)}%`,
              ...(!precio ? [perdida == null ? '—' : formatearPrecioBase(perdida)] : [])
            ]
          })
        )
        if (!precio) {
          const resumenPerdida = resumenPerdidaConciliacion(v?.productos ?? [], contraDato)
          if (resumenPerdida.faltantesConPrecio + resumenPerdida.faltantesSinPrecio > 0) {
            textoLinea(
              `Pérdida estimada por faltantes: ${formatearPrecioBase(resumenPerdida.monto)}` +
              (resumenPerdida.faltantesSinPrecio > 0
                ? ` · ${resumenPerdida.faltantesSinPrecio} producto(s) sin precio base`
                : ''),
              { bold: true }
            )
          }
        }
        break
      }
      case 'LISTA_COLABORADORES': {
        const v = valor as ValorListaColaboradores | null
        const colaboradores = ordenarTrabajadores(v?.colaboradores ?? []).filter((col) => col.aplica)
          .filter((col) => !soloIncumplimientos || !colaboradorCumple(col, item.opciones ?? []))
        tabla(['Trabajador', 'Estado', 'Pendiente'], colaboradores.map((col) => {
          const aplican = opcionesAplicablesColaborador(col, item.opciones ?? [])
          const faltan = aplican.filter((option) => !(col.selected ?? []).includes(option.id))
          return [
            `${col.lastname} ${col.name}${col.role_name ? ` · ${col.role_name}` : ''}`,
            colaboradorCumple(col, item.opciones ?? []) ? 'Completo' : 'Incompleto',
            faltan.map((option) => option.etiqueta).join(', ') || '—'
          ]
        }))
        break
      }
      case 'UNIDAD_CHECKLIST': {
        const v = valor as ValorUnidadChecklist | null
        const unidades = (v?.unidades ?? []).filter((unidad) => !soloIncumplimientos || !unidadCumple(unidad, item.opciones ?? []))
        tabla(['Unidad', 'Estado', 'Puntos pendientes'], unidades.map((unidad) => {
          const faltan = (item.opciones ?? []).filter((option) => !(unidad.selected ?? []).includes(option.id))
          return [
            unidad.codigo,
            unidadCumple(unidad, item.opciones ?? []) ? 'Completa' : 'Incompleta',
            faltan.map((option) => option.etiqueta).join(', ') || '—'
          ]
        }))
        break
      }
      case 'PLANO_XY': {
        const v = valor as ValorPlano | null
        const puntos = (v?.puntos ?? []).filter((point) => !soloIncumplimientos || point.cumple === false)
        tabla(['Estado', 'Plano', 'Descripción'], puntos.map((point) => [
          point.cumple ? 'Cumple' : 'No cumple',
          v?.planos?.find((plano) => plano.id === point.planoId)?.nombre ?? '—',
          point.comentario || '—'
        ]))
        break
      }
    }
    y += 2
  }

  const dibujarModulo = (modulo: Modulo) => {
    if (y > alto - MARGEN - 10) {
      pdf.addPage()
      y = MARGEN
    }
    const puntaje = puntajeModulo(resumenDetalle, modulo.id, opcionesDeSucursal(resumenDetalle))
    tituloSeccion(`${modulo.nombre}${puntaje == null ? '' : ` — ${fmt(puntaje)}%`}`)
    const itemsModulo = itemsEnOrdenJerarquico(contenido.items.filter((item) => item.modulo_id === modulo.id))
    for (const raiz of raicesDeModulo(itemsModulo)) {
      if (raiz.tipo === 'CONTENEDOR') {
        const hijos = hijosOrdenados(itemsModulo, raiz.id)
        const instancias = contenido.instancias.filter((instance) => instance.item_id === raiz.id)
        for (const instancia of instancias) {
          const respuestasInstancia = hijos.map((hijo) => contenido.respuestas.find((respuesta) =>
            respuesta.item_id === hijo.id && respuesta.instancia_id === instancia.id
          )).filter((respuesta): respuesta is Respuesta => !!respuesta)
          if (!respuestasInstancia.length) continue
          textoLinea(`${raiz.texto} · ${instancia.etiqueta}`, { bold: true, gap: 2 })
          for (const respuesta of respuestasInstancia) {
            const item = hijos.find((child) => child.id === respuesta.item_id)
            if (item) dibujarDetalleItem(item, respuesta.valor)
          }
        }
      } else {
        const respuesta = contenido.respuestas.find((entry) => entry.item_id === raiz.id && !entry.instancia_id)
        if (respuesta) dibujarDetalleItem(raiz, respuesta.valor)
      }
    }
  }

  for (const modulo of contenido.modulos) dibujarModulo(modulo)
  if (ev.comentario_general?.trim()) {
    tituloSeccion('Comentario general')
    textoLinea(ev.comentario_general.trim())
  }

  pdf.addPage()
  y = MARGEN
  tituloSeccion('Resultados por cargo')
  const resultadosCargos = clasificarResultadosCargos(
    valorPorResponsable(
      resumenDetalle.items.map((item) => aplicarOpciones(item, opcionesResumen)),
      resumenDetalle.respuestas
    ),
    ev.sucursal?.branch_id === BRANCH_CENTRAL ? [] : catalogoCargos.sucursal,
    catalogoCargos.central
  )
  const puntosIncumplidosPorCargo = new Map<string, number>()
  for (const respuesta of resumenDetalle.respuestas) {
    const item = resumenDetalle.items.find((candidato) => candidato.id === respuesta.item_id)
    if (!item) continue
    for (const incumplimiento of incumplimientosPorResponsable(
      aplicarOpciones(item, opcionesResumen),
      respuesta.valor
    )) {
      puntosIncumplidosPorCargo.set(
        claveCargo(incumplimiento.responsable),
        (puntosIncumplidosPorCargo.get(claveCargo(incumplimiento.responsable)) ?? 0) + incumplimiento.puntos
      )
    }
  }
  const filasCargos = (resultados: ValorResponsable[]) => resultados.map((resultado) => [
    resultado.responsable,
    resultado.porciento == null ? 'Sin puntaje' : `${fmt(resultado.porciento)}%`,
    fmt(puntosIncumplidosPorCargo.get(claveCargo(resultado.responsable)) ?? 0)
  ])
  tituloSeccion('Cargos de la sucursal')
  if (resultadosCargos.sucursal.length) {
    tabla(['Cargo', 'Puntaje', 'Puntos incumplidos'], filasCargos(resultadosCargos.sucursal))
  } else {
    textoLinea('No hay cargos de la sucursal con resultados.')
  }
  pdf.addPage()
  y = MARGEN
  tituloSeccion('Cargos de central')
  if (resultadosCargos.central.length) {
    tabla(['Cargo', 'Puntaje', 'Puntos incumplidos'], filasCargos(resultadosCargos.central))
  } else {
    textoLinea('No hay cargos de central con resultados.')
  }

  pdf.addPage()
  y = MARGEN
  tituloSeccion('Incidencias registradas')
  tabla(
    ['Descripción', 'Responsable'],
    incidencias.length
      ? incidencias.map((incidencia) => [
          incidencia.descripcion,
          incidencia.responsables.map((responsable) => responsable.cargo).join(', ') || '—'
        ])
      : [['No hay incidencias registradas para esta evaluación.', '—']]
  )

  pdf.addPage()
  y = MARGEN
  tituloSeccion('Constancia de recibido y compromiso de respuesta')
  textoLinea(
    `La gerencia de ${texto(ev.sucursal?.nombre ?? 'la sucursal')} deja constancia de haber recibido el presente informe de evaluación, correspondiente a la visita realizada el ${fecha}.`,
    { size: 11, gap: 7 }
  )
  textoLinea(
    'La gerencia se compromete a revisar el documento, analizar las discrepancias detectadas durante la visita y emitir una respuesta sobre estas, indicando las aclaraciones y acciones de seguimiento que correspondan.',
    { size: 11, gap: 10 }
  )
  textoLinea(
    'La firma confirma la recepción del informe y el compromiso de revisión y respuesta. No implica conformidad con los resultados consignados.',
    { size: 9, gap: 7 }
  )
  textoLinea(
    'Si dentro de los quince (15) días siguientes a la fecha de recibido no se recibe una aclaratoria sobre las discrepancias detectadas, se tendrán por aceptados por la gerencia los datos emitidos en la evaluación.',
    { size: 9, gap: 12 }
  )

  tituloSeccion('Datos de recepción')
  const espacioColumnas = 14
  const anchoCampo = (anchoUtil - espacioColumnas) / 2
  const segundaColumna = MARGEN + anchoCampo + espacioColumnas
  const dibujarCampo = (etiqueta: string, x: number, lineaY: number, anchoLinea: number) => {
    pdf.setDrawColor(0)
    pdf.setLineWidth(0.25)
    pdf.line(x, lineaY, x + anchoLinea, lineaY)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(0)
    pdf.text(etiqueta, x, lineaY + 5)
  }
  dibujarCampo('Nombre de quien recibe por gerencia', MARGEN, y + 17, anchoCampo)
  dibujarCampo('Cargo', segundaColumna, y + 17, anchoCampo)
  dibujarCampo('Firma de gerencia', MARGEN, y + 62, anchoCampo)
  dibujarCampo('Fecha de recibido', segundaColumna, y + 62, anchoCampo)
  return pdf
}

export async function descargarInformePdf(id: string, filtro?: FiltroPdfCumplimiento): Promise<void> {
  const detalle = await obtenerEvaluacion(id)
  if (!detalle) throw new Error('No se encontró la evaluación.')
  const ids = Array.from(new Set(detalle.respuestas
    .map((respuesta) => respuesta.respondido_por)
    .filter((userId): userId is string => !!userId)))
  const [perfiles, incidenciasResult, cargosSucursal, cargosCentral] = await Promise.all([
    listarPerfilesSync(ids),
    supabase.from('incidencias')
      .select('descripcion, responsables')
      .eq('evaluacion_id', id)
      .order('created_at', { ascending: true }),
    detalle.evaluacion.sucursal?.branch_id && detalle.evaluacion.sucursal.branch_id !== BRANCH_CENTRAL
      ? listarResponsables([detalle.evaluacion.sucursal.branch_id])
      : Promise.resolve({ responsables: [], mensaje: null }),
    listarResponsables([BRANCH_CENTRAL])
  ])
  if (incidenciasResult.error) throw incidenciasResult.error
  const incidencias: IncidenciaPdf[] = (incidenciasResult.data ?? []).map((incidencia) => ({
    descripcion: incidencia.descripcion,
    responsables: normalizarResponsables(incidencia.responsables)
  }))
  const pdf = buildPdfDocument(detalle, filtro, perfiles, incidencias, {
    sucursal: cargosSucursal.responsables,
    central: cargosCentral.responsables
  })
  const sucursal = (detalle.evaluacion.sucursal?.nombre ?? 'evaluacion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  pdf.save(`informe-${sucursal || 'evaluacion'}-${detalle.evaluacion.fecha}.pdf`)
}
