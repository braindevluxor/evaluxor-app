/**
 * Explicación de un módulo, en PDF (botón «Explicación del módulo» del
 * dashboard del módulo): qué mide y cómo se mide.
 *
 * A diferencia del reporte de resultados (`reporteModulo.ts`), este documento no
 * mira evaluaciones: sale del catálogo (el módulo y sus ítems activos), así que
 * no lleva fechas, sucursales ni puntajes. Sirve para entrenar a un evaluador
 * nuevo o para mandar a gerencia la metodología antes de la visita.
 *
 * Cuatro bloques, en el orden en que se leen:
 *
 *   1. LOS DATOS DEL MÓDULO: descripción, cuántos ítems tiene y cómo cierran
 *      los pesos.
 *   2. CÓMO SE CALCULA EL PUNTAJE: la regla general (peso x cumplimiento), las
 *      secciones, el «no aplica» y los veredictos.
 *   3. EL DETALLE DE CADA ÍTEM, en el orden en que se responde (sección y
 *      después sus hijos): qué mide, cómo se mide y —cuando el ítem tiene
 *      lista— la tabla de sus puntos.
 *   4. LA COMPOSICIÓN DEL 100% DEL MÓDULO: cuadro resumen que detalla cuánto
 *      aporta cada ítem individual para formar la nota total.
 *
 * Las descripciones de "cómo se mide" salen de la misma configuración que
 * usa la evaluación (tipo, contra dato, doble check, permisos, puntos
 * propios), así que el papel nunca contradice a la pantalla.
 *
 * Composición: la familia visual de `composicion.ts` — banda de marca arriba,
 * títulos en marino con regla suave y tablas con cabecera coloreada y filas
 * alternadas, no negro sobre blanco con rejilla.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Item, Opcion } from '../types'
import {
  ETIQUETAS_CONTRA_DATO,
  etiquetaTipo,
  pesoItem,
  responsablesDeOpcion
} from '../scoring'
import { itemsEnOrdenJerarquico } from '../hierarchy'
import {
  ESTILO_TABLA,
  MARGEN,
  pintarBanda,
  pintarTextoLinea,
  pintarTituloSeccion,
  type Geometria
} from './composicion'
import { formatoFecha, MARINO } from './graficos'
import { ponerLogoAlPie, xTextoDelPie } from './marcaPie'

export interface ExplicacionModuloDatos {
  moduloNombre: string
  /** Descripción del módulo en Config (puede venir vacía). */
  moduloDescripcion?: string | null
  /** Ítems activos del módulo, secciones incluidas. El orden lo pone el PDF. */
  items: Item[]
}

const fmtNum = (n: number): string => (Number.isInteger(n) ? `${n}` : `${Math.round(n * 100) / 100}`)

/** Filtro del listado de trabajadores, en palabras. */
const FILTRO_COLABORADORES: Record<string, string> = {
  ACTIVOS: 'los trabajadores activos',
  INACTIVOS: 'los trabajadores inactivos',
  TODOS: 'todos los trabajadores de la unidad'
}

/**
 * Peso del ítem como texto, diferenciando si es de primer nivel (módulo) o hijo de una sección.
 */
export function textoPeso(
  item: Item,
  padre?: Item | null,
  sumaHermanos = 0,
  sumaRaiz = 0
): string {
  const peso = pesoItem(item)
  if (peso <= 0) {
    return padre
      ? `Sin peso propio (se promedia dentro de "${padre.texto}")`
      : 'Sin peso propio (el módulo lo promedia)'
  }

  // Si es un ítem dentro de una sección (hijo)
  if (padre) {
    if (sumaHermanos > 0) {
      const pctEnSeccion = Math.round((peso / sumaHermanos) * 1000) / 10
      return sumaHermanos === 100
        ? `${fmtNum(peso)}% de la sección "${padre.texto}"`
        : `${fmtNum(peso)} pts en la sección "${padre.texto}" (${fmtNum(pctEnSeccion)}% del grupo)`
    }
    return `${fmtNum(peso)} pts en la sección "${padre.texto}"`
  }

  // Si es una sección (CONTENEDOR) de primer nivel
  if (item.tipo === 'CONTENEDOR') {
    if (sumaRaiz > 0 && sumaRaiz !== 100) {
      const pctEfectivo = Math.round((peso / sumaRaiz) * 1000) / 10
      return `${fmtNum(peso)} pts del módulo (${fmtNum(pctEfectivo)}% efectivo, repartido entre sus ítems)`
    }
    return `${fmtNum(peso)}% del módulo (repartido entre sus ítems)`
  }

  // Si es un ítem suelto de primer nivel
  if (sumaRaiz > 0 && sumaRaiz !== 100) {
    const pctEfectivo = Math.round((peso / sumaRaiz) * 1000) / 10
    return `${fmtNum(peso)} pts del módulo (${fmtNum(pctEfectivo)}% efectivo)`
  }
  return `${fmtNum(peso)}% del módulo`
}

