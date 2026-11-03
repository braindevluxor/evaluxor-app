import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Asignaciones: la única pantalla que escribe `asignaciones`, una de las
 * cuatro tablas del alcance de la bitácora.
 *
 * Estuvo un tiempo SIN RUTA: `AsignacionesPage` vivía en el repo pero no se
 * importaba en ningún lado, así que la tabla no cambiaba desde la app y el
 * filtro «Evaluador por sucursal» del historial salía siempre vacío. Éste
 * cubre los tres eslabones que tenían esa pieza suelta: la ruta, el enlace
 * del menú y la escritura que dispara el trigger.
 */
describe('asignaciones · entra desde la Consola y sólo el Líder', () => {
  it('la ruta está protegida y el menú la lista', () => {
    const app = fuente('../../App.tsx')
    const consola = fuente('../../components/layouts/ConsoleLayout.tsx')

    expect(app).toContain('path="/config/asignaciones"')
    expect(app).toContain('<SoloLider><AsignacionesPage /></SoloLider>')
    // Con lazy, como el resto de Configuración.
    expect(app).toContain("import('./pages/config/Asignaciones')")
    expect(consola).toContain("to: '/config/asignaciones'")
    expect(consola).toContain("label: 'Asignaciones'")
    // Con rótulo en la cabecera, para no llegar a una vista sin título.
    expect(consola).toContain("'/config/asignaciones': { titulo: 'Asignaciones'")
  })
})

describe('asignaciones · lo que escribe', () => {
  const pagina = fuente('./Asignaciones.tsx')
  const datos = fuente('../../lib/data/usuarios.ts')

  it('pasa por las dos funciones de la capa de datos', () => {
    expect(pagina).toContain('asignarEvaluador')
    expect(pagina).toContain('desasignarEvaluador')
    expect(datos).toContain(".from('asignaciones')")
    // El upsert contra su única es lo que dispara `trg_bitacora_asignaciones`.
    expect(datos).toContain("onConflict: 'evaluador_id,sucursal_id'")
  })

  it('si la base rechaza, avisa y no pinta la casilla igual', () => {
    // Sin el chequeo la pantalla mostraba «Asignada ✓» con la tabla intacta
    // y la bitácora sin registrar nada.
    expect(datos).toContain('if (error) throw new Error')
    expect(pagina).toContain("avisar(e instanceof Error ? e.message")
    // El estado local sólo se toca DESPUÉS del await de su propia rama: si
    // la base rechaza, la casilla no se pinta sola.
    const toggle = pagina.match(/async function toggle\s*\([^]*?\n {2}\}/m)?.[0] ?? ''
    expect(toggle, 'falta el toggle de asignación').toContain('await asignarEvaluador')
    const estados = [...toggle.matchAll(/setAsignadas/g)].map((m) => m.index ?? -1)
    expect(estados, 'falta el cambio de estado en el toggle').toHaveLength(2)
    expect(estados[0]).toBeGreaterThan(toggle.indexOf('await desasignarEvaluador'))
    expect(estados[1]).toBeGreaterThan(toggle.indexOf('await asignarEvaluador'))
  })
})
