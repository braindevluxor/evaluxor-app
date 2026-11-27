import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * La acción de descarga de cada fila del Historial.
 *
 * Antes era un botón suelto «Descargar PDF»; ahora es el MISMO menú único que
 * usa el detalle (`MenuDescargas`), con las mismas tres salidas. Montar la
 * pantalla exige router, offline, catálogo y Supabase, así que ésta cubre lo
 * que sólo se rompe con un cambio de una línea del fuente: que la fila ofrezca
 * las tres opciones y que cada una esté cableada a su flujo.
 */
const codigo = readFileSync(fileURLToPath(new URL('./Historial.tsx', import.meta.url)), 'utf8')

describe('Historial · descargas', () => {
  it('la fila tiene UN menú de descargas, no el botón suelto de PDF', () => {
    expect(codigo).toContain('<MenuDescargas')
    expect(codigo).not.toContain('aria-label="Descargar PDF"')
    // La cara del menú sobre blanco: sin `claseBoton`, el BOTON_CABECERA
    // (texto blanco sobre la barra azul) quedaría invisible en la tarjeta.
    expect(codigo).toContain("claseBoton={claseBotonIcono('secondary')}")
  })

  it('ofrece las mismas tres opciones que el detalle, cableadas', () => {
    expect(codigo).toContain("etiqueta: 'PDF general'")
    expect(codigo).toContain('onSelect: () => setElegirEn(ev.id)')
    expect(codigo).toContain("etiqueta: 'Excel general'")
    expect(codigo).toContain('void descargarExcelHistorial(ev)')
    expect(codigo).toContain("etiqueta: 'Por cargo (PDF o Excel)'")
    expect(codigo).toContain('void prepararCargos(ev)')
  })

  it('el Excel y el reporte por cargo se arman como en el detalle', () => {
    // El Excel lleva su pestaña de incidencias con el mismo join de módulo.
    expect(codigo).toContain('modulo:modulos!incidencias_modulo_id_fkey(nombre)')
    expect(codigo).toContain('descargarExcelEvaluacion(detalle, incidencias)')
    // El reporte por cargo pide el detalle y aplica LOS MISMOS filtros que la
    // pantalla (permisos de la checklist y opciones de la unidad) antes de
    // ofrecer cargos, y baja los dos formatos con los datos armados acá.
    expect(codigo).toContain('aplicarPermisosChecklist(item, unidad, { sucursalPermisos })')
    expect(codigo).toContain('valorPorResponsable(itemsFiltrados, respuestas)')
    expect(codigo).toContain('<SelectorReporteCargo')
    expect(codigo).toContain('armarReporteCargos(')
    expect(codigo).toContain('descargarReporteCargos(datos, await cargarImagenesReporte(datos))')
    expect(codigo).toContain('descargarExcelCargos(datos)')
  })
})
