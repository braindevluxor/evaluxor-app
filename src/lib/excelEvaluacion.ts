/**
 * Exportación de los resultados de una evaluación a `.xlsx`, en paralelo al
 * PDF (`src/lib/pdf`): mismos datos que muestra la pantalla, repartidos en
 * cuatro pestañas filtrables —cinco cuando la evaluación tiene conciliación,
 * que lleva un renglón por SKU—. El archivo se arma en el navegador con el
 * escritor de `src/lib/xlsx.ts` —sin dependencias— sobre el
 * `DetalleEvaluacion` que la página ya tiene en mano, así que lo que baja el
 * Excel es exactamente lo que se ve en pantalla.
 */
import { ocultarCentroCodigoEvaluacion } from './codigoEvaluacion'
import {
  detalleDeEvaluacion,
  listarPerfilesSync,
  puntajeModuloDeRespuestas,
  resumirEvaluacion,
  unidadDe,
  type ConjuntoDatos,
  type DetalleEvaluacion
} from './data/indicadores'
import {
  diferenciaConciliacion,
  estadoConciliacion,
  esSinHablador,
  ordenarConciliacion,
  perdidaGuardadaConciliacion,
  productosParaConciliar,
  type EstadoConciliacion,
  type ProductoConciliacion,
  type ValorConciliacion,
  type VeredictoItem
} from './scoring'
import type { VistaEvaluacion } from './types'
import { crearXlsx, type CeldaExcel, type HojaExcel } from './xlsx'

/** Una fila de la pestaña Incidencias, ya desnormalizada por la página. */
export interface IncidenciaExcel {
  descripcion: string
  /** Cargos responsables: el mismo `{ cargo }` que pinta la pantalla. */
  responsables: { cargo: string }[]
  /** `created_at` en ISO; se imprime en hora local. */
  fecha?: string | null
  modulo?: string | null
  fotos?: number
}

const ETIQUETAS_VEREDICTO: Record<VeredictoItem, string> = {
  cumple: 'Cumple',
  'no-cumple': 'No cumple',
  'no-aplica': 'No aplica',
  'sin-veredicto': 'Sin veredicto'
}

/** El estado de un SKU, con las mismas palabras que usa el informe en PDF. */
const ETIQUETAS_ESTADO_CONCILIACION: Record<EstadoConciliacion, string> = {
  falta: 'Falta',
  sobra: 'Sobra',
  concilia: 'Concilia',
  'sin-datos': 'Sin datos'
}

/**
 * El estado que se imprime en la planilla: la misma frase del PDF.
 *
 * El «No Match · sin hablador» va aparte del enum: es un incumplimiento
 * registrado a propósito (no hay precio físico que comparar), no un faltante
 * ni un sobrante, y decirlo como «Sin datos» escondió ese hallazgo.
 */
function etiquetaEstadoConciliacion(producto: ProductoConciliacion): string {
  if (esSinHablador(producto)) return 'No Match · sin hablador'
  return ETIQUETAS_ESTADO_CONCILIACION[estadoConciliacion(producto)]
}

