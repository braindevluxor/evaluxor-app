import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { InfoTooltip } from './ui'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El "?" que explica un bloque.
 *
 * Acá lo importante no es que el texto esté (eso se ve), sino que NO se corte.
 * Este componente nació para la columna izquierda del detalle, y esa columna
 * lleva `overflow-hidden`: un panel `absolute` dentro se cortaría contra el borde
 * de la columna a media frase. Y como el texto que explica es largo, "a media
 * frase" es justo el caso normal.
 */
describe('tooltip de información', () => {
  it('cerrado solo muestra el botón, sin el texto de explicación', () => {
    const html = renderToStaticMarkup(<InfoTooltip texto="Cada ítem reparte su valor…" />)
    // El texto dentro del atributo de un botón no aparecería en el HTML, pero sí
    // dentro del cuerpo: que no esté es lo que prueba que el panel está cerrado.
    expect(html).not.toContain('Cada ítem')
    expect(html).toContain('aria-label="Más información"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('se pinta en document.body, no dentro del contenedor que lo recorta', () => {
    const src = fuente('./ui.tsx')
    // `createPortal` es lo que lo saca del `overflow-hidden` de la columna.
    expect(src).toMatch(/createPortal\([\s\S]*role="tooltip"/)
    // Y el panel se posiciona en píxeles medidos contra la ventana: por eso
    // necesita `fixed`, no `absolute`.
    expect(src).toContain('className="fixed z-[110]')
    expect(src).not.toMatch(/className="[^"]*\babsolute\b[^"]*z-\[110\]/)
  })

  it('mide el botón antes de pintarlo, y no en el 0,0', () => {
    const src = fuente('./ui.tsx')
    // Con `useEffect` el panel se ve un instante en la esquina antes de saltar a
    // su sitio; `useLayoutEffect` mide antes del paint.
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*getBoundingClientRect/)
    expect(src).toContain("visibility: caja ? 'visible' : 'hidden'")
  })

  /* En el teléfono no hay cursor, así que este texto —el que explica cómo se
     calcula el puntaje— tiene que ser alcanzable con un dedo. */
  it('abre con clic, no solo al pasar el cursor', () => {
    const src = fuente('./ui.tsx')
    expect(src).toContain('onClick={() => setAbierto((a) => !a)}')
    expect(src).not.toContain('onMouseEnter')
  })

  /* El panel se mide en píxeles contra la ventana: si la página scrollea y el
     tooltip sigue abierto, queda flotando en el aire sobre un botón que ya se
     movió. */
  it('se cierra al scrollear la página o cualquier contenedor interno', () => {
    const src = fuente('./ui.tsx')
    // `capture: true`, sin eso el scroll de un contenedor hijo no lo dispara.
    expect(src).toContain("window.addEventListener('scroll', mover, true)")
  })
})