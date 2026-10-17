/**
 * Exportación de los resultados de una evaluación a `.xlsx`, en paralelo al
 * PDF (`src/lib/pdf`): mismos datos que muestra la pantalla, repartidos en
 * cuatro pestañas filtrables. El archivo se arma en el navegador con el
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
import type { VeredictoItem } from './scoring'
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
    instancias: detalle.instancias
  }
  // El CONTENEDOR es la sección que agrupa, no una respuesta: no tiene nada
  // que exportar (el detalle de la pantalla lo saltea por la misma razón).
  const filasDetalle = detalleDeEvaluacion(datos, ev.id).filter((fila) => fila.tipo !== 'CONTENEDOR')
  const resumen = resumirEvaluacion(ev, detalle.respuestas, detalle.items, detalle.sucursalOpciones)
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
      puntajeModuloDeRespuestas(detalle.respuestas, detalle.items, modulo.id, unidad, detalle.sucursalOpciones),
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
