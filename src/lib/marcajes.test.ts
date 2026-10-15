import { describe, expect, it } from 'vitest'
import { clasificarTipo, coloresTipo, etiquetaTipo, normalizarDni } from './marcajes'

describe('normalizarDni', () => {
  it('recorta espacios y ceros a la izquierda', () => {
    expect(normalizarDni(' 01712345678 ')).toBe('1712345678')
    expect(normalizarDni('1712345678')).toBe('1712345678')
    expect(normalizarDni('')).toBe('')
  })
})

describe('clasificarTipo', () => {
  it('alterna ENTRADA/SALIDA por día y trabajador', () => {
    const resultado = clasificarTipo([
      { dni: '1', fecha: '2026-09-28T13:00:00.000Z' },
      { dni: '1', fecha: '2026-09-28T08:00:00.000Z' }
    ])
    expect(resultado).toEqual([
      { dni: '1', fecha: '2026-09-28T08:00:00.000Z', tipo: 'ENTRADA' },
      { dni: '1', fecha: '2026-09-28T13:00:00.000Z', tipo: 'SALIDA' }
    ])

    const alDiaSiguiente = clasificarTipo([{ dni: '1', fecha: '2026-09-29T08:00:00.000Z' }])
    expect(alDiaSiguiente[0].tipo).toBe('ENTRADA')
  })

  it('preserva el tipo ya clasificado por el puente', () => {
    const resultado = clasificarTipo([{ dni: '17', fecha: '2026-09-28T08:00:00.000Z', tipo: 'SALIDA' }])
    expect(resultado[0].tipo).toBe('SALIDA')
  })

  it('normaliza el DNI al clasificar', () => {
    const resultado = clasificarTipo([{ dni: ' 01712345678 ', fecha: '2026-09-28T08:00:00.000Z' }])
    expect(resultado[0].dni).toBe('1712345678')
  })
})

describe('etiquetas de tipo', () => {
  it('mapea colores y nombres', () => {
    expect(coloresTipo('ENTRADA')).toBe(2)
    expect(coloresTipo('SALIDA')).toBe(4)
    expect(coloresTipo('OTRO')).toBe(0)
    expect(etiquetaTipo('ENTRADA')).toBe('Entrada')
    expect(etiquetaTipo('SALIDA')).toBe('Salida')
    expect(etiquetaTipo('OTRO')).toBe('Sin clasificar')
  })
})