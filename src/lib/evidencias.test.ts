import { describe, expect, it } from 'vitest'
import { evidenciasDeFalla, pathsDeFotosFalla } from './evidencias'

/** Un ítem de lista: cada punto tiene su responsable y su propia foto. */
const valorChecklist = {
  selected: ['c-sellos'],
  evidencias: {
    'c-sellos': { paths: ['ev/sellos.jpg'] },
    'c-sensor': { paths: ['ev/sensor.jpg'] }
  }
}

describe('pathsDeFotosFalla · las fotos que le corresponden a UNA falla', () => {
  it('en un ítem de lista sólo lleva las fotos de los puntos que fallaron a ese cargo', () => {
    expect(pathsDeFotosFalla('CHECKLIST', ['c-sellos'], [{ valor: valorChecklist }], [])).toEqual(['ev/sellos.jpg'])
    expect(pathsDeFotosFalla('CHECKLIST', ['c-sensor'], [{ valor: valorChecklist }], [])).toEqual(['ev/sensor.jpg'])
    // Sin puntos atribuidos no hay evidencia que imprimir, aunque el ítem la tenga.
    expect(pathsDeFotosFalla('CHECKLIST', [], [{ valor: valorChecklist }], ['ev/de-la-tabla.jpg'])).toEqual([])
  })

  it('en los ítems de lista IGNORA la tabla `fotos`: esa tabla sólo sabe el ítem, no el punto', () => {
    expect(
      pathsDeFotosFalla('CHECKLIST', ['c-sellos'], [{ valor: valorChecklist }], ['ev/tabla.jpg', 'ev/otro-punto.jpg'])
    ).toEqual(['ev/sellos.jpg'])
  })

  it('no repite la misma foto si el punto aparece en dos respuestas', () => {
    expect(
      pathsDeFotosFalla('CHECKLIST', ['c-sellos'], [{ valor: valorChecklist }, { valor: valorChecklist }], [])
    ).toEqual(['ev/sellos.jpg'])
  })

  it('los tipos sin evidencia por punto salen sin fotos', () => {
    expect(pathsDeFotosFalla('LISTA_COLABORADORES', ['c1'], [{ valor: { colaboradores: [] } }], [])).toEqual([])
    expect(pathsDeFotosFalla('UNIDAD_CHECKLIST', ['c1'], [], [])).toEqual([])
  })

  it('los ítems de tipo completo mantienen TODAS sus fotos: la atribución es del ítem entero', () => {
    expect(
      pathsDeFotosFalla(
        'CUMPLE_NO_CUMPLE',
        [],
        [{ valor: { evidencias: [{ paths: ['ev/a.jpg'] }] } }],
        ['ev/tabla.jpg']
      )
    ).toEqual(['ev/tabla.jpg', 'ev/a.jpg'])
    expect(
      pathsDeFotosFalla('CONCILIACION', [], [{ valor: { productos: [{ sku: '1', paths: ['ev/p.jpg'] }] } }], [])
    ).toEqual(['ev/p.jpg'])
    expect(pathsDeFotosFalla('TEXTO', [], [{ valor: 'un texto' }], ['ev/t.jpg'])).toEqual(['ev/t.jpg'])
  })
})

