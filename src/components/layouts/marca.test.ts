import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('marca en el menú lateral', () => {
  const consola = fuente('./ConsoleLayout.tsx')

  it('desplegado va el logo completo y cerrado sólo el isotipo', () => {
    expect(consola).toContain('src="/completo.webp"')
    expect(consola).toContain('src="/isotipo.webp"')
    // Cerrado el menú mide 64px: ahí no entra el nombre y la "E" de relleno
    // ya no hace falta porque el isotipo la reemplaza.
    expect(consola).not.toContain('>E</div>')
  })

  it('el nombre de la app sigue siendo el encabezado aunque se oculte', () => {
    // Los dos logos van con alt vacío: si el <h1> desapareciera, el lector de
    // pantalla se quedaría sin nombre de aplicación en esa pantalla.
    expect(consola).toContain('<h1 className="sr-only">EvaLuxor</h1>')
  })
})

describe('favicon', () => {
  const html = fuente('../../../index.html')

  it('apunta al favicon propio, no a un icono de la PWA', () => {
    expect(html).toContain('href="/favicon.webp"')
    expect(html).toContain('type="image/webp"')
    expect(html).not.toContain('icon-192.webp')
  })
})
