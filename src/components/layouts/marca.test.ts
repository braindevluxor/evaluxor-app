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

describe('marca en la barra del evaluador', () => {
  const movil = fuente('./MobileLayout.tsx')

  it('el menú va con el isotipo en blanco, no con la hamburguesa', () => {
    expect(movil).toContain('src="/isotipo.webp"')
    // En blanco por filtro y no con un archivo aparte en `public`: es el MISMO
    // isotipo que usa la consola, así que si un día se rediseña se cambia en un
    // solo lado. `brightness-0` lo vuelve todo negro y `invert` lo pasa a
    // blanco; los dos pasos hacen falta y el canal alfa se respeta, así que no
    // aparece un cuadro sólido detrás del isotipo sobre el azul.
    expect(movil).toContain('brightness-0 invert')
    // La hamburguesa se fue del todo, import incluido: si volviera, alguien
    // podría ponerla de nuevo al lado.
    expect(movil).not.toContain('Menu className')
    expect(movil).not.toMatch(/import \{[^}]*\bMenu\b[^}]*\} from 'lucide-react'/)
  })

  it('sigue siendo un botón de menú, no una imagen suelta', () => {
    // El isotipo es el ancla visual, la función no cambió: el rótulo sigue
    // siendo "Abrir menú". Y el `alt` queda vacío para no duplicar ese rótulo
    // en el lector de pantalla.
    expect(movil).toContain('aria-label="Abrir menú"')
    expect(movil).toContain('<img src="/isotipo.webp" alt="" className="h-6 w-auto brightness-0 invert" />')
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
