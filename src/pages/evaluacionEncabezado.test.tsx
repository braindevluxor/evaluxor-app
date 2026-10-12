import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(): string {
  return readFileSync(fileURLToPath(new URL('./EvaluacionDetalle.tsx', import.meta.url)), 'utf8')
}

/** Justo el `<header>` de la pantalla, no todo el archivo. */
function encabezado(): string {
  const codigo = fuente()
  // `SkeletonEvaluacionDetalle` tiene su propio `<header>` (es un placeholder
  // con la misma forma) y vive antes en el archivo: sin este ancla, `indexOf`
  // agarraba ese y todos los tests pasaban contra un esqueleto.
  const desde = codigo.indexOf('export function EvaluacionDetalle()')
  expect(desde, 'no encontré EvaluacionDetalle').toBeGreaterThan(-1)
  const apertura = codigo.indexOf('<header', desde)
  const hasta = codigo.indexOf('</header>', apertura)
  expect(apertura, 'no encontré el <header>').toBeGreaterThan(-1)
  return codigo.slice(apertura, hasta === -1 ? undefined : hasta)
}

/** La clase del botón de cabecera, sin interpolaciones al lado. */
function claseBoton(): string {
  const m = /const BOTON_CABECERA\s*=\s*\n?\s*'([^']+)'/.exec(fuente())
  expect(m, 'no encontré BOTON_CABECERA').toBeTruthy()
  return m![1]
}

describe('EvaluacionDetalle · el encabezado', () => {
  it('todos los botones son la misma cara: puro icono, sin fondo', () => {
    const cab = encabezado()
    // Volver, sincronizar, editar productos y el PDF comparten la clase, y el
    // compartir la arma con la misma. Así la fila no se puede desarmar tocando
    // un botón por separado.
    const usos = (cab.match(/BOTON_CABECERA/g) ?? []).length
    expect(usos).toBeGreaterThanOrEqual(4)
    // Ningún fondo de reposo en el encabezado: sobre el azul un disco
    // translúcido se leía como un contorno alrededor del icono.
    expect(cab).not.toContain('bg-white/')
    // Y ninguna variante de `Button`, que arrastra `border` en `secondary` y
    // `px-4 py-2.5 min-h-[44px]` en cualquier caso.
    expect(cab).not.toContain('<Button')
  })

  it('la clase no tiene fondo, y el tinte sólo aparece al apuntar', () => {
    const clases = claseBoton()
    expect(clases).toContain('h-10 w-10')
    expect(clases).toMatch(/(^| )hover:bg-white\/10/)
    // El resto de la clase no puede traer `bg-` de reposo.
    const sinHover = clases.replace(/hover:bg-white\/10/, '')
    expect(sinHover).not.toMatch(/(^| )bg-/)
  })

  it('los iconos son más grandes que el estándar de la app', () => {
    const cab = encabezado()
    // `CLASE_ICONO` de ui.tsx es h-9 w-9 con iconos h-4 w-4. Acá no hay fondo
    // que ayude a leerlos, así que todo crece un escalón.
    expect(cab).toContain('h-5 w-5')
    expect(cab).not.toContain('h-4 w-4')
    expect(claseBoton()).toContain('h-10 w-10')
  })

  it('el PDF y "Editar productos" son icono sólo, con el rótulo en el título', () => {
    const cab = encabezado()
    // Sin texto visible: la barra es de iconos. El nombre de cada acción vive
    // en `title` y `aria-label`, que es donde se busca cuando no se reconoce.
    expect(cab).not.toMatch(/>\s*(Editar productos|Descargar PDF)\s*</)
    expect(cab).toContain('title="Editar productos"')
    expect(cab).toContain('title="Elegir qué incluye el PDF"')
    expect(cab).toContain('aria-label="Descargar PDF"')
  })
})
