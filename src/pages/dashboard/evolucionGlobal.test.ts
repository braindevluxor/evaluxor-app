import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El gráfico "Evolución del cumplimiento global" se quitó del panel principal:
 * con el rango corto que se usa a diario mostraba dos o tres puntos y competía
 * con los gráficos que sí responden a la pregunta del día (¿quién va mal?).
 *
 * Lo que queda en pie es la evolución de Comparativas, que es donde se mira a
 * lo largo del tiempo a propósito.
 */
describe('dashboard · fuera la evolución del cumplimiento global', () => {
  it('el gráfico ya no existe en el panel principal', () => {
    const pagina = fuente('./DashboardHome.tsx')
    expect(pagina).not.toContain('Evolución del cumplimiento global')
    expect(pagina).not.toContain('Cumplimiento promedio')
    expect(pagina).not.toContain('gradEvolucion')
    // Con el gráfico se fue su drilldown por mes: no quedan sueltos.
    expect(pagina).not.toContain('abrirDrillMes')
    expect(pagina).not.toContain('alcance: { mes: key }')
  })

  it('tampoco quedan imports muertos tras quitarlo', () => {
    const pagina = fuente('./DashboardHome.tsx')
    // El área y su gráfico sólo se usaban ahí; el resto de recharts alimenta a
    // GraficoPonderacion y sigue haciendo falta.
    expect(pagina).not.toContain('AreaChart')
    expect(pagina).not.toMatch(/<Area[\s>]/)
    expect(pagina).not.toContain('evolucionMensual')
    // Y lo que sí se usa sigue importado.
    expect(pagina).toContain('ComposedChart')
    expect(pagina).toContain('ResponsiveContainer')
  })

  it('la evolución sigue viva en Comparativas, que es donde corresponde mirarla', () => {
    const comparativas = fuente('./Comparativas.tsx')
    expect(comparativas).toContain('evolucionMensual')
    // Y la función no se tocó: sólo cambió quién la llama.
    const indicadores = fuente('../../lib/data/indicadores.ts')
    expect(indicadores).toContain('export function evolucionMensual(')
  })
})
