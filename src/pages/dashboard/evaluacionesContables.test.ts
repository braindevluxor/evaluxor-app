import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * «Evaluaciones en el rango» contaba 7 cuando sólo había 5 evaluadas: entraban
 * una que todavía no se cerró. Los flags existen para que cada pantalla diga qué
 * cuenta, en vez de que todas cuenten lo mismo: el de módulo descarta las
 * abiertas, pero sí cuenta las de departamento (un módulo como Flota Vehicular
 * lo miden departamentos y ahí tienen fila), y el de indicadores lo decide un
 * filtro.
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

  it('el dashboard del módulo descarta las abiertas pero cuenta cualquier unidad', () => {
    const pagina = fuente('./ModuloDashboard.tsx')
    expect(pagina).toContain('soloCerradas: true')
    // `soloSucursales` se cayó a propósito (dff70c8): con él, los módulos
    // medidos por departamento (Flota Vehicular) quedaban en cero aunque la
    // tarjeta del panel principal mostrara promedio.
    expect(pagina).not.toContain('soloSucursales: true')
    // Sin sucursal elegida el alcance anterior no alcanzaba: el `in('sucursal_id')`
    // no se dispara cuando no hay lista.
    expect(pagina).toContain('sucursal_ids: sucursalSel ? [sucursalSel] : scope')
  })

  it('el de comparativas sigue descartando las abiertas; el de indicadores lo decide un filtro', () => {
    expect(fuente('./Comparativas.tsx')).toContain('soloCerradas: true')
    // El dashboard de indicadores cuenta TAMBIÉN las activas, con su puntaje
    // en curso (recalculado con las respuestas, no el cero guardado): a mitad
    // de mes todo está abierto y el corte fijo lo dejaba entero en ceros. La
    // KPI de «completadas» sigue midiendo sólo lo cerrado.
    const indicadores = fuente('./DashboardHome.tsx')
    expect(indicadores).toContain('soloCerradas: incluirActivas ? undefined : true')
    expect(indicadores).toContain("datos.evaluaciones.filter((e) => e.estado === 'CERRADA').length")
    // Este sí tiene gráfico propio por departamento.
    expect(indicadores).not.toContain('soloSucursales: true')
  })

  it('los listados siguen trayendo todo: ahí lo abierta es la información', () => {
    for (const archivo of ['./Historial.tsx', '../evaluar/MisEvaluaciones.tsx']) {
      expect(fuente(archivo)).not.toContain('soloCerradas')
    }
  })
})
