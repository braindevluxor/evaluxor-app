import { describe, expect, it } from 'vitest'
import { normalizarEtiquetaRegistro, yaExisteRegistroConEtiqueta } from './registro'

describe('normalizarEtiquetaRegistro', () => {
  it('normaliza mayúsculas, acentos y espacios', () => {
    expect(normalizarEtiquetaRegistro('  ÁBC 123 ')).toBe('abc123')
  })
})

describe('yaExisteRegistroConEtiqueta', () => {
  it('detecta un registro duplicado en la lista actual', () => {
    const registros = [
      { etiqueta: 'ABC 123' },
      { etiqueta: 'XYZ 999' }
    ]

    expect(yaExisteRegistroConEtiqueta(registros, 'abc123')).toBe(true)
    expect(yaExisteRegistroConEtiqueta(registros, 'xyz 999')).toBe(true)
    expect(yaExisteRegistroConEtiqueta(registros, 'QWE 000')).toBe(false)
  })
})
