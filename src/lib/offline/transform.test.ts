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
})

describe('convertirValor', () => {
  it('convierte photoIds a paths', () => {
    const map = new Map([['f1', 'ev/x/y/f1.jpg']])
    expect(convertirValor({ photoIds: ['f1', 'f2'] }, map)).toEqual({
      paths: ['ev/x/y/f1.jpg', '.local/f2']
    })
  })
  it('deja pasar otros valores', () => {
    const map = new Map<string, string>()
    expect(convertirValor({ value: true }, map)).toEqual({ value: true })
    expect(convertirValor('texto', map)).toBe('texto')
    expect(convertirValor(5, map)).toBe(5)
  })
})