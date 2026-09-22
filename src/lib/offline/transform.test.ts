import { describe, it, expect } from 'vitest'
import { photoPath, convertirValor, extraerPhotoIds } from './transform'

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
  it('deja pasar otros valores', () => {
    const map = new Map<string, string>()
    expect(convertirValor({ value: true }, map)).toEqual({ value: true })
    expect(convertirValor('texto', map)).toBe('texto')
    expect(convertirValor(5, map)).toBe(5)
  })
})