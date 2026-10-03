import { describe, it, expect } from 'vitest'
import { photoPath, convertirValor, extraerPhotoIds, idsFotosRespuesta, valorSinFotos } from './transform'

describe('photoPath', () => {
  it('construye ruta estable', () => {
    expect(photoPath('abc', 'item1', 'foto1')).toBe('ev/abc/item1/foto1.jpg')
  })
})

describe('extraerPhotoIds', () => {
  it('acepta arreglo plano y objeto con photoIds', () => {
    expect(extraerPhotoIds(['a', 'b'])).toEqual(['a', 'b'])
    expect(extraerPhotoIds({ photoIds: ['x'] })).toEqual(['x'])
    expect(extraerPhotoIds('hola')).toEqual([])
    expect(extraerPhotoIds({ photoIds: [1] })).toEqual([])
    expect(extraerPhotoIds(null)).toEqual([])
  })
  it('extrae photoIds anidados de evidencias de cumple/no cumple', () => {
    expect(
      extraerPhotoIds({ value: true, evidencias: [{ photoIds: ['a', 'b'], comentario: 'ok' }, { photoIds: ['c'], comentario: '' }] })
    ).toEqual(['a', 'b', 'c'])
    expect(extraerPhotoIds({ value: false, evidencias: [] })).toEqual([])
    expect(extraerPhotoIds({ value: true })).toEqual([])
  })
  it('extrae evidencia aunque aún no se haya elegido Cumple o No cumple', () => {
    expect(extraerPhotoIds({ value: null, evidencias: [{ photoIds: ['captura-1'] }] })).toEqual(['captura-1'])
    expect(extraerPhotoIds({ evidencias: [{ photoIds: ['captura-2'] }] })).toEqual(['captura-2'])
  })
  it('extrae photoIds de evidencias de checklist', () => {
    expect(
      extraerPhotoIds({ selected: ['a', 'b'], evidencias: { a: { photoIds: ['x'] }, b: { photoIds: ['y', 'z'] } } })
    ).toEqual(['x', 'y', 'z'])
    expect(extraerPhotoIds({ selected: ['a', 'b'], evidencias: {} })).toEqual([])
    expect(extraerPhotoIds({ selected: [] })).toEqual([])
  })
  it('extrae las imágenes de los planos de un ítem Cumplimiento XY', () => {
    const valor = {
      planos: [
        { id: 'p1', nombre: 'Planta baja', photoIds: ['a', 'b'] },
        { id: 'p2', nombre: 'Mezanine', photoIds: [] }
      ],
      puntos: [{ id: 'x', planoId: 'p1', x: 0.5, y: 0.5, cumple: false, comentario: '' }]
    }
    expect(extraerPhotoIds(valor)).toEqual(['a', 'b'])
    // Un valor con `planos` pero sin fotos (o vacío) no aporta ids.
    expect(extraerPhotoIds({ planos: [], puntos: [] })).toEqual([])
    expect(extraerPhotoIds({ planos: [{ id: 'p', nombre: 'x' }], puntos: [] })).toEqual([])
  })
})

describe('idsFotosRespuesta', () => {
  it('reconstruye la lista de fotos de un checklist además de conservar ids guardados en cola', () => {
    expect(idsFotosRespuesta([
      {
        valor: {
          selected: [],
          evidencias: {
            limpieza: { photoIds: ['foto-local-1', 'foto-local-2'] },
            otra: { photoIds: ['foto-local-1'] }
          }
        }
      }
    ], ['foto-guardada'])).toEqual(['foto-guardada', 'foto-local-1', 'foto-local-2'])
  })
})

describe('valorSinFotos', () => {
  it('conserva los valores numéricos de opciones RANGO del checklist', () => {
    expect(
      valorSinFotos({ selected: ['a', 'b'], valores: { a: 40 }, evidencias: { a: { photoIds: ['f1'] } }, informativos: ['b'] })
    ).toEqual({ selected: ['a', 'b'], valores: { a: 40 }, informativos: ['b'] })
  })
  it('omite valores vacíos y pasa intactos los demás tipos', () => {
    expect(valorSinFotos({ selected: ['a'], valores: {}, evidencias: {} })).toEqual({ selected: ['a'] })
    expect(valorSinFotos({ value: true, evidencias: [] })).toEqual({ value: true, evidencias: [] })
    expect(valorSinFotos('texto')).toBe('texto')
  })
  it('quita fotos locales de evidencias Cumple / No cumple sin perderlas al sincronizar', () => {
    expect(valorSinFotos({
      value: null,
      evidencias: [{ photoIds: ['captura-1'], comentario: 'Evidencia pendiente' }]
    })).toEqual({
      value: null,
      evidencias: [{ comentario: 'Evidencia pendiente' }]
    })
  })
  it('en un plano conserva planos y pines pero quita las fotos locales', () => {
    // El auto-guardado en nube va sin fotos (se suben al enviar); los pines se conservan.
    expect(
      valorSinFotos({
        planos: [{ id: 'p1', nombre: 'Planta baja', photoIds: ['a'] }],
        puntos: [{ id: 'x', planoId: 'p1', x: 0.25, y: 0.75, cumple: false, comentario: 'falta góndola' }]
      })
    ).toEqual({
      planos: [{ id: 'p1', nombre: 'Planta baja', photoIds: [] }],
      puntos: [{ id: 'x', planoId: 'p1', x: 0.25, y: 0.75, cumple: false, comentario: 'falta góndola' }]
    })
    expect(valorSinFotos({ planos: [{ id: 'p1', nombre: 'X', photoIds: ['a'] }], puntos: [], informativo: true })).toEqual({
      planos: [{ id: 'p1', nombre: 'X', photoIds: [] }],
      puntos: [],
      informativo: true
    })
  })
})

