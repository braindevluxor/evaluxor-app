import { describe, expect, it } from 'vitest'
import { armarReporteCargos, buildReporteCargos, type ReporteCargosDatos } from './reporteCargos'
import { hojasReporteCargos } from '../excelCargos'
import type { FallaResponsable } from '../scoring'

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
          checks: ['Sellos de puertas sin fugas', 'Sensor de alarma conectado'],
          fotos: []
        },
        {
          item: 'La cocina cuenta con un plan de limpieza vigente',
          modulo: 'Higiene y salubridad',
          tipo: 'CUMPLE_NO_CUMPLE',
          perdidos: 4,
          checks: [],
          fotos: []
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

describe('armarReporteCargos · la frontera entre la pantalla y el documento', () => {
  const falla = (texto: string, perdidos: number, extra: Partial<FallaResponsable> = {}): FallaResponsable => ({
    item_id: `i-${texto}`,
    tipo: 'CHECKLIST',
    texto,
    modulo_id: 'm-1',
    perdidos,
    checks: [],
    checkIds: [],
    ...extra
  })

  it('suma los puntos perdidos, nombra el módulo y deja los pendientes del más caro al más barato', () => {
    const datos = armarReporteCargos(
      { unidad: 'Sucursal Norte', referencia: '102', fecha: '2026-10-01', puntajeGeneral: 81 },
      [
        {
          cargo: 'Coordinador de servicios generales',
          porciento: 74,
          fallas: [
            falla('Menor', 2),
            falla('Mayor', 9, { modulo_id: 'm-2', checks: ['Sellos sin fugas'] }),
            falla('Medio', 5)
          ]
        }
      ],
      [{ id: 'm-1', nombre: 'Higiene y salubridad' }, { id: 'm-2', nombre: 'Seguridad' }]
    )

    expect(datos.unidad).toBe('Sucursal Norte')
    expect(datos.referencia).toBe('102')
    expect(datos.puntajeGeneral).toBe(81)

    const [cargo] = datos.cargos
    expect(cargo.porciento).toBe(74)
    expect(cargo.perdidos).toBe(16)
    expect(cargo.pendientes.map((p) => p.item)).toEqual(['Mayor', 'Medio', 'Menor'])
    expect(cargo.pendientes[0]).toEqual({
      item: 'Mayor',
      modulo: 'Seguridad',
      tipo: 'CHECKLIST',
      perdidos: 9,
      checks: ['Sellos sin fugas'],
      fotos: []
    })
    expect(cargo.pendientes[1].modulo).toBe('Higiene y salubridad')
  })

  it('respeta el orden de los cargos elegidos; uno sin fallas sale con cero y sin pendientes', () => {
    const datos = armarReporteCargos(
      { unidad: 'Sucursal Sur', referencia: null, fecha: '2026-10-02', puntajeGeneral: null },
      [
        { cargo: 'Cajero', porciento: null, fallas: [] },
        // Módulo que no está en la lista: el nombre queda en null y el
        // documento imprime «-», nunca el id crudo.
        { cargo: 'Depositaría', porciento: 50, fallas: [falla('Algo', 3, { modulo_id: 'desconocido' })] }
      ],
      []
    )

    expect(datos.cargos.map((c) => c.cargo)).toEqual(['Cajero', 'Depositaría'])
    expect(datos.cargos[0].perdidos).toBe(0)
    expect(datos.cargos[0].pendientes).toEqual([])
    expect(datos.cargos[0].porciento).toBeNull()
    expect(datos.cargos[1].pendientes[0].modulo).toBeNull()
  })

  it('PDF y Excel salen de los MISMOS datos: el formato no cambia qué se le cobra a un cargo', () => {
    const datos = armarReporteCargos(
      { unidad: 'Sucursal Centro', referencia: null, fecha: '2026-10-03', puntajeGeneral: 70 },
      [{ cargo: 'Depositaría', porciento: 62, fallas: [falla('Sin sellos', 8.5, { checks: ['Sellos de puertas sin fugas'] })] }],
      [{ id: 'm-1', nombre: 'Higiene y salubridad' }]
    )

    expect(buildReporteCargos(datos).output()).toContain('Sellos de puertas sin fugas')
    const pendientes = hojasReporteCargos(datos).find((hoja) => hoja.nombre === 'Pendientes')!
    expect(pendientes.filas.flat()).toContain('Sellos de puertas sin fugas')
  })
})

describe('reporte de pendientes por cargo · fotos de evidencia', () => {
  /** PNG válido de 1x1, para probar el pegado sin depender de un archivo real. */
  const PNG_1x1 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  const conFoto = (fotos: string[]): ReporteCargosDatos =>
    armarReporteCargos(
      { unidad: 'Sucursal Centro', referencia: null, fecha: '2026-10-05', puntajeGeneral: 70 },
      [
        {
          cargo: 'Depositaría',
          porciento: 62,
          fallas: [
            {
              item_id: 'i-1',
              tipo: 'CHECKLIST',
              texto: 'Sin sellos de puertas',
              modulo_id: null,
              perdidos: 5,
              checks: ['Sellos de puertas sin fugas'],
              checkIds: ['c-sellos']
            }
          ]
        }
      ],
      [],
      () => fotos
    )

  it('las fotos se resuelven pendiente por pendiente, con los checks de ESE cargo', () => {
    // Dos cargos sobre el MISMO ítem, cada uno responsable de un punto
    // distinto: el reporte tiene que darle a cada uno la foto de su punto.
    const mismoItem = {
      item_id: 'i-1',
      tipo: 'CHECKLIST',
      texto: 'Refrigeración',
      modulo_id: null,
      perdidos: 5
    }
    const datos = armarReporteCargos(
      { unidad: 'Sucursal Centro', referencia: null, fecha: '2026-10-05', puntajeGeneral: 70 },
      [
        {
          cargo: 'Ana',
          porciento: 50,
          fallas: [{ ...mismoItem, checks: ['Sellos'], checkIds: ['c-sellos'] }]
        },
        {
          cargo: 'Beto',
          porciento: 60,
          fallas: [{ ...mismoItem, checks: ['Sensor'], checkIds: ['c-sensor'] }]
        }
      ],
      [],
      (f) => (f.checkIds[0] === 'c-sellos' ? ['ev/sellos.png'] : ['ev/sensor.png'])
    )

    expect(datos.cargos[0].pendientes[0].fotos).toEqual(['ev/sellos.png'])
    expect(datos.cargos[1].pendientes[0].fotos).toEqual(['ev/sensor.png'])
  })

  it('sin resolver fotos, el pendiente sale igual pero sin ninguna', () => {
    expect(conFoto([]).cargos[0].pendientes[0].fotos).toEqual([])
    expect(armarReporteCargos({ unidad: 'U', referencia: null, fecha: '2026-10-05', puntajeGeneral: null }, [], [])).toEqual({
      unidad: 'U',
      referencia: null,
      fecha: '2026-10-05',
      puntajeGeneral: null,
      cargos: []
    })
  })

  it('con las fotos bajadas, el PDF las pega y crece', () => {
    const vacio = buildReporteCargos(conFoto(['ev/a.png'])).output('blob').size
    const conImagen = buildReporteCargos(conFoto(['ev/a.png']), { 'ev/a.png': PNG_1x1 }).output('blob')
      .size
    expect(conImagen).toBeGreaterThan(vacio)
  })

  it('una foto que no se pudo leer queda fuera y no tumba el documento', () => {
    const datos = conFoto(['ev/rota.png', 'ev/buena.png'])
    const pdf = buildReporteCargos(datos, {
      'ev/rota.png': 'data:image/png;base64,esto-no-es-una-imagen',
      'ev/buena.png': PNG_1x1
    })
    expect(pdf.output()).toContain('Sellos de puertas sin fugas')
    expect(pdf.output('blob').size).toBeGreaterThan(0)
  })
})
