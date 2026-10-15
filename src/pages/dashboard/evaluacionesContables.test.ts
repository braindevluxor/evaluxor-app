import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * «Evaluaciones en el rango» contaba 7 cuando sólo había 5 evaluadas: entraban
 * una que todavía no se cerró y una de departamento, que en el dashboard de un
 * módulo no tiene fila (todo ahí es «por sucursal»). Los flags existen para que
 * cada pantalla diga qué cuenta, en vez de que todas cuenten lo mismo.
 */
describe('los dashboards sólo cuentan evaluaciones que son resultados', () => {
  const datos = fuente('../../lib/data/indicadores.ts')

  it('la consulta ofrece los dos cortes y los aplica en el WHERE', () => {
    expect(datos).toContain('soloCerradas?: boolean')
    expect(datos).toContain('soloSucursales?: boolean')
    expect(datos).toContain("query = query.eq('estado', 'CERRADA')")
    expect(datos).toContain("query = query.is('departamento_id', null)")
    // Opt-in: los listados necesitan las evaluaciones abiertas tal cual están.
    expect(datos).toMatch(/if \(f\.soloCerradas\) query = query\.eq\('estado', 'CERRADA'\)\n/)
  })

  it('el dashboard del módulo pide las dos cosas', () => {
    const pagina = fuente('./ModuloDashboard.tsx')
    expect(pagina).toContain('soloCerradas: true')
    expect(pagina).toContain('soloSucursales: true')
    // Sin sucursal elegida el filtro anterior no alcanzaba: el `in('sucursal_id')`
    // no se dispara cuando no hay lista y las de departamento pasaban solas.
    expect(pagina).toContain('sucursal_ids: sucursalSel ? [sucursalSel] : scope')
  })

  it('el de indicadores y el de comparativas descartan las abiertas', () => {
    for (const archivo of ['./DashboardHome.tsx', './Comparativas.tsx']) {
      expect(fuente(archivo)).toContain('soloCerradas: true')
    }
    // Este sí tiene gráfico propio por departamento.
    expect(fuente('./DashboardHome.tsx')).not.toContain('soloSucursales: true')
  })

  it('los listados siguen trayendo todo: ahí lo abierta es la información', () => {
    for (const archivo of ['./Historial.tsx', '../evaluar/MisEvaluaciones.tsx']) {
      expect(fuente(archivo)).not.toContain('soloCerradas')
    }
  })
})