/**
 * Resumen legible de cómo cierran los pesos del módulo para la tabla inicial.
 */
export function resumenPesosModulo(items: Item[]): string {
  const secciones = items.filter((i) => i.tipo === 'CONTENEDOR')
  const elementosRaiz = items.filter((i) => !i.padre_id)
  const raizConPeso = elementosRaiz.filter((i) => pesoItem(i) > 0)
  const sumaRaiz = raizConPeso.reduce((a, i) => a + pesoItem(i), 0)

  // Si ningún elemento de primer nivel tiene peso:
  if (!raizConPeso.length) {
    const hijosConPeso = items.filter((i) => i.padre_id && pesoItem(i) > 0)
    if (hijosConPeso.length) {
      return 'Los ítems ponderan dentro de sus secciones; el módulo promedia las secciones.'
    }
    return 'Ningún ítem tiene peso: el módulo promedia todos sus ítems por igual'
  }

  const cantSeccionesConPeso = raizConPeso.filter((i) => i.tipo === 'CONTENEDOR').length
  const cantSueltosConPeso = raizConPeso.filter((i) => i.tipo !== 'CONTENEDOR').length

  const descripcionPartes: string[] = []
  if (cantSeccionesConPeso > 0) {
    descripcionPartes.push(`${cantSeccionesConPeso} ${cantSeccionesConPeso === 1 ? 'sección' : 'secciones'}`)
  }
  if (cantSueltosConPeso > 0) {
    descripcionPartes.push(`${cantSueltosConPeso} ${cantSueltosConPeso === 1 ? 'ítem suelto' : 'ítems sueltos'}`)
  }
  const sujeto = descripcionPartes.join(' y ')

  if (sumaRaiz === 100) {
    return `${sujeto} ${raizConPeso.length === 1 ? 'suma' : 'suman'} el 100% del módulo${secciones.length ? ' (los ítems ponderan dentro de su sección)' : ''}`
  }

  return `${sujeto} ${raizConPeso.length === 1 ? 'suma' : 'suman'} ${fmtNum(sumaRaiz)} pts (el sistema normaliza automáticamente a escala 0–100%)`
}

/** Cómo se evalúa un punto suelto de una lista (checklist o unidad). */
export function comoSeEvaluaPunto(item: Item, opcion: Opcion): string {
  if (opcion.tipo_respuesta === 'RANGO') {
    const minimo = typeof opcion.minimo === 'number' ? fmtNum(opcion.minimo) : '—'
    const tope = typeof opcion.maximo === 'number' && opcion.maximo > 0 ? ` (la barra llega a ${fmtNum(opcion.maximo)})` : ''
    return `Valor numérico: cumple desde ${minimo}${opcion.unidad ? ` ${opcion.unidad}` : ''}${tope}`
  }
  return item.doble_check
    ? 'Doble marca: primero «Existe» (está en el área) y después «Correcto» (vigente o en funcionamiento); sólo con las dos cumple'
    : 'Marca simple: se marca cuando el punto está cumplido'
}

/**
 * Qué mide y cómo se mide un ítem, en frases armadas desde su configuración.
 * Devuelve un párrafo por idea, para que el PDF pueda partir línea por línea.
 */
