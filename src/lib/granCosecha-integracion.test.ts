import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Gran Cosecha: el cableado del módulo.
 *
 * Las reglas de negocio y el RLS tienen sus propios tests
 * (`granCosecha-sql.test.ts`); éste mira lo que ningún test de comportamiento
 * ve: que el módulo siga en el MENÚ de la consola, que la RUTA siga
 * adentro del layout (con barra y menú) y que el rol JUEZ siga existiendo
 * como número de teléfono de la RLS —si alguien saca la entrada del menú o
 * cambia los roles, falla acá y no en producción.
 */
describe('gran cosecha · el módulo está en el menú', () => {
  const menu = fuente('../components/layouts/ConsoleLayout.tsx')
  const app = fuente('../App.tsx')

  it('la consola ofrece «Proyectos» a todos los que entran', () => {
    // Va en su propia sección y no dentro de «Resultados»: es un concurso al
    // que entra toda la empresa, no una pantalla de indicadores.
    expect(menu).toContain("to: '/gran-cosecha'")
    expect(menu).toContain("{ seccion: 'Gran Cosecha'")
    expect(menu).toContain('label: \'Proyectos\'')

    // Y con su título en la cabecera, igual que el resto de las vistas.
    expect(menu).toContain("'/gran-cosecha'")
    expect(menu).toContain('Gran Cosecha')
    expect(menu).toContain('Concurso trimestral de proyectos')
  })

  it('al JUEZ sólo se le ofrece Gran Cosecha: las demás vistas lo rebotarían', () => {
    // Las rutas de Resultados piden `RequireRol` con roles que no incluyen a
    // JUEZ, así que un enlace ahí lo mandaría de vuelta a su propia casa.
    expect(menu).toContain("rol === 'JUEZ'")
    expect(menu).toContain('Gran Cosecha')
    // La función que arma el menú por rol tiene que seguir existiendo.
    expect(menu).toMatch(/function seccionesDe\(/)
  })

  it('la ruta está adentro del grupo de la consola y sin RequireRol', () => {
    // Sin `RequireRol`: la crean los trabajadores y la siguen los jueces. El
    // grupo ya trae `RequireAuth`, que es quien manda al SIN_ROL a /pendiente.
    expect(app).toContain('<Route path="/gran-cosecha" element={<GranCosechaPage />} />')

    const grupo = app.indexOf('<ConsoleLayout />')
    const ruta = app.indexOf('path="/gran-cosecha"')
    expect(grupo).toBeGreaterThan(-1)
    expect(ruta).toBeGreaterThan(grupo)
    // Y con lazy, como el resto de las pantallas de la consola.
    expect(app).toContain("import('./pages/GranCosecha')")
  })
})

describe('gran cosecha · el rol que lo sostiene', () => {
  const roles = fuente('../lib/roles.ts')
  const tipos = fuente('../lib/types.ts')

  it('JUEZ es un rol de la app, con etiqueta, editable y como casa el concurso', () => {
    // El `check` de `profiles` en la base lo lista igual: si el tipo se queda
    // corto, el INSERT del juez ni siquiera llega al RLS.
    expect(tipos).toContain("'JUEZ'")
    expect(roles).toContain("JUEZ: 'Juez de Gran Cosecha'")
    expect(roles).toContain("'JUEZ'")
    // Sin esto el Líder no podría asignarle el rol desde Usuarios.
    expect(roles).toMatch(/ROLES_EDITABLES[\s\S]*?'JUEZ'/)
    // Y al entrar, su casa es el concurso: `RequireAuth` lo manda al home
    // de su rol, que para un juez no puede ser el dashboard.
    expect(roles).toMatch(/case 'JUEZ':[\s\S]{0,300}?return '\/gran-cosecha'/)
  })
})
