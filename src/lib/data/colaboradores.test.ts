import { describe, expect, it } from 'vitest'
import { cedula, nombreCompleto, trabajadoresParaCargo, type ColaboradorAPI } from './colaboradores'

/** Trabajador de prueba; el `extra` pisa lo que se quiera probar. */
function t(extra: Partial<ColaboradorAPI>): ColaboradorAPI {
  return {
    nationality: 'V',
    dni: 12345678,
    name: 'Ana',
    lastname: 'Pérez',
    role_name: 'Cajero integral',
    active: true,
    ...extra
  }
}

describe('trabajadoresParaCargo', () => {
  const listado = [
    t({ dni: 1, name: 'Ana', lastname: 'Pérez', role_name: 'Cajero integral' }),
    t({ dni: 2, name: 'Beto', lastname: 'Gómez', role_name: 'Cajera Integral' }),
    t({ dni: 3, name: 'Caro', lastname: 'Díaz', role_name: 'Depositaría' }),
    // Inactivo: no entra aunque tenga el mismo cargo.
    t({ dni: 4, name: 'Dana', lastname: 'Ríos', role_name: 'Cajero integral', active: false })
  ]

  it('devuelve los activos de ese cargo, sin importar tildes ni mayúsculas', () => {
    const r = trabajadoresParaCargo(listado, 'Cajero integral')
    expect(r.trabajadores.map((c) => c.dni)).toEqual([1, 2])
    expect(r.porCargo).toBe(true)
  })

  it('un cargo más corto también alcanza: «Cajero» encuentra a los cajeros', () => {
    expect(trabajadoresParaCargo(listado, 'cajero').trabajadores.map((c) => c.dni)).toEqual([1, 2])
  })

  it('si el cargo no figura en la unidad, no se lista a nadie: es normal que no todos apliquen', () => {
    // Listar a los demás en este caso invita a notificar a la persona
    // equivocada: el cargo directamente no está habilitado en esa sucursal.
    const r = trabajadoresParaCargo(listado, 'Encargado de turno')
    expect(r.trabajadores).toEqual([])
    expect(r.porCargo).toBe(false)
  })

  it('sin activos no hay a quién notificar', () => {
    expect(trabajadoresParaCargo([t({ active: false })], 'Cajero integral')).toEqual({
      trabajadores: [],
      porCargo: false
    })
  })
})

describe('nombre y cédula, para el papel', () => {
  it('el nombre completo va apellido y nombre como en la nómina', () => {
    expect(nombreCompleto({ name: 'Ana', lastname: 'Pérez' })).toBe('Ana Pérez')
    expect(nombreCompleto({ name: ' Beto ', lastname: ' Gómez ' })).toBe('Beto Gómez')
    expect(nombreCompleto({ lastname: 'Sin nombre' })).toBe('Sin nombre')
  })

  it('la cédula se escribe con su nacionalidad y con puntos', () => {
    expect(cedula({ nationality: 'V', dni: 12345678 })).toBe('V-12345678')
    expect(cedula({ nationality: 'E', dni: 999 })).toBe('E-999')
    expect(cedula({ dni: 5 })).toBe('V-5')
    expect(cedula({})).toBe('—')
  })
})
