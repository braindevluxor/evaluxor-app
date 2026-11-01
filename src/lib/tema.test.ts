// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { alternarTema, aplicarTema, CLASE_TEMA, temaActual, temaInicial } from './tema'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/** jsDOM trae `startViewTransition` de fábrica: cada test decide si lo tiene. */
function sinTransicion(): void {
  Reflect.deleteProperty(document, 'startViewTransition')
}

/** Instala una transición que SÍ invoca el callback (como hace el navegador). */
function conTransicion(): ReturnType<typeof vi.fn> {
  const llamado = vi.fn((aplicar: () => void) => {
    aplicar()
    return {}
  })
  ;(document as unknown as { startViewTransition?: unknown }).startViewTransition = llamado
  return llamado
}

beforeEach(() => {
  document.documentElement.classList.remove(CLASE_TEMA)
  document.documentElement.removeAttribute('style')
  localStorage.clear()
  sinTransicion()
  vi.restoreAllMocks()
})

afterEach(() => {
  sinTransicion()
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('tema · estado', () => {
  it('aplicar pone la clase en <html> y temaActual la lee de ahí', () => {
    aplicarTema('oscuro')
    expect(document.documentElement.classList.contains(CLASE_TEMA)).toBe(true)
    expect(temaActual()).toBe('oscuro')

    aplicarTema('claro')
    expect(document.documentElement.classList.contains(CLASE_TEMA)).toBe(false)
    expect(temaActual()).toBe('claro')
  })

  it('la elección se guarda y vuelve al recargar; sin elección, la del sistema', () => {
    alternarTema() // claro → oscuro (por defecto la página arranca en claro)
    expect(localStorage.getItem('evaluxor:tema')).toBe('oscuro')

    document.documentElement.classList.remove(CLASE_TEMA)
    expect(temaInicial()).toBe('oscuro')

    localStorage.setItem('evaluxor:tema', 'claro')
    expect(temaInicial()).toBe('claro')
  })
})

describe('tema · el revelado radial', () => {
  it('sin startViewTransition (o con menos movimiento) el cambio es inmediato', () => {
    const resultado = alternarTema({ x: 10, y: 20 })
    expect(resultado).toBe('oscuro')
    expect(temaActual()).toBe('oscuro')
    // Nunca se tocan las variables del círculo si no hay transición.
    expect(document.documentElement.style.getPropertyValue('--tema-x')).toBe('')
  })

  it('con startViewTransition, el círculo nace en el botón y cubre la pantalla', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    const llamado = conTransicion()

    const x = 300
    const y = 700
    const resultado = alternarTema({ x, y })

    expect(llamado).toHaveBeenCalledTimes(1)
    expect(document.documentElement.style.getPropertyValue('--tema-x')).toBe(`${x}px`)
    expect(document.documentElement.style.getPropertyValue('--tema-y')).toBe(`${y}px`)
    // La variable guarda la medida con unidad: por eso se lee con parseFloat.
    // Es la hipotenusa hasta la esquina más lejana, hipot(900, 700) ≈ 1141.
    const radio = parseFloat(document.documentElement.style.getPropertyValue('--tema-r'))
    expect(radio).toBeGreaterThanOrEqual(1141)
    // El callback ya corrió dentro de la transición.
    expect(resultado).toBe('oscuro')
    expect(temaActual()).toBe('oscuro')
    expect(localStorage.getItem('evaluxor:tema')).toBe('oscuro')
  })

  it('con prefers-reduced-motion se salta el efecto aunque el navegador lo soporte', () => {
    const llamado = conTransicion()
    // jsdom no trae matchMedia: se define para que el consultor del tema
    // responda que hay menos movimiento.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (consulta: string) => ({ matches: consulta.includes('reduced-motion'), media: consulta }) as MediaQueryList
    })

    const resultado = alternarTema({ x: 5, y: 5 })

    expect(llamado).not.toHaveBeenCalled()
    expect(resultado).toBe('oscuro')
    expect(temaActual()).toBe('oscuro')
  })
})

describe('tema · dónde vive el efecto', () => {
  it('la paleta vive en index.css y el interruptor en el menú de la cuenta', () => {
    const css = fuente('../index.css')
    expect(css).toContain('.dark {')
    // El revelado: recorte de la capa nueva desde el punto del botón.
    expect(css).toContain('::view-transition-new(root)')
    expect(css).toContain('var(--tema-x, 50%)')
    // Los pasteles cambian fondo Y tinta juntos: si sólo cambia la tinta,
    // queda texto claro sobre pastel claro (ilegible).
    expect(css).toContain('--pastel-rojo-tinta:')
    expect(css).toContain('.dark .pastel-icono')
    // Y en oscuro pasan a VÍVIDOS (la paleta de referencia del dashboard):
    // bloques saturados con tinta oscura, no tintes apagados. Las series de los
    // gráficos viajan por variable, así que también se endurecen solas.
    expect(css).toContain('--pastel-rojo-fondo: #ef4444')
    expect(css).toContain('--serie-6: #a855f7')
    expect(fuente('../lib/diseno.ts')).toContain('var(--serie-1)')
    // Las superficies escritas a mano (`.sup`) y el tinte de selección de la
    // barra: sin estas dos reglas quedaban tarjeta blanca con texto claro y un
    // ítem activo invisible.
    expect(css).toContain('.dark .sup')
    expect(css).toContain('--color-yellow-50:')

    const diseno = fuente('../lib/diseno.ts')
    expect(diseno).toContain('var(--pastel-verde-fondo)')
    expect(diseno).not.toContain("fondo: '#C0EDD0'")

    const interruptor = fuente('../components/TemaInterruptor.tsx')
    expect(interruptor).toContain('Modo oscuro')
    expect(interruptor).toContain('role="switch"')
    expect(interruptor).toContain('alternarTema({ x: e.clientX, y: e.clientY })')

    // En los DOS menús: el de la cuenta de la consola y el del modo de
    // evaluación (teléfono). Una pieza, dos lugares.
    expect(fuente('../components/layouts/ConsoleLayout.tsx')).toContain('<TemaInterruptor')
    expect(fuente('../components/layouts/MobileLayout.tsx')).toContain('<TemaInterruptor')
  })

  it('la app arranca con el tema ya aplicado, antes de la primera pintura', () => {
    const principal = fuente('../main.tsx')
    expect(principal).toContain('aplicarTema(temaInicial())')
    expect(principal.indexOf('aplicarTema(temaInicial())')).toBeLessThan(principal.indexOf('createRoot('))
  })
})
