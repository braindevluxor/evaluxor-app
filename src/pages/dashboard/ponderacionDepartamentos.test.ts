import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El dashboard ya suma departamentos a sus análisis: el gráfico de
 * "Ponderación por sucursal y módulo" tiene su gemelo por departamento, con el
 * mismo dibujo y el mismo clic, pero apuntando a la unidad que corresponde.
 */
describe('dashboard · ponderación por departamento y módulo', () => {
  it('el mismo gráfico se dibuja dos veces, una por cada clase de unidad', () => {
    const pagina = fuente('./DashboardHome.tsx')
    // Un solo componente para las dos clases: cambian las filas y el destino del clic.
    expect(pagina).toContain('function GraficoPonderacion(')
    expect(pagina).toContain('dataKey="unidad"')
    expect(pagina).toContain('titulo="Ponderación por sucursal y módulo"')
    expect(pagina).toContain('titulo="Ponderación por departamento y módulo"')
    expect(pagina).toContain('nombrePromedio="Promedio por sucursal"')
    expect(pagina).toContain('nombrePromedio="Promedio por departamento"')
    expect(pagina).toContain('onClic={abrirDrillSucursal}')
    expect(pagina).toContain('onClic={abrirDrillDepartamento}')
    // Las filas del segundo gráfico salen de la matriz por departamento.
    expect(pagina).toContain('puntajePorUnidadModulo(datos, departamentosVisibles)')
    expect(pagina).toContain('filas={matrizDepartamentos?.unidades ?? []}')
  })

  it('el clic abre el drilldown de esa unidad y el filtro por sucursal no lo muestra', () => {
    const pagina = fuente('./DashboardHome.tsx')
    expect(pagina).toContain('alcance: { departamento_id: id }')
    expect(pagina).toContain('alcance: { sucursal_id: id }')
    // Con una sucursal elegida el gráfico de departamentos quedaría vacío.
    expect(pagina).toContain('{!sucursalSel && departamentosVisibles.length ? (')
    // GERENTE_S no ve departamentos, igual que en Historial.
    expect(pagina).toContain('const departamentosVisibles = useMemo(() => (scope ? [] : departamentos), [scope, departamentos])')
  })

  it('el drilldown de indicadores acepta el alcance de departamento', () => {
    const datos = fuente('../../lib/data/indicadores.ts')
    expect(datos).toMatch(/export type AlcanceDrilldown = \{[^}]*departamento_id\?: string/)
    expect(datos).toContain('if (f.departamento_id && ev.departamento_id !== f.departamento_id) continue')
    // La matriz por sucursal sigue existiendo con su campo histórico.
    expect(datos).toContain('export function puntajePorSucursalModulo(')
    expect(datos).toContain('export function puntajePorUnidadModulo(')
  })
})
