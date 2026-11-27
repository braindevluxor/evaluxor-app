import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * La asignación de tiendas del evaluador vive en el modal de usuario.
 *
 * Estuvo como pantalla aparte (`/config/asignaciones`) y se movió acá para
 * que todo lo de un usuario se gestione desde el usuario. Estos tests son la
 * red que evita que se pierda la capacidad por accidente: el flujo móvil lee
 * `asignaciones` y sin esa fila un evaluador nuevo no ve ninguna tienda.
 */
describe('usuarios · las tiendas del evaluador', () => {
  const pagina = fuente('./Usuarios.tsx')

  it('la sección existe y escribe la MISMA tabla que la pantalla vieja', () => {
    expect(pagina).toContain('Tiendas que puede evaluar')
    expect(pagina).toContain('listarAsignacionasAdmin')
    expect(pagina).toContain('asignarEvaluador')
    expect(pagina).toContain('desasignarEvaluador')
  })

  it('sólo se muestra cuando el rol seleccionado es EVALUADOR', () => {
    expect(pagina).toContain("rol === 'EVALUADOR' ?")
  })

  it('la pantalla de Asignaciones ya no existe: ni ruta, ni menú, ni archivo', () => {
    const app = fuente('../../App.tsx')
    const consola = fuente('../../components/layouts/ConsoleLayout.tsx')
    expect(app).not.toContain('AsignacionesPage')
    expect(app).not.toContain('path="/config/asignaciones"')
    // Cubre la entrada del menú (`to: '/config/asignaciones'`) y la de
    // cabecera (`'/config/asignaciones': { titulo… }`) con el mismo substring.
    expect(consola).not.toContain("'/config/asignaciones'")
    expect(existsSync(fileURLToPath(new URL('./Asignaciones.tsx', import.meta.url)))).toBe(false)
    expect(existsSync(fileURLToPath(new URL('./asignaciones.test.ts', import.meta.url)))).toBe(false)
  })
})
