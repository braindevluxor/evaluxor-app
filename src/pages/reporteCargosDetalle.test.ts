import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * La conexión del reporte por cargos en el detalle de la evaluación.
 *
 * El motor (`reporteCargos`), el Excel (`excelCargos`) y el selector
 * (`SelectorReporteCargo`) tienen sus propias pruebas; ésta cubre lo que sólo
 * salta al usar la pantalla entera —montarla exige router, offline, Supabase y
 * el catálogo— y que igual se rompe con un cambio de una línea: que el botón
 * abra el selector, que el selector pase los cargos visibles y que los dos
 * formatos bajen con los MISMOS datos armados acá.
 */
const codigo = readFileSync(fileURLToPath(new URL('./EvaluacionDetalle.tsx', import.meta.url)), 'utf8')

describe('EvaluacionDetalle · reporte por cargos', () => {
  it('la barra de descargas tiene la opción que abre el selector de cargos', () => {
    // La opción vive dentro del menú único de descargas (`MenuDescargas`).
    expect(codigo).toContain('setSelectorCargosAbierto(true)')
    expect(codigo).toContain('<SelectorReporteCargo')
  })

  it('el modal ofrece TODOS los cargos medidos, sin recortarlos al centro de la tarjeta', () => {
    // El filtro de centro (`valoresVisibles`) sirve para leer la columna de
    // tarjetas, no para decidir a quién se le puede mandar un reporte: si el
    // modal lo usara, un cargo de la CENTRAL (branch 5) quedaba fuera del
    // listado aunque tuviera puntos, mientras la columna lo mostraba al
    // cambiar de centro.
    expect(codigo).toContain('cargos={valoresOrdenados.map((v) => ({ cargo: v.responsable, porciento: v.porciento }))}')
    expect(codigo).not.toContain('cargos={valoresVisibles.map')
    // El porcentaje también se busca en la lista completa.
    expect(codigo).toContain('porciento: valoresOrdenados.find((v) => v.responsable === cargo)?.porciento ?? null')
  })

  it('baja los dos formatos a partir de UN solo armado de datos', () => {
    expect(codigo).toContain('armarReporteCargos(')
    expect(codigo).toContain('descargarReporteCargos(datos')
    expect(codigo).toContain('descargarExcelCargos(datos)')
    // Los dos formatos salen del mismo `datos`: el Excel nunca arma su propia
    // versión, así que no puede decir otra cosa que el PDF.
    expect(codigo).toContain("if (formato === 'pdf')")
  })

  it('resuelve las fallas con el mismo filtro y el mismo cálculo que se pintan en la pantalla', () => {
    expect(codigo).toContain('const itemsFiltrados = items.map(aplicarOpciones)')
    expect(codigo).toContain('fallasDeResponsable(cargo, itemsFiltrados, respuestas)')
  })

  it('las fotos van SÓLO en el PDF y sólo las que le tocan a ese cargo', () => {
    // Cada pendiente resuelve sus fotos con SUS puntos: en un ítem de lista el
    // punto tiene responsable propio, y darle las fotos del ítem entero sería
    // imprimirle evidencia de un punto que no es suyo.
    expect(codigo).toContain('pathsDeFotosFalla(')
    expect(codigo).toContain('falla.checkIds')
    expect(codigo).toContain('prepararFotosDeFalla()')
    // Las fotos se bajan de Storage sólo cuando el formato es PDF; el Excel
    // queda siendo sólo datos.
    expect(codigo).toMatch(
      /if \(formato === 'pdf'\) \{\s*\n\s*descargarReporteCargos\(datos, await cargarImagenesReporte\(datos\)\)/
    )
  })
})
