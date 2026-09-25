import { describe, expect, it } from 'vitest'
import { normalizarCatalogoResponsables } from './responsables'

describe('normalizarCatalogoResponsables', () => {
  it('obtiene el cargo del name y el departamento de department.name', () => {
    const resultado = normalizarCatalogoResponsables([
      {
        id: 2310000,
        name: 'Analista de Inventario',
        approved: 1,
        current: 1,
        department: { id: 411, name: 'Inventario' }
      }
    ])

    expect(resultado).toContainEqual({ departamento: 'Inventario', cargo: 'Analista de Inventario' })
  })
})