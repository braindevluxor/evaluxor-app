import { describe, expect, it } from 'vitest'
import { agruparPorDepartamento, fusionarCatalogo, normalizarCatalogoResponsables } from './responsables'

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

describe('fusionarCatalogo', () => {
  it('muestra un solo cargo aunque venga en varios branch', () => {
    // 16 sucursales con «Soldador» y una sin ese cargo: debe quedar uno solo.
    const entradas = [
      ...Array.from({ length: 16 }, (_, i) => ({ departamento: `Sucursal ${i + 1}`, cargo: 'Soldador' })),
      { departamento: 'Mantenimiento', cargo: 'Soldador' },
      { departamento: 'Mantenimiento', cargo: 'Mecánico' }
    ]

    const resultado = fusionarCatalogo(entradas)

    expect(resultado.filter((r) => r.cargo === 'Soldador')).toHaveLength(1)
    expect(resultado.filter((r) => r.cargo === 'Mecánico')).toHaveLength(1)
  })

  it('el cargo repetido queda en el departamento que aparece primero', () => {
    const resultado = fusionarCatalogo([
      { departamento: 'Taller', cargo: 'Soldador' },
      { departamento: 'Mantenimiento', cargo: 'Soldador' }
    ])

    expect(resultado).toEqual([{ departamento: 'Mantenimiento', cargo: 'Soldador' }])
  })

  it('ignora diferencias de mayúsculas, acentos y espacios al repetir', () => {
    const resultado = fusionarCatalogo([
      { departamento: 'Almacén', cargo: 'Mecánico' },
      { departamento: 'Mantenimiento', cargo: 'MECANICO' }
    ])

    expect(resultado).toHaveLength(1)
  })
})

describe('agruparPorDepartamento', () => {
  it('ordena los departamentos y sus cargos', () => {
    const resultado = agruparPorDepartamento([
      { departamento: 'Mantenimiento', cargo: 'Mecánico' },
      { departamento: 'Almacén', cargo: 'Montacarguista' },
      { departamento: 'Mantenimiento', cargo: 'Soldador' }
    ])

    expect(resultado).toEqual([
      { departamento: 'Almacén', cargos: ['Montacarguista'] },
      { departamento: 'Mantenimiento', cargos: ['Mecánico', 'Soldador'] }
    ])
  })
})