describe('convertirValor', () => {
  it('convierte photoIds a paths', () => {
    const map = new Map([['f1', 'ev/x/y/f1.jpg']])
    expect(convertirValor({ photoIds: ['f1', 'f2'] }, map)).toEqual({
      paths: ['ev/x/y/f1.jpg', '.local/f2']
    })
  })
  it('convierte evidencias de cumple/no cumple a paths', () => {
    const map = new Map([['a', 'ev/x/y/a.jpg']])
    expect(
      convertirValor(
        { value: true, evidencias: [{ photoIds: ['a'], comentario: 'ok' }, { photoIds: ['b'], comentario: 'x' }] },
        map
      )
    ).toEqual({
      value: true,
      evidencias: [
        { comentario: 'ok', paths: ['ev/x/y/a.jpg'] },
        { comentario: 'x', paths: ['.local/b'] }
      ]
    })
  })
  it('convierte las evidencias a paths aunque el veredicto esté pendiente', () => {
    const map = new Map([['captura-1', 'ev/x/y/captura-1.jpg']])
    expect(convertirValor({
      value: null,
      evidencias: [{ photoIds: ['captura-1'], comentario: 'Pendiente' }]
    }, map)).toEqual({
      value: null,
      evidencias: [{ comentario: 'Pendiente', paths: ['ev/x/y/captura-1.jpg'] }]
    })
  })
  it('convierte evidencias de checklist a paths', () => {
    const map = new Map([['x', 'ev/c/d/x.jpg']])
    expect(
      convertirValor(
        { selected: ['a', 'b'], evidencias: { a: { photoIds: ['x'] }, b: { photoIds: ['y'] } } },
        map
      )
    ).toEqual({
      selected: ['a', 'b'],
      evidencias: {
        a: { paths: ['ev/c/d/x.jpg'] },
        b: { paths: ['.local/y'] }
      }
    })
  })
  it('convierte las imágenes de los planos y deja los pines intactos', () => {
    const map = new Map([['a', 'ev/job/evidencia/a.jpg']])
    const puntos = [{ id: 'x', planoId: 'p1', x: 0.25, y: 0.75, cumple: false, comentario: 'falta góndola' }]
    expect(
      convertirValor(
        {
          planos: [
            { id: 'p1', nombre: 'Planta baja', photoIds: ['a'] },
            { id: 'p2', nombre: 'Mezanine', photoIds: ['b'] }
          ],
          puntos,
          responsables: ['Caro'],
          responsablesGerente: 'Elena'
        },
        map
      )
    ).toEqual({
      planos: [
        { id: 'p1', nombre: 'Planta baja', paths: ['ev/job/evidencia/a.jpg'] },
        { id: 'p2', nombre: 'Mezanine', paths: ['.local/b'] }
      ],
      puntos,
      responsables: ['Caro'],
      responsablesGerente: 'Elena'
    })
  })
  it('conserva los valores numéricos de opciones RANGO del checklist', () => {
    const map = new Map<string, string>()
    expect(
      convertirValor(
        { selected: ['a', 'b'], valores: { a: 40, b: 25 }, evidencias: { a: { photoIds: ['x'] } } },
        map
      )
    ).toEqual({
      selected: ['a', 'b'],
      valores: { a: 40, b: 25 },
      evidencias: { a: { paths: ['.local/x'] } }
    })
  })
  it('deja pasar otros valores', () => {
    const map = new Map<string, string>()
    expect(convertirValor({ value: true }, map)).toEqual({ value: true })
    expect(convertirValor('texto', map)).toBe('texto')
    expect(convertirValor(5, map)).toBe(5)
  })
})