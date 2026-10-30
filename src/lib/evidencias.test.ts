import { describe, expect, it } from 'vitest'
import { pathsDeFotosFalla } from './evidencias'

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