describe('evidenciasDeFalla · la foto Y la observación de cada punto, juntas', () => {
  it('cada punto que falló sale con lo suyo, debajo de su nombre', () => {
    const bloques = evidenciasDeFalla({
      tipo: 'CHECKLIST',
      checkIds: ['c-sellos', 'c-sensor'],
      checks: ['Sellos de puertas sin fugas', 'Sensor de alarma'],
      respuestas: [
        {
          valor: {
            comentarios: { 'c-sellos': 'falta la mercadería' },
            evidencias: {
              'c-sellos': { paths: ['ev/sellos.jpg'] },
              'c-sensor': { paths: ['ev/sensor.jpg'] }
            }
          }
        }
      ],
      // En los ítems de lista la tabla `fotos` no sabe de qué punto es, así
      // que sigue fuera: es la regla de siempre.
      pathsDeTabla: ['ev/tabla.jpg']
    })

    expect(bloques).toEqual([
      {
        checkId: 'c-sellos',
        punto: 'Sellos de puertas sin fugas',
        comentario: 'falta la mercadería',
        fotos: ['ev/sellos.jpg']
      },
      { checkId: 'c-sensor', punto: 'Sensor de alarma', comentario: '', fotos: ['ev/sensor.jpg'] }
    ])
    expect(bloques.flatMap((b) => b.fotos)).toEqual(['ev/sellos.jpg', 'ev/sensor.jpg'])
  })

  it('en la lista de trabajadores la observación puede venir de varios', () => {
    // Cada trabajador tiene SU diccionario de comentarios: si dos hablaron del
    // mismo punto, las dos observaciones son del punto y las dos van.
    const bloques = evidenciasDeFalla({
      tipo: 'LISTA_COLABORADORES',
      checkIds: ['c1'],
      checks: ['Contrato en regla'],
      respuestas: [
        {
          valor: {
            colaboradores: [
              { comentarios: { c1: 'falta el contrato' } },
              { comentarios: { c1: 'otra observación' } }
            ]
          }
        }
      ],
      pathsDeTabla: []
    })

    expect(bloques[0].comentario).toBe('falta el contrato | otra observación')
  })

  it('en un ítem completo cada evidencia queda separada, con SU observación', () => {
    // Así las arma la pantalla (`EvidenciasEditor`): foto + comentario, una
    // fila por evidencia. Juntarlas en un solo bloque haría que una observación
    // saliera al lado de la foto de otra.
    const bloques = evidenciasDeFalla({
      tipo: 'CUMPLE_NO_CUMPLE',
      checkIds: [],
      checks: [],
      respuestas: [
        {
          valor: {
            evidencias: [
              { paths: ['ev/a.jpg'], comentario: 'Se reparó el estante' },
              { paths: ['ev/b.jpg'], comentario: '' }
            ]
          }
        }
      ],
      pathsDeTabla: ['ev/tabla.jpg']
    })

    expect(bloques).toEqual([
      { checkId: null, punto: '', comentario: '', fotos: ['ev/tabla.jpg'] },
      { checkId: null, punto: '', comentario: 'Se reparó el estante', fotos: ['ev/a.jpg'] },
      { checkId: null, punto: '', comentario: '', fotos: ['ev/b.jpg'] }
    ])
    // La vista plana es la de siempre: la tabla primero, después las evidencias.
    expect(bloques.flatMap((b) => b.fotos)).toEqual(['ev/tabla.jpg', 'ev/a.jpg', 'ev/b.jpg'])
  })

  it('si los nombres no vienen alineados con los ids, el punto sale sin rótulo', () => {
    // Una foto debajo del nombre de OTRO punto sería peor que una foto sin
    // nombre: si las dos listas no coinciden, no se rotula.
    const bloques = evidenciasDeFalla({
      tipo: 'CHECKLIST',
      checkIds: ['c1', 'c2'],
      checks: ['Limpio'],
      respuestas: [{ valor: { evidencias: { c1: { paths: ['ev/1.jpg'] } } } }],
      pathsDeTabla: []
    })

    expect(bloques.map((b) => b.punto)).toEqual(['', ''])
    expect(bloques.map((b) => b.fotos)).toEqual([['ev/1.jpg'], []])
  })

  it('la misma foto no sale dos veces aunque esté en la tabla y en la evidencia', () => {
    const bloques = evidenciasDeFalla({
      tipo: 'CUMPLE_NO_CUMPLE',
      checkIds: [],
      checks: [],
      respuestas: [{ valor: { evidencias: [{ paths: ['ev/a.jpg'], comentario: 'ok' }] } }],
      pathsDeTabla: ['ev/a.jpg']
    })

    expect(bloques.flatMap((b) => b.fotos)).toEqual(['ev/a.jpg'])
  })
})
