import { describe, expect, it } from 'vitest'
import { ocultarCentroCodigoEvaluacion } from './codigoEvaluacion'

describe('ocultarCentroCodigoEvaluacion', () => {
  const uuid = '0af7a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b'

  it('esconde el centro del id y conserva los bordes agrupados como UUID', () => {
    const enmascarado = ocultarCentroCodigoEvaluacion(uuid)
    expect(enmascarado).not.toBe(uuid)
    expect(enmascarado).toBe('0af7a1b2-c3d4-****-****-0c1d2e3f4a5b')
    expect(enmascarado).toHaveLength(36)
  })

  it('deja pasar lo que no es un id hexadecimal de32', () => {
    expect(ocultarCentroCodigoEvaluacion('ev-demo')).toBe('ev-demo')
    expect(ocultarCentroCodigoEvaluacion('')).toBe('')
  })
})
