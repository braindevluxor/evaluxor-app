import { describe, expect, it } from 'vitest'
import type { jsPDF } from 'jspdf'
import {
  buildAutorizacionExcepcion,
  buildRelacionCargoMonto,
  filasRelacionCargoMonto,
  type AutorizacionExcepcionDatos
} from './bonos'
import type { BonoCargo } from '../data/bonos'

/**
 * Los papeles de bonos en PDF: la relación que firma Presidencia y el
 * soporte de la autorización de una excepción.
 *
 * Dos niveles de prueba, como en el resto de los PDF: la relación se prueba
 * como DATO (qué filas arma) y los dos documentos como TEXTO (lo que dicen),
 * leyendo el archivo crudo con los paréntesis que jsPDF escapa (`\(a\)`).
 */

function texto(pdf: jsPDF): string {
  return pdf.output().replace(/\\\(/g, '(').replace(/\\\)/g, ')')
}

function cargo(parcial: Partial<BonoCargo> = {}): BonoCargo {
  return {
    id: 'b1',
    cargo: 'Subgerente de Mercado',
    alias: null,
    clave: 'subgerentedemercado',
    activo: true,
    monto: 414,
    nota_minima: 70,
    periodicidad: 'MENSUAL',
    departamento: null,
    sucursales: [],
    excluidos: [],
    excepciones: [],
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...parcial
  }
}

const SUCURSALES = [
  { id: 's1', nombre: 'Sucursal Centro' },
  { id: 's2', nombre: 'Sucursal Norte' }
]

describe('filasRelacionCargoMonto · cargo, sucursal y monto para firmar', () => {
  it('un cargo sin alcance es UNA fila: «Todas las sucursales» con el monto base', () => {
    expect(filasRelacionCargoMonto([cargo()], SUCURSALES)).toEqual([
      { cargo: 'Subgerente de Mercado', sucursal: 'Todas las sucursales', monto: 414 }
    ])
  })

  it('con alcance es una fila POR TIENDA, con el monto propio o el base si la fila no trae', () => {
    const filas = filasRelacionCargoMonto(
      [
        cargo({
          sucursales: [
            { sucursal_id: 's2', monto: 500 },
            // Sin monto propio: usa el del cargo.
            { sucursal_id: 's1', monto: null }
          ]
        })
      ],
      SUCURSALES
    )

    // El orden es alfabético por tienda: el documento se lee igual para todos.
    expect(filas).toEqual([
      { cargo: 'Subgerente de Mercado', sucursal: 'Sucursal Centro', monto: 414 },
      { cargo: 'Subgerente de Mercado', sucursal: 'Sucursal Norte', monto: 500 }
    ])
  })

  it('el área viaja en el cargo: dos «Subgerente» de áreas distintas no se confunden', () => {
    const [fila] = filasRelacionCargoMonto([cargo({ departamento: 'Gerencia de Mercado' })], SUCURSALES)
    expect(fila.cargo).toBe('Subgerente de Mercado (Gerencia de Mercado)')
  })

  it('los cargos inactivos no aparecen: lo que se firma es lo que se paga', () => {
    expect(filasRelacionCargoMonto([cargo({ activo: false })], SUCURSALES)).toEqual([])
  })
})

describe('relación cargo · sucursal · monto · PDF', () => {
  it('trae las tres columnas pedidas y el renglón de firma de Presidencia', () => {
    const t = texto(buildRelacionCargoMonto(filasRelacionCargoMonto([cargo()], SUCURSALES)))

    expect(t).toContain('Relación de cargos y montos')
    expect(t).toContain('Cargo')
    expect(t).toContain('Sucursal')
    expect(t).toContain('Monto')
    expect(t).toContain('Subgerente de Mercado')
    expect(t).toContain('Todas las sucursales')
    expect(t).toContain('414')
    expect(t).toContain('Presidencia')
    expect(t).toContain('Fecha')
  })

  it('sin cargos activos dice que no hay nada que relacionar, pero el papel sale completo', () => {
    const t = texto(buildRelacionCargoMonto([]))

    expect(t).toContain('No hay cargos activos configurados')
    expect(t).toContain('Presidencia')
  })
})

function datosAutorizacion(extra: Partial<AutorizacionExcepcionDatos> = {}): AutorizacionExcepcionDatos {
  return {
    cargo: 'Subgerente de Mercado Tipo C',
    departamento: 'Gerencia de Mercado',
    cargoNomina: 'Cajero integral',
    trabajador: { nombre: 'Ana Pérez', nacionalidad: 'V', dni: 12345678 },
    sucursal: 'Sucursal Centro',
    monto: 414,
    ...extra
  }
}

describe('autorización de ocupante por excepción · PDF', () => {
  it('nombra a la persona, al cargo, a la tienda y al monto: lo que se firma', () => {
    const t = texto(buildAutorizacionExcepcion(datosAutorizacion()))

    expect(t).toContain('Autorización de ocupante por excepción')
    expect(t).toContain('Ana Pérez')
    expect(t).toContain('V-12345678')
    expect(t).toContain('Subgerente de Mercado Tipo C')
    expect(t).toContain('Gerencia de Mercado')
    expect(t).toContain('Sucursal Centro')
    expect(t).toContain('414')
  })

  it('explica POR QUÉ es excepción: su cargo real en la nómina', () => {
    const t = texto(buildAutorizacionExcepcion(datosAutorizacion()))

    expect(t).toContain('Cajero integral')
    expect(t).toContain('Se autoriza a Ana Pérez')
    // La constancia arranca por la autorización y el motivo, no por el monto.
    expect(t).toContain('a ocupar por excepción el cargo')
  })

  it('sin cargo en la nómina lo dice en vez de dejar la celda vacía', () => {
    const t = texto(buildAutorizacionExcepcion(datosAutorizacion({ cargoNomina: '' })))

    expect(t).toContain('Sin cargo registrado en la nómina')
  })

  it('cierra con las dos firmas: quién autoriza y quien ocupa', () => {
    const t = texto(buildAutorizacionExcepcion(datosAutorizacion()))

    expect(t).toContain('Presidencia')
    expect(t).toContain('Ocupante(a)')
    expect(t).toContain('queda autorizada esta excepción')
  })
})
