/**
 * Reporte POR CARGOS de una evaluación, en `.xlsx`.
 *
 * Hermano del PDF (`reporteCargos.ts`): mismos datos —los cargos elegidos y sus
 * pendientes— pero en hojas filtrables, que es para lo que se usa una hoja de
 * cálculo: cruzar, ordenar y contar por columna.
 *
 * Dos pestañas:
 *   1. CARGOS: una fila por cargo, con nota, cantidad de ítems con pendientes y
 *      puntos no cumplidos. Es el mismo resumen que la tabla del PDF.
 *   2. PENDIENTES: una fila por (cargo, ítem, check). Los ítems que no son de
 *      checks entran como una sola fila con el ítem entero, igual que los
 *      imprime el PDF; así la hoja no pierde ninguna falla.
 *
 * El archivo se compone en el navegador con el escritor sin dependencias de
 * `xlsx.ts`, sobre las fallas que el detalle ya calculó.
 */
import { etiquetaTipo } from './scoring'
import { crearXlsx, type CeldaExcel, type HojaExcel } from './xlsx'
import type { ReporteCargosDatos } from './pdf/reporteCargos'

const redondear2 = (n: number): number => Math.round(n * 100) / 100

export function hojasReporteCargos(datos: ReporteCargosDatos): HojaExcel[] {
  const filasCargos: CeldaExcel[][] = [
    ['Cargo', 'Nota %', 'Ítems con pendientes', 'Puntos no cumplidos']
  ]
  for (const cargo of datos.cargos) {
    filasCargos.push([
      cargo.cargo,
      cargo.porciento == null ? null : cargo.porciento,
      cargo.pendientes.length,
      redondear2(cargo.perdidos)
    ])
  }

  const filasPendientes: CeldaExcel[][] = [
    ['Cargo', 'Módulo', 'Ítem', 'Tipo', 'Punto del checklist', 'Puntos']
  ]
  for (const cargo of datos.cargos) {
    for (const pendiente of cargo.pendientes) {
      if (pendiente.checks.length) {
        // Una fila por check, sin repetir los puntos en cada una: el total del
        // ítem va al final de su grupo, marcado en la columna del punto.
        for (const check of pendiente.checks) {
          filasPendientes.push([
            cargo.cargo,
            pendiente.modulo,
            pendiente.item,
            etiquetaTipo(pendiente.tipo),
            check,
            null
          ])
        }
        filasPendientes.push([
          cargo.cargo,
          pendiente.modulo,
          pendiente.item,
          etiquetaTipo(pendiente.tipo),
          `TOTAL del ítem`,
          redondear2(pendiente.perdidos)
        ])
      } else {
        // Ítems binarios y de plano: el ítem entero es la falla.
        filasPendientes.push([
          cargo.cargo,
          pendiente.modulo,
          pendiente.item,
          etiquetaTipo(pendiente.tipo),
          'Ítem completo',
          redondear2(pendiente.perdidos)
        ])
      }
    }
  }

  const filasResumen: CeldaExcel[][] = [
    ['Dato', 'Valor'],
    ['Unidad evaluada', datos.unidad],
    ['Referencia', datos.referencia?.trim() || null],
    ['Fecha de evaluación', datos.fecha],
    [
      'Puntaje general',
      datos.puntajeGeneral == null ? 'Sin puntaje (evaluación abierta)' : redondear2(datos.puntajeGeneral)
    ],
    ['Cargos en el reporte', datos.cargos.length],
    ['Generado', new Date().toLocaleDateString('es')]
  ]

  return [
    { nombre: 'Resumen', filas: filasResumen },
    { nombre: 'Cargos', filas: filasCargos },
    { nombre: 'Pendientes', filas: filasPendientes }
  ]
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function descargarExcelCargos(datos: ReporteCargosDatos): void {
  const bytes = crearXlsx(hojasReporteCargos(datos))
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
  )
  try {
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = `pendientes-por-cargo-${slug(datos.unidad) || 'evaluacion'}-${datos.fecha}.xlsx`
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
