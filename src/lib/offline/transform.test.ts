import { describe, it, expect } from 'vitest'
import { photoPath, convertirValor, extraerPhotoIds, valorSinFotos } from './transform'

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
  it('extrae photoIds de evidencias de checklist', () => {
    expect(
      extraerPhotoIds({ selected: ['a', 'b'], evidencias: { a: { photoIds: ['x'] }, b: { photoIds: ['y', 'z'] } } })
    ).toEqual(['x', 'y', 'z'])
    expect(extraerPhotoIds({ selected: ['a', 'b'], evidencias: {} })).toEqual([])
    expect(extraerPhotoIds({ selected: [] })).toEqual([])
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