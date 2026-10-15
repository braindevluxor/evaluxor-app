import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AvisoHost } from './AvisoHost'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('AvisoHost · el cartel flotante de confirmaciones', () => {
  it('sin nada que avisar no pinta nada: no deja fantasmas en la página', () => {
    expect(renderToStaticMarkup(<AvisoHost />)).toBe('')
  })

  it('flota por encima de todo lo que la app deja fijo', () => {
    const src = fuente('./AvisoHost.tsx')
    // La barra de controles es z-40; los modales, 100 y 130; la pantalla
    // completa de incidencias, 100. 150 pasa por encima de todas.
    expect(src).toContain('z-[150]')
    // 96px: la barra mide 72px, así que el cartel nunca la tapa.
    expect(src).toContain('bottom-24')
    // La sombra es lo que lo hace "notificación" y no "otra caja del documento",
    // y sólo se dibuja porque el elemento es `fixed` (regla de relieve plano).
    expect(src).toContain('shadow-lg')
    expect(src).toContain("'aviso-entrar pointer-events-none fixed")
    // Tocarlo no debe comerse el toque de adentro de la pantalla.
    expect(src).toContain('pointer-events-none')
  })

  it('se pinta en el body, fuera de cualquier contenedor con overflow', () => {
    const src = fuente('./AvisoHost.tsx')
    expect(src).toMatch(/createPortal\(/)
    expect(src).toContain('document.body')
  })

  it('cada aviso remonta el cartel: por eso lleva la clave', () => {
    const src = fuente('./AvisoHost.tsx')
    expect(src).toContain('key={aviso.clave}')
    expect(src).toContain('suscribirAvisos(setAviso)')
  })

  it('es confirmación a la vista: el anuncio lo hace el botón, no el cartel', () => {
    const src = fuente('./AvisoHost.tsx')
    // Dos anuncios para el mismo toque es peor que uno. El cartel calla y el
    // botón que lo dispara es el que tiene su `aria-live`.
    expect(src).toContain('aria-hidden="true"')
    // Se busca `aria-live=` y no la palabra: el comentario de arriba la menciona.
    expect(src).not.toContain('aria-live=')
  })

  it('está montado en App y FUERA de las rutas', () => {
    const app = fuente('../App.tsx')
    const rutas = app.slice(app.indexOf('function Rutas()'), app.indexOf('export default function App()'))
    const principal = app.slice(app.indexOf('export default function App()'))

    // Si viviera dentro de Rutas, cada cambio de pantalla lo desmontaría y el
    // aviso se perdería a mitad de su tiempo en pantalla.
    expect(rutas).not.toContain('AvisoHost')
    expect(principal).toContain('<AvisoHost />')
    expect(principal).toContain('<Rutas />')
  })
})