export function comoSeMide(item: Item): string[] {
  const lineas: string[] = []
  switch (item.tipo) {
    case 'CHECKLIST': {
      const opciones = item.opciones ?? []
      lineas.push(
        `Lista de ${opciones.length || 'varios'} puntos que se verifican uno a uno en el área. El ítem puntúa la fracción de puntos cumplidos: si todos los puntos llevan puntos propios, el reparto respeta esos puntos; si no, todos pesan lo mismo.`
      )
      if (opciones.some((o) => o.tipo_respuesta === 'RANGO')) {
        lineas.push('Los puntos de tipo valor se registran como número y sólo cumplen si alcanzan su mínimo aceptable.')
      }
      if (item.permisos_sucursal) {
        lineas.push(
          `La lista no se escribe a mano: se arma en cada evaluación desde ${item.permisos_sucursal === 'VENCIDOS' ? 'los permisos ya vencidos' : 'los permisos vigentes'} de la unidad, contra la fecha del día. Un permiso vencido nunca puede quedar cumplido.`
        )
      }
      break
    }
    case 'CUMPLE_NO_CUMPLE':
      lineas.push(
        'Respuesta única: cumple o no cumple, con evidencia fotográfica y comentario. Cumple aporta el 100% del peso del ítem y no cumple el 0%.'
      )
      break
    case 'CONCILIACION': {
      const contraDato = ETIQUETAS_CONTRA_DATO[item.contra_dato ?? 'SOH']
      lineas.push(
        contraDato === ETIQUETAS_CONTRA_DATO.FINAL_BASE
          ? 'Conciliación por precio: se escanean los SKU de la góndola y la teórica es el precio de la etiqueta (hablador) contra el precio de venta del sistema. Un producto sin hablador se registra sin precio y cuenta como descuadre.'
          : 'Conciliación por conteo: se escanean los SKU de la góndola y la teórica es el stock del sistema contra la cantidad que se cuenta en el anaquel.'
      )
      lineas.push(
        'Por cada SKU se compara teórica contra física y se marca la diferencia (falta o sobra), con la pérdida estimada en plata. El ítem sólo cumple cuando todos los SKU escaneados cuadran.'
      )
      break
    }
    case 'LISTA_COLABORADORES': {
      const opciones = (item.opciones ?? []) as { puntos?: number }[]
      const conPuntos = opciones.length > 0 && opciones.every((o) => typeof o.puntos === 'number' && o.puntos > 0)
      lineas.push(
        conPuntos
          ? `Se revisa a ${FILTRO_COLABORADORES[item.colaboradores_filtro ?? 'ACTIVOS'] ?? 'cada trabajador'} contra la lista de requisitos, requisito por requisito con su peso en puntos. El puntaje es el promedio, trabajador por trabajador, de los puntos obtenidos sobre los aplicables (quien no se revisa no entra en el cálculo); así un requisito pesado mueve más la aguja que uno menor.`
          : `Se revisa a ${FILTRO_COLABORADORES[item.colaboradores_filtro ?? 'ACTIVOS'] ?? 'cada trabajador'} contra la lista de requisitos, requisito por requisito. El puntaje es por trabajador: los revisados que quedaron completos sobre los revisados. Quien no se revisa no entra en el cálculo.`
      )
      break
    }
    case 'UNIDAD_CHECKLIST':
      lineas.push(
        `Checklist que se repite${item.repetible === false ? ' una sola vez' : ' una vez por unidad (carretilla, nevera, equipo)'}: cada carga tiene sus propios puntos marcados contra la misma lista. El ítem sólo cumple cuando todas las unidades cargadas quedan completas.`
      )
      break
    case 'PLANO_XY':
      lineas.push(
        'Cumplimiento XY: el evaluador sube el plano del área y marca un punto (pin) por cada lugar a revisar, con su veredicto. El puntaje es la fracción de pines que cumplen sobre los marcados; los pines sin marcar no cuentan.'
      )
      break
    case 'CONTENEDOR':
      lineas.push(
        'Sección que agrupa ítems. No se responde ni puntúa por sí sola: vale por el cumplimiento de sus hijos, que reparten el peso de la sección.'
      )
      if (item.api_id) {
        lineas.push(
          `Los registros del grupo se cargan desde ${item.api_id} y cada registro repite el mismo bloque de ítems de la sección (por ejemplo, un vehículo por registro).`
        )
      }
      break
    default:
      lineas.push(`Ítem de tipo ${etiquetaTipo(item.tipo)}.`)
  }
  if (item.tipo !== 'CONTENEDOR') {
    lineas.push('Puede marcarse como No aplica: en ese caso queda fuera del cálculo, ni suma ni resta.')
  }
  return lineas
}

