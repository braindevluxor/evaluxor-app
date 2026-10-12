import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { subtituloMedidor } from './subtituloMedidor'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('subtituloMedidor', () => {
  it('enumera sucursales y departamentos por separado', () => {
    // No puede decir "sucursales" si lo que midió el módulo fue un
    // departamento: era la mentira que tapaba el caso de Flota Vehicular.
    expect(subtituloMedidor({ sucursales: 2, departamentos: 1, sinDatos: 1 })).toBe(
      '2 de 3 sucursales · 1 departamento'
    )
    expect(subtituloMedidor({ sucursales: 0, departamentos: 1, sinDatos: 0 })).toBe('1 departamento')
    expect(subtituloMedidor({ sucursales: 0, departamentos: 2, sinDatos: 0 })).toBe('2 departamentos')
  })

  it('cuenta las sucursales sin evaluación sólo cuando ninguna llegó con datos', () => {
    expect(subtituloMedidor({ sucursales: 1, departamentos: 0, sinDatos: 2 })).toBe('1 de 3 sucursales')
    expect(subtituloMedidor({ sucursales: 0, departamentos: 0, sinDatos: 3 })).toBe('3 sucursales sin evaluación')
  })

  it('el texto de vacío lo elige cada pantalla', () => {
    // En el dashboard el módulo puede estar simplemente sin sucursales
    // configuradas; en el del módulo lo que no hay es nada en el rango.
    expect(subtituloMedidor({ sucursales: 0, departamentos: 0, sinDatos: 0 })).toBe('Sin sucursales activas')
    expect(
      subtituloMedidor({ sucursales: 0, departamentos: 0, sinDatos: 0 }, 'Sin sucursales en el rango')
    ).toBe('Sin sucursales en el rango')
  })

  it('las dos pantallas usan la MISMA función', () => {
    // DashboardHome y ModuloDashboard habían quedado con dos ternarios casi
    // iguales y textos distintos para la misma pieza.
    for (const archivo of ['../../pages/dashboard/DashboardHome.tsx', '../../pages/dashboard/ModuloDashboard.tsx']) {
      const codigo = fuente(archivo)
      expect(codigo, archivo).toContain('subtituloMedidor(')
      // Y que ninguna siga armando el rótulo a mano.
      expect(codigo, archivo).not.toContain('sucursales sin evaluación`')
    }
  })
})
