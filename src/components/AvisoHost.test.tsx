// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AvisoHost } from './AvisoHost'
import { avisar } from '../lib/aviso'

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

  it('el formato es el de una notificación: banda de color, fondo tintado e icono en su burbuja', () => {
    const src = fuente('./AvisoHost.tsx')
    // La banda a la izquierda es lo que identifica el tipo de un vistazo.
    expect(src).toContain('border-l-4')
    expect(src).toContain('rounded-full text-white')
    // El título va en su renglón y el texto debajo, no en la misma línea.
    expect(src).toContain('font-bold text-slate-900')
    expect(src).toContain('text-sm text-slate-600')
  })

  it('cubre los cuatro tonos, cada uno con su pinta y su título', () => {
    const src = fuente('./AvisoHost.tsx')
    expect(src).toMatch(/ok: \{ titulo: 'Listo'/)
    expect(src).toMatch(/aviso: \{ titulo: 'Atención'/)
    expect(src).toMatch(/error: \{ titulo: 'No se pudo'/)
    expect(src).toMatch(/info: \{ titulo: 'Aviso'/)
    // El azul de la información es el primario de la casa, no un azul suelto.
    expect(src).toContain('bg-primary-500')

    const aviso = fuente('../lib/aviso.ts')
    expect(aviso).toContain("'ok' | 'aviso' | 'error' | 'info'")
  })

  it('la tarjeta se puede tocar para cerrarla, pero el aire de alrededor no', () => {
    const src = fuente('./AvisoHost.tsx')
    // El contenedor deja pasar el toque a la pantalla; sólo la tarjeta lo
    // absorbe, y es la que lleva el botón de cerrar.
    expect(src).toContain('pointer-events-auto')
    expect(src).toContain('aria-label="Cerrar aviso"')
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

describe('AvisoHost · el cartel de verdad (jsdom)', () => {
  let cont: HTMLElement
  let root: Root

  beforeEach(async () => {
    cont = document.createElement('div')
    document.body.appendChild(cont)
    root = createRoot(cont)
    await act(async () => root.render(<AvisoHost />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    cont.remove()
    document.body.innerHTML = ''
  })

  it('al avisar, el cartel aparece con su título y el mensaje', async () => {
    await act(async () => {
      avisar('Llamado de atención registrado para Cajero.', 'ok')
    })

    expect(document.body.textContent).toContain('Listo')
    expect(document.body.textContent).toContain('Llamado de atención registrado para Cajero.')
  })

  it('el error se pinta con su pinta de error y su título', async () => {
    await act(async () => {
      avisar('No se pudo registrar el llamado.', 'error')
    })

    expect(document.body.textContent).toContain('No se pudo')
    expect(document.body.textContent).toContain('No se pudo registrar el llamado.')
    expect(document.querySelector('[class*="border-red-500"]')).not.toBeNull()
  })
})