/** Filas de la tabla de puntos de un ítem con lista (checklist o unidad). */
export function filasPuntos(item: Item): string[][] {
  return (item.opciones ?? []).map((opcion) => [
    opcion.etiqueta || '—',
    comoSeEvaluaPunto(item, opcion),
    typeof opcion.puntos === 'number' ? fmtNum(opcion.puntos) : '—',
    responsablesDeOpcion(opcion).join(', ') || '—'
  ])
}

export interface FilaComposicionItem {
  orden: number
  texto: string
  seccion: string
  tipo: string
  puntosConfigurados: string
  pesoEnSeccion: string
  pesoEfectivoModulo: number
}

/**
 * Calcula la composición porcentual efectiva de cada ítem evaluable para sumar el 100% del módulo.
 * Respeta la misma matemática de ponderación que `scoring.ts`.
 */
export function calcularComposicionModulo(items: Item[]): {
  filas: FilaComposicionItem[]
  sumaTotalPct: number
} {
  const ordenados = itemsEnOrdenJerarquico(items)
  const evaluables = ordenados.filter((i) => i.tipo !== 'CONTENEDOR')
  if (!evaluables.length) {
    return { filas: [], sumaTotalPct: 0 }
  }

  const secciones = ordenados.filter((i) => i.tipo === 'CONTENEDOR')
  const seccionesPorId = new Map(secciones.map((s) => [s.id, s]))

  const hijosPorPadre = new Map<string, Item[]>()
  for (const it of ordenados) {
    if (it.padre_id && it.tipo !== 'CONTENEDOR') {
      const arr = hijosPorPadre.get(it.padre_id) ?? []
      arr.push(it)
      hijosPorPadre.set(it.padre_id, arr)
    }
  }

  const seccionIdsPonderadas = new Set<string>()
  for (const s of secciones) {
    if (s.id && pesoItem(s) > 0 && (hijosPorPadre.get(s.id) ?? []).length > 0) {
      seccionIdsPonderadas.add(s.id)
    }
  }

  const modoPonderado =
    seccionIdsPonderadas.size > 0 ||
    evaluables.some((e) => (!e.padre_id || !seccionIdsPonderadas.has(e.padre_id)) && pesoItem(e) > 0)

  const peso = (item: { puntaje?: number | null }): number => (modoPonderado ? pesoItem(item) : 1)

  type UnidadRaiz =
    | { tipo: 'SECCION'; item: Item; peso: number; hijos: Item[] }
    | { tipo: 'ITEM'; item: Item; peso: number }

  const unidadesRaiz: UnidadRaiz[] = []
  const seccionesProcesadas = new Set<string>()

  for (const it of ordenados) {
    if (it.tipo === 'CONTENEDOR') {
      if (!it.id || !seccionIdsPonderadas.has(it.id) || seccionesProcesadas.has(it.id)) continue
      seccionesProcesadas.add(it.id)
      const hijos = hijosPorPadre.get(it.id) ?? []
      if (!hijos.length) continue
      unidadesRaiz.push({ tipo: 'SECCION', item: it, peso: peso(it), hijos })
      continue
    }
    if (it.padre_id && seccionIdsPonderadas.has(it.padre_id)) continue
    unidadesRaiz.push({ tipo: 'ITEM', item: it, peso: peso(it) })
  }

  const pesoTotalRaiz = unidadesRaiz.reduce((acc, u) => acc + u.peso, 0)
  const filas: FilaComposicionItem[] = []
  let indice = 1

  for (const unidad of unidadesRaiz) {
    const fraccionModulo = pesoTotalRaiz > 0 ? unidad.peso / pesoTotalRaiz : 0

    if (unidad.tipo === 'SECCION') {
      const hijos = unidad.hijos
      const totHijos = hijos.reduce((acc, h) => acc + peso(h), 0)

      for (const h of hijos) {
        const pesoHijo = peso(h)
        const fraccionEnSeccion = totHijos > 0 ? pesoHijo / totHijos : 0
        const pctEfectivo = fraccionModulo * fraccionEnSeccion * 100

        filas.push({
          orden: indice++,
          texto: h.texto,
          seccion: unidad.item.texto,
          tipo: etiquetaTipo(h.tipo),
          puntosConfigurados: pesoItem(h) > 0 ? `${fmtNum(pesoItem(h))} pts` : (modoPonderado ? '0 pts' : 'Equitativo'),
          pesoEnSeccion: `${fmtNum(Math.round(fraccionEnSeccion * 1000) / 10)}%`,
          pesoEfectivoModulo: Math.round(pctEfectivo * 100) / 100
        })
      }
    } else {
      const pctEfectivo = fraccionModulo * 100
      const padre = unidad.item.padre_id ? seccionesPorId.get(unidad.item.padre_id) : null

      filas.push({
        orden: indice++,
        texto: unidad.item.texto,
        seccion: padre ? padre.texto : '—',
        tipo: etiquetaTipo(unidad.item.tipo),
        puntosConfigurados: pesoItem(unidad.item) > 0 ? `${fmtNum(pesoItem(unidad.item))} pts` : (modoPonderado ? '0 pts' : 'Equitativo'),
        pesoEnSeccion: '—',
        pesoEfectivoModulo: Math.round(pctEfectivo * 100) / 100
      })
    }
  }

  const sumaTotalPct = Math.round(filas.reduce((acc, f) => acc + f.pesoEfectivoModulo, 0) * 10) / 10

  return { filas, sumaTotalPct }
}

