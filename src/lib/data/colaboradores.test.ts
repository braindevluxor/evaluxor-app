import { describe, expect, it } from 'vitest'
import { ordenarTrabajadores } from './colaboradores'

describe('ordenarTrabajadores', () => {
  it('ordena primero por apellido, luego por nombre y desempata por DNI', () => {
    const trabajadores = [
      { dni: 9, lastname: 'Zúñiga', name: 'Ana' },
      { dni: 8, lastname: 'Álvarez', name: 'Zoe' },
      { dni: 7, lastname: 'Alvarez', name: 'Ana' },
      { dni: 3, lastname: 'Álvarez', name: 'Ana' }
    ]

    expect(ordenarTrabajadores(trabajadores).map((trabajador) => trabajador.dni)).toEqual([3, 7, 8, 9])
    expect(trabajadores.map((trabajador) => trabajador.dni)).toEqual([9, 8, 7, 3])
  })
})
