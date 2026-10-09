import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { DetalleEvaluacion } from '../data/indicadores'
import { listarPerfilesSync, obtenerEvaluacion, resumirEvaluacion } from '../data/indicadores'
import {
  colaboradorCumple,
  conciliacionPorcentaje,
  esColaboradorRevisado,
  esSinHablador,
  estadoConciliacion,
  diferenciaConciliacion,
  totalesConciliacion,
  formatearMontoPerdida,
  formatearPrecioBase,
  montoSobranteConciliacion,
  perdidaGuardadaConciliacion,
  resumenPerdidaConciliacion,
  conSeccionesPonderadas,
  incumplimientosPorResponsable,
  opcionCumplida,
  opcionesAplicablesColaborador,
  agruparPorDepartamento,
  productosParaConciliar,
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
import { imprimeBloque, imprimeCargos, imprimeModulo, imprimePortada, type OpcionesPdf } from './opciones'

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
/**
 * El informe es monocromo salvo por la pérdida: el rojo es lo único que separa
 * "mercadería que hay que buscar" de "plata que se está perdiendo", y por eso no
 * se usa en las filas, solo en el cierre.
 */
const ROJO_PERDIDA: [number, number, number] = [178, 34, 34]
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

/**
 * `impresion` en `undefined` = informe entero, que es como se llamaba antes de
 * que existiera el selector. Ver `opciones.ts` para qué los puntajes no cambian
 * aunque se desmarquen módulos. Se llama así y no `opciones` porque en este
 * archivo `opciones` ya es otra cosa: las opciones de ítem que la sucursal
 * habilitó.
 */
export function buildPdfDocument(
  detalle: DetalleEvaluacion,
  filtro?: FiltroPdfCumplimiento,
  perfiles: Readonly<Record<string, { nombre: string; rol?: keyof typeof ETIQUETAS_ROL }>> = {},
  incidencias: IncidenciaPdf[] = [],
  catalogoCargos: { sucursal: ResponsableCatalogo[]; central: ResponsableCatalogo[] } = { sucursal: [], central: [] },
  impresion?: OpcionesPdf
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

  const textoLinea = (value: string, options: { bold?: boolean; size?: number; gap?: number; color?: [number, number, number] } = {}) => {
    const size = options.size ?? TAMANO_FUENTE
    pdf.setFont('helvetica', options.bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    const [r, g, b] = options.color ?? [0, 0, 0]
    pdf.setTextColor(r, g, b)
    const lineas = pdf.splitTextToSize(value, anchoUtil) as string[]
    const altoLinea = size * 0.42
    if (y + lineas.length * altoLinea > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    pdf.text(lineas, MARGEN, y)
    y += lineas.length * altoLinea + (options.gap ?? 2)
  }

  /**
   * Una línea hecha de tramos, cada uno con su color.
   *
   * Sirve para el cierre de la conciliación, que tiene que dejar en una sola
   * línea dos cosas que no se deben leer igual: el sobrante, que es mercadería que
   * hay que ir a buscar, y el faltante con su plata, que es pérdida. Puesto que
   * el rojo marca plata perdida, tiene que ser solo del faltante: si el rojo se
   * repite en la pérdida estimada de cada fila, el número grande de abajo deja de
   * decir "esto es lo que te cuesta" y pasa a ser decoración.
   *
   * jsPDF no pinta dos colores dentro de un mismo `text`, así que se mide cada
   * tramo y se dibuja el siguiente justo donde terminó el anterior. Si la línea
   * completa no entra en el ancho útil —con muchos dígitos y muchos miles de
   * unidades pasa— se cae a `textoLinea` en negro: es peor que perder el color
   * que perder el texto en el borde de la hoja.
   */
  const textoLineaTrozos = (
    trozos: { texto: string; color?: [number, number, number] }[],
    options: { bold?: boolean; size?: number; gap?: number } = {}
  ) => {
    const size = options.size ?? TAMANO_FUENTE
    const anchoTotal = trozos.reduce((suma, trozo) => suma + pdf.getTextWidth(trozo.texto), 0)
    if (anchoTotal > anchoUtil) {
      textoLinea(trozos.map((trozo) => trozo.texto).join(' '), options)
      return
    }
    pdf.setFont('helvetica', options.bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    const altoLinea = size * 0.42
    if (y + altoLinea > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    let x = MARGEN
    for (const trozo of trozos) {
      const [r, g, b] = trozo.color ?? [0, 0, 0]
      pdf.setTextColor(r, g, b)
      pdf.text(trozo.texto, x, y)
      x += pdf.getTextWidth(trozo.texto)
    }
    y += altoLinea + (options.gap ?? 2)
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

  /**
   * Una fila puede ser un texto suelto o una celda con `colSpan`, que es como se
   * dibuja el encabezado de departamento: ocupa la fila entera y se lee como un
   * título, no como el nombre de la primera columna.
   */
  type CeldaTabla = string | { content: string; colSpan?: number; styles?: Record<string, unknown> }

  const tabla = (headers: string[], rows: CeldaTabla[][], columnaFirma?: number) => {
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
  const nombreDelFiltro = filtro === 'cumple' ? 'Cumple' : filtro === 'ambos' ? 'Ambos' : 'No cumple'

  // La portada es la primera hoja y resume la evaluación entera: los datos de la
  // tienda, la puntuación general, el personal evaluador y el gráfico de barras
  // con todos los módulos. Si el informe va parcial, no se imprime: quedaría un
  // total y un gráfico dando por completos módulos que en el papel no están.
  const conPortada = imprimePortada(impresion, resumenDetalle.modulos.map((modulo) => modulo.id))

  if (conPortada) {
    tituloSeccion('Datos de la tienda')
    // Una evaluación mide una sola unidad: sucursal o departamento. Si es de
    // departamento no hay código de tienda ni dirección que imprimir.
    const filasUnidad: string[][] = ev.departamento
      ? [['Departamento', texto(ev.departamento.nombre ?? '—')]]
      : [
          ['Sucursal', texto(ev.sucursal?.nombre ?? '—')],
          ['Código de tienda', texto(ev.sucursal?.shop_id ?? '—')],
          ['Dirección', texto(ev.sucursal?.direccion ?? '—')]
        ]
    tabla(['Dato de la tienda', 'Información'], [
      ['Código de evaluación', ocultarCentroCodigoEvaluacion(ev.id)],
      ...filasUnidad,
      ['Fecha de evaluación', fecha],
      ...(filtro ? [['Filtro del informe', nombreDelFiltro]] : [])
    ])
    tituloSeccion('Puntuación general')
    textoLinea(resumen.puntaje == null ? 'Sin puntaje' : `${fmt(resumen.puntaje)}%`, { bold: true, gap: 3 })

    // Solo la cuenta del personal evaluador, y solo para la portada. Va adentro a
    // propósito: es un recorrido por todas las respuestas buscando el ítem de cada
    // una, y sin portada no hay a quién mostrárselo.
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
  }

  // Sin portada el detalle arranca directo en la primera hoja: no se saca una hoja
  // para dejarla vacía. El filtro, en cambio, se avisa igual porque sin la portada
  // es el único lugar donde cabe.
  if (conPortada) {
    pdf.addPage()
    y = MARGEN
  } else if (filtro) {
    // El aviso de que el informe viene recortado ("solo lo que no se cumplió") es
    // el dato que más importa para leer el papel. Vivía en la tabla de la portada,
    // así que sin portada se perdía en silencio: un recorte se lee igual que el
    // resultado completo.
    tituloSeccion('Filtro del informe')
    textoLinea(nombreDelFiltro, { bold: true, gap: 3 })
  }

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
        // El número con el que se compara es el que sale en la fila, con dos decimales:
        // si la pantalla lee "Concilia", el informe no puede decir "Faltan 0,003".
        // Agrupado por departamento, igual que la pantalla: el informe lo lee
        // quien va a contar, y cuenta recorriendo la góndola.
        const productos = productosParaConciliar(v?.productos, contraDato).filter((product) => !soloIncumplimientos ||
          esSinHablador(product) ||
          (typeof product.teorica === 'number' && typeof product.fisica === 'number' && product.teorica !== product.fisica))
        const grupos = agruparPorDepartamento(productos, contraDato).filter((grupo) => grupo.productos.length)
        const columnas = precio ? 5 : 6
        // El encabezado de departamento solo si hay más de un grupo: con uno solo
        // es una fila de ruido repetida por cada producto.
        const conRotulos = grupos.length > 1
        const filas: CeldaTabla[][] = []
        for (const grupo of grupos) {
          if (conRotulos) {
            // La pérdida del departamento va en el mismo encabezado, por la misma
            // cuenta que la del pie pero solo sobre los productos de este grupo.
            // Quien lee el informe compara el total contra la suma de los rótulos, y
            // tiene que cuadrar.
            const perdidaGrupo = resumenPerdidaConciliacion(grupo.productos, contraDato).monto
            filas.push([{
              content: perdidaGrupo > 0
                ? `${grupo.departamento ?? 'Sin departamento'} · Pérdida ${formatearPrecioBase(perdidaGrupo)}`
                : grupo.departamento ?? 'Sin departamento',
              colSpan: columnas,
              styles: { fontStyle: 'bold', fillColor: [240, 240, 240], minCellHeight: 15 }
            }])
          }
          filas.push(...grupo.productos.map((product): CeldaTabla[] => {
            const porcentaje = conciliacionPorcentaje(product)
            const perdida = perdidaGuardadaConciliacion(product, contraDato)
            const estado = estadoConciliacion(product)
            const dice = diferenciaConciliacion(product)
            // El estado va escrito, no solo el porcentaje: las filas están
            // ordenadas por gravedad y el lector tiene que poder ver por qué.
            const etiquetaEstado = esSinHablador(product)
              ? 'No Match · sin hablador'
              : estado === 'falta'
                ? `Faltan ${precio ? formatearPrecioBase(dice) : fmt(dice)}`
                : estado === 'sobra'
                  ? `Sobran ${precio ? formatearPrecioBase(dice) : fmt(dice)}`
                  : estado === 'concilia'
                    ? 'Concilia'
                    : 'Sin datos'
            return [
              // En precio, el monto con signo de plata y dos decimales, igual que
              // en la pantalla. En cantidades, la unidad pelada.
              precio ? formatearPrecioBase(product.teorica) : texto(product.teorica ?? '—'),
              esSinHablador(product)
                ? 'Sin hablador'
                : precio ? formatearPrecioBase(product.fisica) : texto(product.fisica ?? '—'),
              // El id del producto en la API viaja junto al código escaneado: en
              // papel no hay badge ni detalle donde buscarlo y es con lo que se
              // cruza el producto contra el sistema.
              product.apiId != null ? `${product.sku || '—'} · ID ${product.apiId}` : product.sku || '—',
              product.nombre || '—',
              porcentaje == null ? etiquetaEstado : `${etiquetaEstado} · ${fmt(porcentaje)}%`,
              ...(!precio
                ? [
                    estado === 'falta' && perdida != null
                      ? formatearPrecioBase(perdida)
                      : estado === 'sobra'
                        ? (() => {
                            const sobrante = montoSobranteConciliacion(product, contraDato)
                            return sobrante == null
                              ? 'Sobrante sin precio'
                              : `Sobrante ${formatearPrecioBase(sobrante)}`
                          })()
                        : '—'
                  ]
                : [])
            ]
          }))
        }
        tabla(
          [
            precio ? 'Sistema' : 'Teórica',
            precio ? 'Hablador' : 'Física',
            'SKU',
            'Producto',
            'Estado',
            ...(!precio ? ['Pérdida estimada'] : [])
          ],
          filas
        )
        if (!precio) {
          const resumenPerdida = resumenPerdidaConciliacion(v?.productos ?? [], contraDato)
          const totales = totalesConciliacion(v?.productos ?? [])
          const hayPerdida = resumenPerdida.faltantesConPrecio + resumenPerdida.faltantesSinPrecio > 0
          if (hayPerdida || totales.unidadesFaltantes || totales.unidadesSobrantes) {
            // Mismo corte que la pantalla: el desglose de SKU arriba y después cada
            // lado en su propia línea, sobrante y faltante con su plata, cerrando
            // con la pérdida absoluta. El sobrante no es plata perdida: se valora
            // al PVP solo para poder sumarlo, y el rojo queda para la pérdida.
            const linea = (texto: string, color?: [number, number, number]) => textoLineaTrozos([{ texto, color }], { bold: true })
            const conFaltante = productos.filter((product) => estadoConciliacion(product) === 'falta').length
            const conSobrante = productos.filter((product) => estadoConciliacion(product) === 'sobra').length
            if (productos.length) {
              linea([
                `${productos.length} SKU escaneados`,
                `${conFaltante} SKU con faltante (${Math.round((conFaltante / productos.length) * 100)}%)`,
                `${conSobrante} SKU con sobrante (${Math.round((conSobrante / productos.length) * 100)}%)`
              ].join(' | '))
            }
            if (totales.unidadesSobrantes) {
              linea(
                resumenPerdida.sobrantesConPrecio > 0
                  ? `${fmt(totales.unidadesSobrantes)} unidades sobrantes con un valor estimado de ${formatearMontoPerdida(resumenPerdida.montoSobrantes)}`
                  : `${fmt(totales.unidadesSobrantes)} unidades sobrantes`
              )
            }
            if (totales.unidadesFaltantes) {
              linea(
                resumenPerdida.monto > 0
                  ? `${fmt(totales.unidadesFaltantes)} unidades faltantes con un valor estimado de ${formatearMontoPerdida(resumenPerdida.monto)}`
                  : `${fmt(totales.unidadesFaltantes)} unidades faltantes`,
                ROJO_PERDIDA
              )
            } else if (hayPerdida) {
              linea(`Pérdida estimada ${formatearMontoPerdida(resumenPerdida.monto)}`, ROJO_PERDIDA)
            }
            if (resumenPerdida.monto > 0 || resumenPerdida.montoSobrantes > 0) {
              linea(`Pérdida absoluta: ${formatearMontoPerdida(resumenPerdida.monto + resumenPerdida.montoSobrantes)}`, ROJO_PERDIDA)
            }
            if (resumenPerdida.faltantesSinPrecio + resumenPerdida.sobrantesSinPrecio) {
              linea(`${resumenPerdida.faltantesSinPrecio + resumenPerdida.sobrantesSinPrecio} producto(s) sin precio base`)
            }
          }
        }
        break
      }
      case 'LISTA_COLABORADORES': {
        const v = valor as ValorListaColaboradores | null
        // Solo los revisados: el PDF tiene que contar la misma gente que cuenta el
        // puntaje. Si aparecieran los veinte destildados como "Incompleto", el
        // informe contradiría al tablero que dice que no entran.
        const enCuenta = ordenarTrabajadores(v?.colaboradores ?? []).filter((col) => col.aplica)
        const enPuntaje = enCuenta.filter(esColaboradorRevisado)
        const sinRevisar = enCuenta.length - enPuntaje.length
        const colaboradores = enPuntaje.filter((col) => !soloIncumplimientos || !colaboradorCumple(col, item.opciones ?? []))
        tabla(['Trabajador', 'Estado', 'Pendiente'], colaboradores.map((col) => {
          const aplican = opcionesAplicablesColaborador(col, item.opciones ?? [])
          const faltan = aplican.filter((option) => !(col.selected ?? []).includes(option.id))
          return [
            `${col.lastname} ${col.name}${col.role_name ? ` · ${col.role_name}` : ''}`,
            colaboradorCumple(col, item.opciones ?? []) ? 'Completo' : 'Incompleto',
            faltan.map((option) => option.etiqueta).join(', ') || '—'
          ]
        }))
        if (sinRevisar) {
          textoLinea(`${sinRevisar} trabajador(es) sin revisar: no evaluados y fuera del puntaje de este ítem.`, { size: 8, gap: 4 })
        }
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

  for (const modulo of contenido.modulos) {
    if (imprimeModulo(impresion, modulo.id)) dibujarModulo(modulo)
  }
  if (ev.comentario_general?.trim()) {
    tituloSeccion('Comentario general')
    textoLinea(ev.comentario_general.trim())
  }

  // Cada bloque del final arranca en su propia página. El salto va dentro de
  // cada bloque y no entre medio: si uno está apagado, el siguiente hace su
  // propio salto y no queda una hoja en blanco entre los que sí se imprimen.
  const nuevaPagina = () => {
    pdf.addPage()
    y = MARGEN
  }

  /**
   * Pie de página: de qué sucursal es y de qué fecha es, en todas las hojas.
   *
   * Va al final del documento y no al principio porque recién ahí se sabe cuántas
   * hojas quedaron. Se dibuja con `setPage` sobre cada una, que es la única
   * forma de escribir en una hoja que ya estaba cerrada: el resto del documento
   * escribe solo en la hoja en curso.
   *
   * Va en 7 pt y gris claro, abajo de todo: es un dato de referencia para cuando
   * el papel se separa del resto, no algo que compita con el contenido. Por eso
   * queda por debajo del área útil, que termina en `alto - MARGEN`.
   *
   * El separador es una barra y no un punto medio a propósito: `jspdf` escribe
   * los textos con las fuentes estándar en WinAnsi, sin pasar los acentos por
   * UTF-8, así que un `·` sale corrupto en el papel. La barra es ASCII y se ve
   * igual en cualquier impresora.
   */
  const pieEnTodasLasHojas = () => {
    const pie = `${ev.departamento?.nombre ?? ev.sucursal?.nombre ?? 'Sucursal'} | ${fecha}`
    for (let hoja = 1; hoja <= pdf.getNumberOfPages(); hoja++) {
      pdf.setPage(hoja)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.setTextColor(130, 140, 150)
      pdf.text(pie, MARGEN, alto - 7)
    }
  }

  // Los cargos se reparten entre sucursal y central, y para eso hacen falta los
  // dos catálogos: con el de la sucursal se reconoce cuáles cargos son de la
  // tienda, y lo que no es de la tienda se presume de central. Si ningún bloque
  // de cargos va al informe, no se calcula nada: son dos vueltas sobre todas las
  // respuestas, y el detalle de los incumplimientos solo lo usa esa tabla.
  let resultadosCargos: { sucursal: ValorResponsable[]; central: ValorResponsable[] } = { sucursal: [], central: [] }
  const puntosIncumplidosPorCargo = new Map<string, number>()
  if (imprimeCargos(impresion)) {
    resultadosCargos = clasificarResultadosCargos(
      valorPorResponsable(
        resumenDetalle.items.map((item) => aplicarOpciones(item, opcionesResumen)),
        resumenDetalle.respuestas
      ),
      ev.sucursal?.branch_id === BRANCH_CENTRAL ? [] : catalogoCargos.sucursal,
      catalogoCargos.central
    )
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
  }
  const filasCargos = (resultados: ValorResponsable[]) => resultados.map((resultado) => [
    resultado.responsable,
    resultado.porciento == null ? 'Sin puntaje' : `${fmt(resultado.porciento)}%`,
    fmt(puntosIncumplidosPorCargo.get(claveCargo(resultado.responsable)) ?? 0)
  ])

  if (imprimeBloque(impresion, 'cargosSucursal')) {
    nuevaPagina()
    tituloSeccion('Cargos de la sucursal')
    const resultados = resultadosCargos.sucursal
    if (resultados.length) {
      tabla(['Cargo', 'Puntaje', 'Puntos incumplidos'], filasCargos(resultados))
    } else {
      textoLinea('No hay cargos de la sucursal con resultados.')
    }
  }
  if (imprimeBloque(impresion, 'cargosCentral')) {
    nuevaPagina()
    tituloSeccion('Cargos de central')
    const resultados = resultadosCargos.central
    if (resultados.length) {
      tabla(['Cargo', 'Puntaje', 'Puntos incumplidos'], filasCargos(resultados))
    } else {
      textoLinea('No hay cargos de central con resultados.')
    }
  }

  if (imprimeBloque(impresion, 'incidencias')) {
    nuevaPagina()
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
  }

  if (!imprimeBloque(impresion, 'compromiso')) {
    pieEnTodasLasHojas()
    return pdf
  }

  nuevaPagina()
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
  pieEnTodasLasHojas()
  return pdf
}

/**
 * `impresion` en `undefined` = informe entero. Cuando viene, no se piden las
 * cosas que no se van a pintar: sin el bloque de incidencias no hace falta la
 * consulta, y sin ninguno de cargos no hacen falta los dos catálogos. Los
 * nombres de los evaluadores se piden siempre porque van en la cabecera, que no
 * se apaga.
 */
export async function descargarInformePdf(
  id: string,
  filtro?: FiltroPdfCumplimiento,
  impresion?: OpcionesPdf
): Promise<void> {
  const detalle = await obtenerEvaluacion(id)
  if (!detalle) throw new Error('No se encontró la evaluación.')
  const ids = Array.from(new Set(detalle.respuestas
    .map((respuesta) => respuesta.respondido_por)
    .filter((userId): userId is string => !!userId)))
  const branchId = detalle.evaluacion.sucursal?.branch_id
  const [perfiles, incidenciasResult, cargosSucursal, cargosCentral] = await Promise.all([
    listarPerfilesSync(ids),
    imprimeBloque(impresion, 'incidencias')
      ? supabase.from('incidencias')
          .select('descripcion, responsables')
          .eq('evaluacion_id', id)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    imprimeCargos(impresion) && branchId && branchId !== BRANCH_CENTRAL
      ? listarResponsables([branchId])
      : Promise.resolve({ responsables: [], mensaje: null }),
    imprimeCargos(impresion) ? listarResponsables([BRANCH_CENTRAL]) : Promise.resolve({ responsables: [], mensaje: null })
  ])
  if (incidenciasResult.error) throw incidenciasResult.error
  const incidencias: IncidenciaPdf[] = (incidenciasResult.data ?? []).map((incidencia) => ({
    descripcion: incidencia.descripcion,
    responsables: normalizarResponsables(incidencia.responsables)
  }))
  const pdf = buildPdfDocument(detalle, filtro, perfiles, incidencias, {
    sucursal: cargosSucursal.responsables,
    central: cargosCentral.responsables
  }, impresion)
  const sucursal = (detalle.evaluacion.sucursal?.nombre ?? 'evaluacion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  pdf.save(`informe-${sucursal || 'evaluacion'}-${detalle.evaluacion.fecha}.pdf`)
}