export function buildExplicacionModulo(datos: ExplicacionModuloDatos): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false })
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - MARGEN * 2
  let y = MARGEN

  /** La posición actual del cursor y las medidas de la hoja, para `composicion.ts`. */
  const geo = (): Geometria => ({ y, anchoUtil, ancho, alto })

  const textoLinea = (
    value: string,
    options: { bold?: boolean; size?: number; gap?: number; color?: [number, number, number] } = {}
  ) => {
    y = pintarTextoLinea(pdf, value, geo(), options)
  }

  /** Título de sección: el de `composicion.ts`, en marino con regla suave. */
  const tituloSeccion = (value: string) => {
    y = pintarTituloSeccion(pdf, value, geo())
  }

  /** Rótulo de ítem dentro del tercer bloque: más chico que un título de sección. */
  const subtitulo = (value: string, sangria = 0) => {
    const espacioAnterior = y > MARGEN + 1 ? 3 : 0
    if (y + espacioAnterior + 16 > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    y += espacioAnterior
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9.5)
    pdf.setTextColor(...MARINO)
    const lineas = pdf.splitTextToSize(value, anchoUtil - sangria) as string[]
    pdf.text(lineas, MARGEN + sangria, y)
    y += lineas.length * 4.4 + 2
  }

  const tabla = (
    headers: string[],
    rows: string[][],
    opciones?: {
      columnStyles?: Record<number, { cellWidth?: number; halign?: 'left' | 'center' | 'right' }>
      foot?: string[][]
    }
  ) => {
    if (!rows.length) return
    autoTable(pdf, {
      ...ESTILO_TABLA,
      head: [headers],
      body: rows,
      foot: opciones?.foot,
      startY: y,
      margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
      columnStyles: opciones?.columnStyles ?? {}
    })
    y = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    y += 3
  }

  // --- 1) Datos del módulo --------------------------------------------------
  // La banda de marca abre el documento: el título de arranque y el nombre del
  // módulo, que es lo único que hace falta para saber qué metodología se lee.
  y = pintarBanda(pdf, 'Qué mide y cómo se mide', datos.moduloNombre, geo())

  const items = itemsEnOrdenJerarquico(datos.items)
  const secciones = items.filter((i) => i.tipo === 'CONTENEDOR')
  const seccionesPorId = new Map(secciones.map((s) => [s.id, s]))

  // Hijos agrupados por sección para calcular la suma de pesos del grupo
  const hijosPorPadre = new Map<string, Item[]>()
  for (const it of items) {
    if (it.padre_id) {
      const arr = hijosPorPadre.get(it.padre_id) ?? []
      arr.push(it)
      hijosPorPadre.set(it.padre_id, arr)
    }
  }
  const sumaHijosPorPadre = new Map<string, number>()
  for (const [padreId, hijos] of hijosPorPadre) {
    sumaHijosPorPadre.set(
      padreId,
      hijos.reduce((a, h) => a + pesoItem(h), 0)
    )
  }

  const elementosRaiz = items.filter((i) => !i.padre_id)
  const raizConPeso = elementosRaiz.filter((i) => pesoItem(i) > 0)
  const sumaRaiz = raizConPeso.reduce((a, i) => a + pesoItem(i), 0)

  tabla(
    ['Dato', 'Detalle'],
    [
      ['Módulo', datos.moduloNombre],
      ['Descripción', datos.moduloDescripcion?.trim() || 'Sin descripción en la configuración'],
      ['Ítems activos', `${items.length}${secciones.length ? ` (${secciones.length} son secciones)` : ''}`],
      ['Pesos', resumenPesosModulo(items)],
      ['Generado', new Date().toLocaleDateString('es')]
    ],
    { columnStyles: { 0: { cellWidth: 46 } } }
  )

  // --- 2) Cómo se calcula el puntaje ----------------------------------------
  tituloSeccion('Cómo se calcula el puntaje')
  textoLinea(
    'Cada ítem tiene un peso dentro del módulo. El puntaje es la suma de (peso x cumplimiento) de cada ítem ' +
      'respondido: un ítem al 100% aporta todo su peso y uno al 0 no aporta nada. Cuando ningún ítem tiene peso, ' +
      'el módulo no se pondera: promedia los ítems respondidos.'
  )
  textoLinea(
    'Las secciones agrupan ítems y valen por los suyos: los hijos reparten el peso de la sección y la sección no se ' +
      'responde sola. Un ítem marcado como No aplica queda fuera del cálculo, ni suma ni resta.'
  )
  if (sumaRaiz > 0 && sumaRaiz !== 100) {
    textoLinea(
      `Normalización: los elementos principales del módulo suman ${fmtNum(sumaRaiz)} puntos. El sistema divide los puntos obtenidos entre los puntos posibles respondidos, por lo que la calificación final siempre se expresa en escala de 0% a 100%.`
    )
  }
  textoLinea(
    'Veredictos: CUMPLE cuando el ítem llegó al 100%, NO CUMPLE cuando le faltó algo (puntúa lo que cumplió) y ' +
      'SIN VEREDICTO cuando no hay respuesta, que no entra en el promedio. Cada punto incumplido se le atribuye a un ' +
      'responsable: el que eligió el evaluador o, si no eligió, el gerente de la unidad.'
  )

  // --- 3) Detalle de cada ítem ----------------------------------------------
  tituloSeccion('Ítems del módulo')

  if (!items.length) {
    textoLinea('El módulo no tiene ítems activos.')
  }

  items.forEach((item, index) => {
    const esHijo = !!item.padre_id
    const padre = item.padre_id ? seccionesPorId.get(item.padre_id) : null
    const sumaHermanos = item.padre_id ? (sumaHijosPorPadre.get(item.padre_id) ?? 0) : 0
    subtitulo(`${index + 1}. ${item.texto}`, esHijo ? 6 : 0)
    const datosItem = [
      `Tipo: ${etiquetaTipo(item.tipo)}`,
      `Peso: ${textoPeso(item, padre, sumaHermanos, sumaRaiz)}`,
      item.requerido ? 'Obligatorio para cerrar la evaluación' : 'Opcional',
      item.responsables?.length ? `Responsables: ${item.responsables.join(', ')}` : 'Sin responsables configurados'
    ]
    textoLinea(datosItem.join(' | '), { size: 8.5, gap: 2 })
    for (const parrafo of comoSeMide(item)) textoLinea(parrafo, { size: 9, gap: 2 })
    if ((item.opciones ?? []).length) {
      tabla(
        ['Punto', 'Cómo se evalúa', 'Puntos', 'Responsable'],
        filasPuntos(item),
        { columnStyles: { 1: { cellWidth: 62 }, 2: { cellWidth: 16, halign: 'right' }, 3: { cellWidth: 34 } } }
      )
    }
  })

  // --- 4) Composición del 100% del módulo -----------------------------------
  if (items.length) {
    tituloSeccion('Composición del 100% del módulo')
    textoLinea(
      'La siguiente tabla resume cuánto vale y qué porcentaje exacto aporta cada ítem individual para conformar la calificación final del 100% del módulo. ' +
      'En módulos con secciones (grupos), el porcentaje efectivo resulta de combinar el peso del grupo con el peso del ítem dentro de su grupo.'
    )

    const comp = calcularComposicionModulo(items)
    if (comp.filas.length) {
      if (secciones.length > 0) {
        tabla(
          ['#', 'Ítem a evaluar', 'Sección / Grupo', 'Puntos', '% en grupo', '% del módulo'],
          comp.filas.map((f) => [
            `${f.orden}`,
            f.texto,
            f.seccion,
            f.puntosConfigurados,
            f.pesoEnSeccion,
            `${fmtNum(f.pesoEfectivoModulo)}%`
          ]),
          {
            columnStyles: {
              0: { cellWidth: 8, halign: 'center' },
              1: { cellWidth: 72 },
              2: { cellWidth: 42 },
              3: { cellWidth: 20, halign: 'right' },
              4: { cellWidth: 20, halign: 'right' },
              5: { cellWidth: 20, halign: 'right' }
            },
            foot: [['', 'TOTAL DEL MÓDULO', '', '', '', `${fmtNum(comp.sumaTotalPct)}%`]]
          }
        )
      } else {
        tabla(
          ['#', 'Ítem a evaluar', 'Tipo', 'Puntos', '% del módulo'],
          comp.filas.map((f) => [
            `${f.orden}`,
            f.texto,
            f.tipo,
            f.puntosConfigurados,
            `${fmtNum(f.pesoEfectivoModulo)}%`
          ]),
          {
            columnStyles: {
              0: { cellWidth: 10, halign: 'center' },
              1: { cellWidth: 100 },
              2: { cellWidth: 36 },
              3: { cellWidth: 18, halign: 'right' },
              4: { cellWidth: 18, halign: 'right' }
            },
            foot: [['', 'TOTAL DEL MÓDULO', '', '', `${fmtNum(comp.sumaTotalPct)}%`]]
          }
        )
      }
    }
  }

  // --- Pie: de qué módulo es, en todas las hojas ----------------------------
  const pie = `${datos.moduloNombre} | Qué mide y cómo se mide`
  for (let hoja = 1; hoja <= pdf.getNumberOfPages(); hoja++) {
    pdf.setPage(hoja)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(130, 140, 150)
    ponerLogoAlPie(pdf, MARGEN, alto - 7)
    pdf.text(pie, xTextoDelPie(MARGEN), alto - 7)
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

export async function descargarExplicacionModulo(datos: ExplicacionModuloDatos): Promise<void> {
  const pdf = buildExplicacionModulo(datos)
  const nombre = slug(datos.moduloNombre) || 'modulo'
  pdf.save(`explicacion-${nombre}-${new Date().toISOString().slice(0, 10)}.pdf`)
}

/** Solo para el pie con fecha de configuración del módulo (se usa si el caller la tiene). */
export const fechaExplicacion = (fecha: string | null | undefined): string => (fecha ? formatoFecha(fecha) : '')
