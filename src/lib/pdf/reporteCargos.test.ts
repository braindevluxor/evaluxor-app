import { describe, expect, it } from 'vitest'
import { buildReporteCargos, type ReporteCargosDatos } from './reporteCargos'
import { hojasReporteCargos } from '../excelCargos'

const datos: ReporteCargosDatos = {
  unidad: 'Sucursal Centro',
  referencia: '102',
  fecha: '2026-09-10',
  puntajeGeneral: 76,
  cargos: [
    {
      cargo: 'Depositaría',
      porciento: 62,
      perdidos: 12.5,
      pendientes: [
        {
          item: 'Equipos de refrigeración en condiciones operativas',
          modulo: 'Higiene y salubridad',
          tipo: 'CHECKLIST',
          perdidos: 8.5,
          checks: ['Sellos de puertas sin fugas', 'Sensor de alarma conectado']
        },
        {
          item: 'La cocina cuenta con un plan de limpieza vigente',
          modulo: 'Higiene y salubridad',
          tipo: 'CUMPLE_NO_CUMPLE',
          perdidos: 4,
          checks: []
        }
      ]
    },
    {
      cargo: 'Operaciones',
      porciento: null,
      perdidos: 0,
      pendientes: []
    }
  ]
}

describe('reporte de pendientes por cargo · PDF', () => {
  it('lleva un bloque por cargo con sus ítems, checks y puntos', () => {
    const pdf = buildReporteCargos(datos)
    const output = pdf.output()

    expect(output).toContain('%PDF-')
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210)
    expect(output).toContain('Reporte por cargos: pendientes')
    expect(output).toContain('Resumen por cargo')
    expect(output).toContain('Sucursal Centro')
    expect(output).toContain('Depositaría')
    expect(output).toContain('Operaciones')
    // El check concreto es la razón de ser del reporte: sin él, «Checklist de
    // higiene» no dice en qué se falló.
    expect(output).toContain('Sellos de puertas sin fugas')
    expect(output).toContain('Sensor de alarma conectado')
    // El ítem que no es de checks entra como ítem completo, no como lista vacía.
    expect(output).toContain('Ítem completo')
    expect(output).toContain('Cumple / No cumple')
    // Un cargo sin pendientes no desaparece: se imprime su nota y la aclaración.
    expect(output).toContain('Este cargo no tiene ítems con pendientes en esta evaluación.')
  })

  it('imprime la nota y los puntos del cargo en su encabezado', () => {
    const output = buildReporteCargos(datos).output()
    expect(output).toContain('Nota del cargo: 62%')
    expect(output).toContain('Puntos no cumplidos: 12.5')
  })

  it('sin cargos no rompe: lo dice y cierra', () => {
    const pdf = buildReporteCargos({ ...datos, cargos: [] })
    expect(pdf.output()).toContain('No se seleccionó ningún cargo.')
  })

  it('pone el pie con la unidad y la fecha en todas las hojas', () => {
    const pdf = buildReporteCargos(datos)
    const paginas = (pdf.internal.pages as unknown as Array<string[] | undefined>)
      .filter((pagina): pagina is string[] => Array.isArray(pagina))
      .map((pagina) => pagina.join(''))
    expect(paginas.length).toBeGreaterThan(0)
    for (const pagina of paginas) expect(pagina).toContain('Sucursal Centro | 10 de septiembre de 2026')
  })
})

describe('reporte de pendientes por cargo · Excel', () => {
  it('arma las pestañas Resumen, Cargos y Pendientes', () => {
    const hojas = hojasReporteCargos(datos)
    expect(hojas.map((hoja) => hoja.nombre)).toEqual(['Resumen', 'Cargos', 'Pendientes'])

    const cargos = hojas.find((hoja) => hoja.nombre === 'Cargos')!
    expect(cargos.filas[0]).toEqual(['Cargo', 'Nota %', 'Ítems con pendientes', 'Puntos no cumplidos'])
    expect(cargos.filas[1]).toEqual(['Depositaría', 62, 2, 12.5])

    const pendientes = hojas.find((hoja) => hoja.nombre === 'Pendientes')!
    // Un renglón por check, más el TOTAL del ítem con sus puntos.
    expect(pendientes.filas).toContainEqual([
      'Depositaría',
      'Higiene y salubridad',
      'Equipos de refrigeración en condiciones operativas',
      'Check list',
      'Sellos de puertas sin fugas',
      null
    ])
    expect(pendientes.filas).toContainEqual([
      'Depositaría',
      'Higiene y salubridad',
      'Equipos de refrigeración en condiciones operativas',
      'Check list',
      'TOTAL del ítem',
      8.5
    ])
    // El ítem binario entra como ítem completo.
    expect(pendientes.filas).toContainEqual([
      'Depositaría',
      'Higiene y salubridad',
      'La cocina cuenta con un plan de limpieza vigente',
      'Cumple / No cumple',
      'Ítem completo',
      4
    ])
  })
})