/** `2026-10-15 09:30` en hora del equipo: la incidencia pasó a hora de tienda, no en UTC. */
function fechaHoraLocal(iso: string | null | undefined): string | null {
  if (!iso) return null
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())} ${pad(fecha.getHours())}:${pad(
    fecha.getMinutes()
  )}`
}

/**
 * Las cuatro pestañas del libro, a partir del detalle que ya está en pantalla.
 * `perfiles` sólo se usa para escribir el nombre de quien respondió.
 */
export function hojasDeEvaluacion(
  detalle: DetalleEvaluacion,
  incidencias: IncidenciaExcel[] = [],
  perfiles: Record<string, { nombre: string }> = {}
): HojaExcel[] {
  const ev = detalle.evaluacion
  const datos: ConjuntoDatos = {
    evaluaciones: [ev],
    respuestas: detalle.respuestas,
    items: detalle.items,
    modulos: detalle.modulos,
    fotos: detalle.fotos,
    sucursalOpciones: detalle.sucursalOpciones,
    sucursalPermisos: detalle.sucursalPermisos,
    instancias: detalle.instancias
  }
  // El CONTENEDOR es la sección que agrupa, no una respuesta: no tiene nada
  // que exportar (el detalle de la pantalla lo saltea por la misma razón).
  const filasDetalle = detalleDeEvaluacion(datos, ev.id).filter((fila) => fila.tipo !== 'CONTENEDOR')
  const resumen = resumirEvaluacion(ev, detalle.respuestas, detalle.items, detalle.sucursalOpciones, detalle.sucursalPermisos)
  const unidad = unidadDe(ev)

  const filasResumen: CeldaExcel[][] = [
    ['Dato', 'Valor'],
    ['Código de evaluación', ocultarCentroCodigoEvaluacion(ev.id)],
    ...(ev.departamento
      ? [['Departamento', ev.departamento.nombre ?? '—']]
      : [
          ['Sucursal', ev.sucursal?.nombre ?? '—'],
          ['Código de tienda', ev.sucursal?.shop_id ?? '—'],
          ['Dirección', ev.sucursal?.direccion ?? '—']
        ]),
    ['Fecha de evaluación', ev.fecha],
    ['Puntaje general', resumen.puntaje == null ? 'Sin puntaje' : Math.round(resumen.puntaje * 100) / 100],
    ['Ítems puntuables', resumen.itemsBinarios],
    ['Ítems que cumplen', resumen.itemsBinariosOk],
    ['Incidencias', incidencias.length],
    ...(ev.comentario_general?.trim() ? [['Comentario general', ev.comentario_general.trim()]] : [])
  ]

  // Conteos por módulo sobre las mismas filas del detalle (con las opciones de
  // la sucursal ya aplicadas), para que cierren con lo que muestra la pantalla.
  const puntuablesPorModulo = new Map<string, number>()
  const cumplenPorModulo = new Map<string, number>()
  for (const fila of filasDetalle) {
    if (fila.proporcion == null) continue
    puntuablesPorModulo.set(fila.modulo_id, (puntuablesPorModulo.get(fila.modulo_id) ?? 0) + 1)
    if (fila.proporcion >= 1) cumplenPorModulo.set(fila.modulo_id, (cumplenPorModulo.get(fila.modulo_id) ?? 0) + 1)
  }
  const filasModulos: CeldaExcel[][] = [['Módulo', 'Puntaje %', 'Ítems puntuables', 'Ítems que cumplen']]
  for (const modulo of detalle.modulos) {
    filasModulos.push([
      modulo.nombre,
      puntajeModuloDeRespuestas(detalle.respuestas, detalle.items, modulo.id, unidad, detalle.sucursalOpciones, detalle.sucursalPermisos),
      puntuablesPorModulo.get(modulo.id) ?? 0,
      cumplenPorModulo.get(modulo.id) ?? 0
    ])
  }

  const filasResultados: CeldaExcel[][] = [
    ['Módulo', 'Ítem', 'Registro', 'Estado', 'Nota %', 'Peso', 'Respuesta', 'Comentarios', 'Fotos', 'Tipo', 'Respondió']
  ]
  for (const fila of filasDetalle) {
    filasResultados.push([
      fila.modulo,
      fila.texto,
      fila.instancia,
      ETIQUETAS_VEREDICTO[fila.veredicto],
      fila.proporcion == null ? null : Math.round(fila.proporcion * 10000) / 100,
      fila.peso,
      fila.resumen,
      fila.comentarios,
      fila.fotos,
      fila.tipo,
      fila.respondido_por
        ? (perfiles[fila.respondido_por]?.nombre ?? `Usuario ${fila.respondido_por.slice(0, 8)}`)
        : null
    ])
  }

  /**
   * Conciliación: UN RENGLÓN POR SKU.
   *
   * El Excel sólo resumía («3/5 productos conciliados · descuadre 40%»)
   * mientras el PDF ya imprimía el desglose: en una planilla no se puede
   * filtrar ni sumar lo que no está, y lo que se busca en una conciliación es
   * justamente el SKU que descuadra.
   *
   * Van como DATOS y no como frase —números en las columnas de teórica,
   * física, diferencia y pérdida— para que se pueda ordenar y totalizar; el
   * orden es el de lectura del informe (primero las pérdidas, después los
   * sobrantes), y la columna Estado dice hacia qué lado cae cada uno.
   *
   * No sale la hoja si no hay ni un SKU: una pestaña con sólo el encabezado
   * es ruido para quien recibe el archivo.
   */
  const filasConciliacion: CeldaExcel[][] = [
    [
      'Módulo',
      'Ítem',
      'Contra dato',
      'SKU',
      'ID sistema',
      'Producto',
      'Departamento',
      'Teórica / Sistema',
      'Física / Hablador',
      'Diferencia',
      'Estado',
      'Pérdida estimada'
    ]
  ]
  const itemsPorId = new Map(detalle.items.map((i) => [i.id, i]))
  const modulosPorId = new Map(detalle.modulos.map((m) => [m.id, m.nombre]))
  for (const respuesta of detalle.respuestas) {
    const item = itemsPorId.get(respuesta.item_id)
    if (item?.tipo !== 'CONCILIACION') continue
    const contraDato = item.contra_dato ?? 'SOH'
    const enPrecio = contraDato === 'FINAL_BASE'
    const valor = respuesta.valor as ValorConciliacion | null
    const productos = ordenarConciliacion(productosParaConciliar(valor?.productos, contraDato), contraDato)
    for (const producto of productos) {
      filasConciliacion.push([
        modulosPorId.get(item.modulo_id) ?? null,
        item.texto,
        // La columna dice en qué unidad vienen los números de al lado: en
        // precio son plata y en stock son unidades.
        enPrecio ? 'Precio' : 'Stock',
        producto.sku || null,
        producto.apiId ?? null,
        producto.nombre || null,
        producto.departamento || null,
        typeof producto.teorica === 'number' ? producto.teorica : null,
        esSinHablador(producto) ? null : typeof producto.fisica === 'number' ? producto.fisica : null,
        diferenciaConciliacion(producto),
        etiquetaEstadoConciliacion(producto),
        perdidaGuardadaConciliacion(producto, contraDato)
      ])
    }
  }

  const filasIncidencias: CeldaExcel[][] = [['Fecha', 'Módulo', 'Descripción', 'Responsables', 'Fotos']]
  for (const incidencia of incidencias) {
    filasIncidencias.push([
      fechaHoraLocal(incidencia.fecha),
      incidencia.modulo ?? null,
      incidencia.descripcion,
      incidencia.responsables.map((responsable) => responsable.cargo).join(' · ') || null,
      incidencia.fotos ?? 0
    ])
  }

  return [
    { nombre: 'Resumen', filas: filasResumen },
    { nombre: 'Módulos', filas: filasModulos },
    { nombre: 'Resultados', filas: filasResultados },
    // Sólo si hay SKU: `filasConciliacion` siempre trae su encabezado.
    ...(filasConciliacion.length > 1 ? [{ nombre: 'Conciliación', filas: filasConciliacion }] : []),
    { nombre: 'Incidencias', filas: filasIncidencias }
  ]
}

/** `resultados-sucursal-merida-2026-10-15.xlsx`: mismo molde que el PDF, con la acentuación fuera. */
export function nombreArchivoEvaluacion(ev: Pick<VistaEvaluacion, 'fecha' | 'sucursal' | 'departamento'>): string {
  const unidad = (ev.sucursal?.nombre ?? ev.departamento?.nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `resultados-${unidad || 'evaluacion'}-${ev.fecha}.xlsx`
}

/**
 * Baja el Excel de la evaluación: resuelve los nombres de quien respondió
 * (una sola consulta de perfiles) y arma el blob. Las incidencias llegan ya
 * desnormalizadas desde la página —esta capa no conoce los tipos de los
 * componentes—.
 */
export async function descargarExcelEvaluacion(
  detalle: DetalleEvaluacion,
  incidencias: IncidenciaExcel[] = []
): Promise<void> {
  const ids = [...new Set(detalle.respuestas.map((r) => r.respondido_por).filter((id): id is string => !!id))]
  const perfiles = await listarPerfilesSync(ids)
  const bytes = crearXlsx(hojasDeEvaluacion(detalle, incidencias, perfiles))
  // El Uint8Array hay que darlo con ArrayBuffer propio: es lo que `Blob` acepta.
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  )
  try {
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombreArchivoEvaluacion(detalle.evaluacion)
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
