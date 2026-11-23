import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Bonos: el cableado del módulo.
 *
 * La regla de negocio y el RLS tienen sus propios tests (`bonos.test.ts` y
 * `bonos-sql.test.ts`); éste mira lo que ningún test de comportamiento ve:
 * que el módulo siga en el MENÚ de la consola y que la RUTA siga pidiendo
 * los dos roles que lo gestionan. Si alguien saca la entrada del menú o
 * cambia los roles, falla acá y no en producción.
 */

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('bonos · el módulo está en el menú', () => {
  it('la consola ofrece «Bonos» a los dos roles que lo gestionan', () => {
    const menu = fuente('../components/layouts/ConsoleLayout.tsx')

    // Dos entradas con la misma ruta: una en el bloque «Compensación» del
    // menú del Líder (junto a Programas y Tabulador) y otra para el Gerente
    // de Talento Humano, que sólo ve ese bloque.
    expect(menu.match(/to: '\/config\/bonos'/g)).toHaveLength(2)

    // «Compensación» agrupa los TRES módulos de plata de RRHH —como
    // «Gran Cosecha» agrupa los suyos— en las DOS ramas del menú…
    const bloques = menu.match(/seccion: 'Compensación',\s*items: \[[\s\S]*?\n {6}\]/g) ?? []
    expect(bloques).toHaveLength(2)
    for (const bloque of bloques) {
      expect(bloque).toContain("'/config/bonos'")
      expect(bloque).toContain("'/config/programas-bono'")
      expect(bloque).toContain("'/config/bonos/tabulador'")
    }
    // …y «Gestión» ya no los contiene.
    const gestion = menu.match(/seccion: 'Gestión',\s*items: \[[\s\S]*?\n {6}\]/)?.[0] ?? ''
    expect(gestion).not.toContain('/config/bonos')

    // Y con su título en la cabecera, igual que el resto de las vistas.
    expect(menu).toContain("'/config/bonos'")
    expect(menu).toContain('Bonos por desempeño')

    // El Gerente de TH tiene su propia rama en el menú: sin ella no vería
    // ninguna opción de gestión (puedeConfigurar es sólo del Líder).
    expect(menu).toContain("profile.rol === 'GERENTE_TH'")
  })

  it('la ruta pide LÍDER o GERENTE TH, adentro de la consola', () => {
    const app = fuente('../App.tsx')

    expect(app).toContain('path="/config/bonos"')
    expect(app).toMatch(/roles=\{\[\s*'LIDER',\s*'GERENTE_TH'\s*\]\}/)
  })
})
