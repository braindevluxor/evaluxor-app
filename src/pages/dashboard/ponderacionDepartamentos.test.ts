import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El dashboard suma departamentos a sus análisis, pero ya no con un gráfico de
 * ponderación gemelo del de sucursales: el promedio por departamento es una
 * dona, con la misma pieza que la de sucursales. El gráfico de ponderación
 * se conserva sólo para sucursales.
 */
describe('dashboard · promedio por departamento', () => {
  it('el promedio por departamento se dibuja como dona, con la misma pieza que el de sucursal', () => {
    const pagina = fuente('./DashboardHome.tsx')
    // La dona es la misma pieza para sucursales y departamentos.
    expect(pagina).toContain('function GraficoDona(')
    expect(pagina).toContain('titulo="Promedio por sucursal"')
    expect(pagina).toContain('titulo="Promedio por departamento"')
    // El gráfico de ponderación sigue siendo sólo de sucursal.
    expect(pagina).toContain('function GraficoPonderacion(')
    expect(pagina).toContain('titulo="Ponderación por sucursal y módulo"')
    expect(pagina).not.toContain('titulo="Ponderación por departamento y módulo"')
  })

  it('la dona de departamentos se oculta con el filtro por sucursal', () => {
    const pagina = fuente('./DashboardHome.tsx')
    // Con una sucursal elegida la lista de departamentos quedaría vacía. La
    // condición vive en `verDepartamentos`, que además decide cuántas columnas
    // tiene la fila de listas.
    expect(pagina).toContain('const verDepartamentos = !sucursalSel && departamentosVisibles.length > 0')
    expect(pagina).toContain('{verDepartamentos ? (')
    // GERENTE_S no ve departamentos, igual que en Historial.
    expect(pagina).toContain('const departamentosVisibles = useMemo(() => (scope ? [] : departamentos), [scope, departamentos])')
  })

  it('el gráfico de ponderación ofrece un switch para alternar entre sucursales y departamentos', () => {
    const pagina = fuente('./DashboardHome.tsx')
    expect(pagina).toContain("const [tipoPonderacion, setTipoPonderacion] = useState<'sucursal' | 'departamento'>('sucursal')")
    expect(pagina).toContain("setTipoPonderacion('sucursal')")
    expect(pagina).toContain("setTipoPonderacion('departamento')")
    expect(pagina).toContain('matrizDepartamentos')
  })

  it('la capa de datos expone el promedio por unidad y el drilldown de departamento', () => {
    const datos = fuente('../../lib/data/indicadores.ts')
    // El mismo cálculo sirve para las dos clases de unidad.
    expect(datos).toContain('function promedioPorUnidad(')
    expect(datos).toContain("por: 'sucursal' | 'departamento'")
    expect(datos).toContain('export function rankingSucursales(')
    expect(datos).toContain('export function rankingDepartamentos(')
    // El drilldown de indicadores sigue aceptando el alcance de departamento.
    expect(datos).toMatch(/export type AlcanceDrilldown = \{[^}]*departamento_id\?: string/)
    expect(datos).toContain('if (f.departamento_id && ev.departamento_id !== f.departamento_id) continue')
    // La matriz por sucursal sigue existiendo con su campo histórico.
    expect(datos).toContain('export function puntajePorSucursalModulo(')
    expect(datos).toContain('export function puntajePorUnidadModulo(')
  })
})
