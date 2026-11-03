import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
          puntos: [],
          evidencias: [],
          fotos: []
        },
        {
          item: 'La cocina cuenta con un plan de limpieza vigente',
          modulo: 'Higiene y salubridad',
          tipo: 'CUMPLE_NO_CUMPLE',
          perdidos: 4,
          checks: [],
          puntos: [],
          evidencias: [],
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
    // La condición de aprobado / no aprobado va ESCRITA en cada fila, con la
    // misma palabra que el informe general: leer el reporte no puede depender
    // de adivinar qué significa una fila sin más.
    expect(output).toContain('Estado')
    expect(output).toContain('NO APROBADO')
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
    // Un renglón por check, más el TOTAL del ítem con sus puntos, y la
    // observación que quedó en el punto en su propia columna.
    expect(pendientes.filas[0]).toEqual([
      'Cargo',
      'Módulo',
      'Ítem',
      'Tipo',
      'Punto del checklist',
      'Puntos',
      'Comentario'
    ])
    expect(pendientes.filas).toContainEqual([
      'Depositaría',
      'Higiene y salubridad',
      'Equipos de refrigeración en condiciones operativas',
      'Check list',
      'Sellos de puertas sin fugas',
      null,
      null
    ])
    expect(pendientes.filas).toContainEqual([
      'Depositaría',
      'Higiene y salubridad',
      'Equipos de refrigeración en condiciones operativas',
      'Check list',
      'TOTAL del ítem',
      8.5,
      null
    ])
    // El ítem binario entra como ítem completo, con sus observaciones juntas.
    expect(pendientes.filas).toContainEqual([
      'Depositaría',
      'Higiene y salubridad',
      'La cocina cuenta con un plan de limpieza vigente',
      'Cumple / No cumple',
      'Ítem completo',
      4,
      null
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
      // Sin contexto no hay respuestas que mirar: sale sin observaciones ni
      // fotos, pero el pendiente existe igual.
      puntos: [],
      evidencias: [],
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
      // Así está guardado de verdad: la foto de un punto vive en
      // `valor.evidencias[idDelPunto]`, no contra el ítem.
      { respuestas: [{ item_id: 'i-1', valor: { evidencias: { 'c-sellos': { paths: fotos } } } }] }
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
      {
        respuestas: [
          {
            item_id: 'i-1',
            valor: {
              evidencias: {
                'c-sellos': { paths: ['ev/sellos.png'] },
                'c-sensor': { paths: ['ev/sensor.png'] }
              }
            }
          }
        ]
      }
    )

    expect(datos.cargos[0].pendientes[0].fotos).toEqual(['ev/sellos.png'])
    expect(datos.cargos[1].pendientes[0].fotos).toEqual(['ev/sensor.png'])
    // Y cada foto queda ROTULADA con su punto: es lo que hace que el PDF la
    // imprima debajo del nombre que le corresponde.
    expect(datos.cargos[0].pendientes[0].evidencias[0].punto).toBe('Sellos')
    expect(datos.cargos[1].pendientes[0].evidencias[0].punto).toBe('Sensor')
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

describe('reporte de pendientes por cargo · observaciones de los puntos', () => {
  /** Un pendiente armado a mano, para mirar cómo lo compone el documento. */
  const pendiente = (
    evidencias: ReporteCargosDatos['cargos'][number]['pendientes'][number]['evidencias'],
    extra: Partial<ReporteCargosDatos['cargos'][number]['pendientes'][number]> = {}
  ): ReporteCargosDatos => ({
    unidad: 'Sucursal Centro',
    referencia: null,
    fecha: '2026-11-03',
    puntajeGeneral: 70,
    cargos: [
      {
        cargo: 'Depositaría',
        porciento: 62,
        perdidos: 5,
        pendientes: [
          {
            item: 'Equipos de refrigeración en condiciones operativas',
            modulo: 'Higiene y salubridad',
            tipo: 'CHECKLIST',
            perdidos: 5,
            checks: ['Sellos de puertas sin fugas'],
            puntos: [],
            evidencias,
            fotos: [],
            ...extra
          }
        ]
      }
    ]
  })

  it('la observación sale en la columna del propio punto, con la palabra Comentario', () => {
    const output = buildReporteCargos(
      pendiente([
        { checkId: 'c-sellos', punto: 'Sellos de puertas sin fugas', comentario: 'falta la mercadería', fotos: [] }
      ])
    ).output()

    expect(output).toContain('Comentario')
    // Va en el MISMO renglón que el punto que la tiene, no en un pie de página
    // ni en un anexo: el lector tiene que verla sin cruzar nada.
    expect(output).toContain('falta la mercadería')
  })

  it('sin observaciones no imprime la columna: una columna de guiones es ruido', () => {
    const output = buildReporteCargos(
      pendiente([{ checkId: 'c-sellos', punto: 'Sellos de puertas sin fugas', comentario: '', fotos: [] }])
    ).output()

    expect(output).not.toContain('Comentario')
    expect(output).toContain('Sellos de puertas sin fugas')
  })

  it('en un ítem completo cada evidencia imprime SU observación, con su foto', () => {
    // El ítem no tiene puntos: la falla es el ítem entero y las evidencias
    // (foto + comentario, como las arma la pantalla) son las que se distinguen
    // entre sí, una debajo de la otra.
    const output = buildReporteCargos(
      pendiente(
        [
          { checkId: null, punto: '', comentario: 'Se reparó el estante', fotos: [] },
          { checkId: null, punto: '', comentario: 'Falta el precio base', fotos: [] }
        ],
        { checks: [], tipo: 'CUMPLE_NO_CUMPLE', item: 'La góndola tiene el precio puesto' }
      )
    ).output()

    expect(output).toContain('Observación: Se reparó el estante')
    expect(output).toContain('Observación: Falta el precio base')
    // La columna de puntos no aplica acá: no hay puntos.
    expect(output).not.toContain('Comentario')
  })

  it('el dato sale de las respuestas: comentarios y fotos por punto, juntos', () => {
    // Es el cableado completo, de la respuesta guardada a la celda impresa:
    // el comentario vive en `valor.comentarios[idDelPunto]` y la foto en
    // `valor.evidencias[idDelPunto]`, las dos bajo la MISMA clave.
    const datos = armarReporteCargos(
      { unidad: 'Sucursal Norte', referencia: null, fecha: '2026-11-03', puntajeGeneral: 80 },
      [
        {
          cargo: 'Depositaría',
          porciento: 62,
          fallas: [
            {
              item_id: 'i-1',
              tipo: 'CHECKLIST',
              texto: 'Refrigeración',
              modulo_id: null,
              perdidos: 5,
              checks: ['Sellos de puertas sin fugas'],
              checkIds: ['c-sellos']
            }
          ]
        }
      ],
      [],
      {
        respuestas: [
          {
            item_id: 'i-1',
            valor: {
              selected: [],
              comentarios: { 'c-sellos': 'falta la mercadería' },
              evidencias: { 'c-sellos': { paths: ['ev/sellos.jpg'] } }
            }
          }
        ]
      }
    )

    const [punto] = datos.cargos[0].pendientes[0].evidencias
    expect(punto.punto).toBe('Sellos de puertas sin fugas')
    expect(punto.comentario).toBe('falta la mercadería')
    expect(punto.fotos).toEqual(['ev/sellos.jpg'])
    // La vista plana sigue existiendo para bajarlas de una sola pasada.
    expect(datos.cargos[0].pendientes[0].fotos).toEqual(['ev/sellos.jpg'])
  })

  it('el Excel lleva la MISMA observación, en la fila del mismo punto', () => {
    const datos = pendiente([
      { checkId: 'c-sellos', punto: 'Sellos de puertas sin fugas', comentario: 'falta la mercadería', fotos: [] }
    ])
    const filas = hojasReporteCargos(datos).find((hoja) => hoja.nombre === 'Pendientes')!.filas

    expect(filas).toContainEqual([
      'Depositaría',
      'Higiene y salubridad',
      'Equipos de refrigeración en condiciones operativas',
      'Check list',
      'Sellos de puertas sin fugas',
      null,
      'falta la mercadería'
    ])
  })
})

describe('reporte de pendientes por cargo · los puntos de cada fila', () => {
  /** Un ítem de tres puntos, con el peso que le dio el Líder. */
  const conPuntos = [{ id: 'c-1', puntos: 5 }, { id: 'c-2', puntos: 1 }, { id: 'c-3', puntos: 4 }]
  /** El mismo ítem sin peso por punto: el corte es por cantidad. */
  const sinPuntos = [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }]

  const armar = (opciones: { id: string; puntos?: number }[] | null, perdidos: number, checks = 2) =>
    armarReporteCargos(
      { unidad: 'Sucursal Centro', referencia: null, fecha: '2026-11-03', puntajeGeneral: 70 },
      [
        {
          cargo: 'Depositaría',
          porciento: 62,
          fallas: [
            {
              item_id: 'i-1',
              tipo: 'CHECKLIST',
              texto: 'Refrigeración',
              modulo_id: null,
              perdidos,
              checks: Array.from({ length: checks }, (_, i) => `Punto ${i + 1}`),
              checkIds: Array.from({ length: checks }, (_, i) => `c-${i + 1}`)
            }
          ]
        }
      ],
      [],
      { respuestas: [], items: [{ id: 'i-1', opciones }] }
    )

  it('reparte el total del ítem respetando el peso de cada punto', () => {
    // Ítem de 10 puntos donde cayeron los de 5 y los de 1: al de 5 le cuesta
    // cinco y al de 1 le cuesta uno —el mismo orden de grandeza que el badge
    // «N pts» del módulo—, y los dos suman el total del ítem.
    const [p] = armar(conPuntos, 6).cargos[0].pendientes
    expect(p.puntos).toEqual([5, 1])
    expect(p.puntos.reduce((a, b) => a + b, 0)).toBe(p.perdidos)
  })

  it('sin peso por punto reparte en partes iguales', () => {
    const [p] = armar(sinPuntos, 6).cargos[0].pendientes
    expect(p.puntos).toEqual([3, 3])
  })

  it('la columna cierra EXACTO contra el TOTAL, aunque el reparto no sea redondo', () => {
    const [p] = armar(conPuntos, 10, 3).cargos[0].pendientes
    expect(p.puntos).toHaveLength(3)
    const suma = p.puntos.reduce((a, b) => a + b, 0)
    expect(suma).toBeCloseTo(p.perdidos, 6)
    // La última fila es la que se lleva el resto del redondeo.
    expect(p.puntos[2]).toBe(10 - p.puntos[0] - p.puntos[1])
  })

  it('si los nombres y los ids de los puntos no están alineados, no reparte nada', () => {
    // Un número en la fila equivocado es peor que un guion.
    const datos = armarReporteCargos(
      { unidad: 'U', referencia: null, fecha: '2026-11-03', puntajeGeneral: 70 },
      [
        {
          cargo: 'Depositaría',
          porciento: 62,
          fallas: [
            {
              item_id: 'i-1',
              tipo: 'CHECKLIST',
              texto: 'Refrigeración',
              modulo_id: null,
              perdidos: 6,
              // Dos nombres contra un solo id: no hay con qué casarlos.
              checks: ['Punto 1', 'Punto repetido'],
              checkIds: ['c-1']
            }
          ]
        }
      ],
      [],
      { respuestas: [], items: [{ id: 'i-1', opciones: conPuntos }] }
    )
    expect(datos.cargos[0].pendientes[0].puntos).toEqual([])
  })

  it('el número sale en el PDF y en el Excel, y sin contexto sale un guion', () => {
    const datos = armar(conPuntos, 6)
    expect(buildReporteCargos(datos).output()).toContain('5')

    const filas = hojasReporteCargos(datos).find((h) => h.nombre === 'Pendientes')!.filas
    expect(filas).toContainEqual(['Depositaría', null, 'Refrigeración', 'Check list', 'Punto 1', 5, null])

    // Sin contexto no hay con qué repartir: guion, nunca una celda en blanco.
    const vacio = armarReporteCargos(
      { unidad: 'U', referencia: null, fecha: '2026-11-03', puntajeGeneral: null },
      [
        {
          cargo: 'Depositaría',
          porciento: null,
          fallas: [
            {
              item_id: 'i-1',
              tipo: 'CHECKLIST',
              texto: 'Refrigeración',
              modulo_id: null,
              perdidos: 6,
              checks: ['Punto 1'],
              checkIds: ['c-1']
            }
          ]
        }
      ],
      []
    )
    const salida = buildReporteCargos(vacio).output()
    expect(salida).toContain('Punto 1')
    expect(salida).toContain('TOTAL del ítem')
    // El guion no se puede buscar en el PDF: jsPDF lo escribe como secuencia
    // octal (no está en Latin-1), así que se busca en el código que lo pinta.
    const codigo = readFileSync(fileURLToPath(new URL('./reporteCargos.ts', import.meta.url)), 'utf8')
    expect(codigo).toContain("pendiente.puntos[i] == null ? '—' : fmt(pendiente.puntos[i])")
  })
})

describe('reporte de pendientes por cargo · el orden en que se pinta', () => {
  /** PNG válido de 1x1: no importa qué se ve, importa DÓNDE para. */
  const PNG_1x1 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('cada foto sale debajo del rótulo de SU punto, y cada observación debajo de la suya', () => {
    // Es el pedido entero: que una foto se lea como del punto que tiene
    // arriba. Se lee el flujo de contenido del PDF (jsPDF lo deja sin
    // comprimir) porque el orden de los operadores ES el orden de pintada, y
    // ningún otro test mira ese orden —los demás sólo chequean que el texto
    // esté en algún lugar del documento—.
    const datos: ReporteCargosDatos = {
      unidad: 'Sucursal Centro',
      referencia: null,
      fecha: '2026-11-03',
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
              puntos: [4.5, 4],
              evidencias: [
                {
                  checkId: 'c-sellos',
                  punto: 'Sellos de puertas sin fugas',
                  comentario: 'falta la mercadería',
                  fotos: ['ev/1.png', 'ev/2.png']
                },
                {
                  checkId: 'c-sensor',
                  punto: 'Sensor de alarma conectado',
                  comentario: '',
                  fotos: ['ev/3.png']
                }
              ],
              fotos: ['ev/1.png', 'ev/2.png', 'ev/3.png']
            },
            {
              item: 'La góndola de perfumería tiene el precio puesto',
              modulo: 'Estética del punto de venta',
              tipo: 'CUMPLE_NO_CUMPLE',
              perdidos: 4,
              checks: [],
              puntos: [],
              evidencias: [
                { checkId: null, punto: '', comentario: 'Se reparó el estante', fotos: ['ev/4.png'] },
                { checkId: null, punto: '', comentario: 'Falta el precio base', fotos: [] }
              ],
              fotos: ['ev/4.png']
            }
          ]
        }
      ]
    }
    const imagenes: Record<string, string> = {}
    for (const ruta of ['ev/1.png', 'ev/2.png', 'ev/3.png', 'ev/4.png']) imagenes[ruta] = PNG_1x1

    const pdf = buildReporteCargos(datos, imagenes)
    const paginas = (pdf.internal.pages as unknown as Array<Array<string>>).filter((p) => Array.isArray(p))
    const flujo = paginas.map((p) => p.join('')).join('\n')

    // Todas las fotos son la MISMA imagen de prueba, así que jsPDF las guarda
    // en UN solo XObject (`/I0`) y las pinta cuatro veces; el logo del pie es
    // otro (`/I1`) y queda fuera.
    const fotos: number[] = []
    for (let i = flujo.indexOf('/I0 Do'); i > -1; i = flujo.indexOf('/I0 Do', i + 1)) fotos.push(i)
    const [foto1, foto2, foto3, foto4] = fotos
    const antes = (aguja: string, limite: number) => flujo.lastIndexOf(aguja, limite)
    const en = (aguja: string) => flujo.indexOf(aguja)

    // La columna de la observación está, y el texto está en la celda de su
    // punto (no en un pie ni en un anexo).
    expect(en('Comentario')).toBeGreaterThan(-1)
    expect(en('falta la mercader')).toBeGreaterThan(-1)
    // Las cuatro fotos se pintaron.
    expect(fotos).toHaveLength(4)

    // El rótulo del PRIMER punto va pegado a sus fotos…
    const rotulo1 = antes('Sellos de puertas sin fugas', foto1)
    expect(rotulo1).toBeGreaterThan(-1)
    expect(rotulo1).toBeLessThan(foto1)
    // …y el del segundo DESPUÉS del grupo anterior y ANTES de la suya: si
    // saliera al revés, la foto se leería como del punto equivocado.
    const rotulo2 = antes('Sensor de alarma conectado', foto3)
    expect(rotulo2).toBeGreaterThan(foto2)
    expect(rotulo2).toBeLessThan(foto3)

    // En el ítem completo manda la observación: cada una pega su foto y van
    // en el orden en que se escribieron.
    const obs1 = en('Se repar')
    const obs2 = en('Falta el precio base')
    expect(obs1).toBeGreaterThan(-1)
    expect(obs1).toBeLessThan(foto4)
    expect(obs1).toBeLessThan(obs2)
  })
})
