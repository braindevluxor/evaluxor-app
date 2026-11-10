import { describe, expect, it } from 'vitest'
import {
  cedula,
  departamentoDeColaborador,
  esActivo,
  nombreCompleto,
  trabajadoresDeCargoExacto,
  trabajadoresParaCargo,
  type ColaboradorAPI
} from './colaboradores'

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

describe('esActivo · el estado puede venir de mil formas', () => {
  it('cualquier forma de «no» cuenta como inactivo', () => {
    expect(esActivo(t({ active: true }))).toBe(true)
    expect(esActivo(t({ active: false }))).toBe(false)
    expect(esActivo(t({ active: 1 }))).toBe(true)
    expect(esActivo(t({ active: 0 }))).toBe(false)
    expect(esActivo(t({ active: 'true' }))).toBe(true)
    expect(esActivo(t({ active: 'false' }))).toBe(false)
    expect(esActivo(t({ active: 'NO' }))).toBe(false)
  })

  it('si el flag viene como is_active también se lee', () => {
    // Sin `active`: ése es el caso en el que manda el otro nombre.
    const sinActive: ColaboradorAPI = { dni: 1, name: 'Ana', is_active: true }
    expect(esActivo(sinActive)).toBe(true)
    expect(esActivo({ ...sinActive, is_active: false })).toBe(false)
  })

  it('sin ningún flag no se cuenta: para plata no se paga a quien no se sabe si está activo', () => {
    const sinFlag: ColaboradorAPI = { dni: 1, name: 'Ana' }
    expect(esActivo(sinFlag)).toBe(false)
    // Y si `active` viene vacío, tampoco.
    expect(esActivo(t({ active: '' }))).toBe(false)
  })
})

describe('trabajadoresDeCargoExacto · el cruce para contar y pagar', () => {
  const nomina: ColaboradorAPI[] = [
    t({ dni: 1, name: 'Ana', role_name: 'Gerente de Mercado' }),
    // El mismo puesto escrito distinto: género y mayúsculas no importan.
    t({ dni: 2, name: 'Beto', role_name: 'GERENTE DE MERCADO' }),
    t({ dni: 3, name: 'Caro', role_name: 'Cajera Integral' }),
    // El peligro del cruce difuso: «Gerente» está contenido en
    // «Gerente de mercado» y «Gerente de Mercado Regional» lo contiene.
    t({ dni: 4, name: 'Dana', role_name: 'Gerente' }),
    t({ dni: 5, name: 'Ema', role_name: 'Gerente de Mercado Regional' }),
    // Inactivo con el cargo exacto: no cuenta.
    t({ dni: 6, name: 'Fabi', role_name: 'Gerente de Mercado', active: false })
  ]

  it('el mismo puesto, con la tolerancia de género y mayúsculas', () => {
    expect(trabajadoresDeCargoExacto(nomina, 'Gerente de mercado').map((c) => c.dni)).toEqual([1, 2])
    expect(trabajadoresDeCargoExacto(nomina, 'Cajero integral').map((c) => c.dni)).toEqual([3])
  })

  it('un cargo parecido no alcanza: ni el más corto ni el más largo', () => {
    const gerentes = trabajadoresDeCargoExacto(nomina, 'Gerente de mercado').map((c) => c.dni)
    expect(gerentes).not.toContain(4)
    expect(gerentes).not.toContain(5)
  })

  it('los inactivos quedan afuera aunque tengan el cargo exacto', () => {
    expect(trabajadoresDeCargoExacto(nomina, 'Gerente de Mercado').map((c) => c.dni)).not.toContain(6)
  })

  it('sin cargo no hay nada que buscar', () => {
    expect(trabajadoresDeCargoExacto(nomina, '  ')).toEqual([])
  })

  it('con departamento acotado, sólo cuenta quien lo trae en la nómina', () => {
    const conArea: ColaboradorAPI[] = [
      t({ dni: 1, role_name: 'Comprador/a', department_name: 'Compras' }),
      t({ dni: 2, role_name: 'Comprador/a', department_name: 'Servicios Generales' }),
      // Sin departamento: para un bono acotado a un área no se cuenta.
      t({ dni: 3, role_name: 'Comprador/a' })
    ]
    expect(trabajadoresDeCargoExacto(conArea, 'Comprador/a', 'Compras').map((c) => c.dni)).toEqual([1])
    // Sin área acotada, entran los tres.
    expect(trabajadoresDeCargoExacto(conArea, 'Comprador/a').map((c) => c.dni)).toEqual([1, 2, 3])
    // Mayúsculas y tildes del área también se ignoran.
    expect(trabajadoresDeCargoExacto(conArea, 'Comprador/a', 'COMPRAS').map((c) => c.dni)).toEqual([1])
  })
})

describe('departamentoDeColaborador · de dónde sale el área', () => {
  it('lee department_name (la forma real) y también las otras', () => {
    expect(departamentoDeColaborador({ dni: 1, department_name: 'Compras' })).toBe('Compras')
    expect(departamentoDeColaborador({ dni: 1, departamento: 'Almacén' })).toBe('Almacén')
    expect(departamentoDeColaborador({ dni: 1, department: { id: 4, name: 'Limpieza' } })).toBe('Limpieza')
    expect(departamentoDeColaborador({ dni: 1, area: 'Patio' })).toBe('Patio')
  })

  it('sin ninguno queda vacío: no se inventa un área', () => {
    expect(departamentoDeColaborador({ dni: 1 })).toBe('')
    expect(departamentoDeColaborador({ dni: 1, department_name: '   ' })).toBe('')
    expect(departamentoDeColaborador({ dni: 1, department: { id: 9 } })).toBe('')
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
