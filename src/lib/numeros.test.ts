import { describe, expect, it } from 'vitest'
import { distribuirPorcentajes, num, pct } from './numeros'

describe('formato numérico', () => {
  it('usa coma decimal y tolera null', () => {
    expect(num(86.666666, 2)).toBe('86,67')
    expect(num(15, 0)).toBe('15')
    expect(num(4.300000000000001, 1)).toBe('4,3')
    expect(num(null)).toBe('—')
  })

  it('pct agrega sufijo y mantiene comas', () => {
    expect(pct(86.6666)).toBe('86,67%')
    expect(pct(null)).toBe('—')
  })
})

describe('distribuirPorcentajes', () => {
  it('reparte sin ruido flotante ni desfase de redondeo', () => {
    // Caso reportado: 7x4 + 28 + 23 + 18 + 5 = 102% con redondeo individual.
    const values = [7, 7, 7, 7, 28, 23, 18, 5]
    const shares = distribuirPorcentajes(values)
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
    expect(shares.every((s) => s >= 0 && s <= 100)).toBe(true)
  })

  it('fósforo de magnitud: conserva el orden relativo', () => {
    const shares = distribuirPorcentajes([90, 9, 1])
    expect(shares[0]).toBeGreaterThanOrEqual(shares[1])
    expect(shares[1]).toBeGreaterThanOrEqual(shares[2])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('devuelve ceros cuando no hay magnitud', () => {
    expect(distribuirPorcentajes([0, 0, 0])).toEqual([0, 0, 0])
    expect(distribuirPorcentajes([])).toEqual([])
  })
})