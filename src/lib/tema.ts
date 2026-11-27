/**
 * MODO OSCURO, con revelado radial desde el botón.
 *
 * La paleta no vive acá: vive en `index.css` (`.dark` redefine la escala de
 * Tailwind). Este archivo sólo decide QUÉ tema está puesto, cuándo se guarda y
 * CÓMO se revela al alternarlo.
 *
 * El revelado usa View Transitions del navegador: se captura la pantalla antes
 * y después de aplicar el tema, y la capa nueva entra recortada en un círculo
 * que nace en el botón. Si el navegador no lo soporta (o la persona pidió
 * menos movimiento), el cambio es inmediato — mismo resultado, sin efecto.
 */
export type Tema = 'claro' | 'oscuro'

/** La clase que pone la paleta oscura en `<html>` (la misma de Tailwind). */
export const CLASE_TEMA = 'dark'

const CLAVE = 'evaluxor:tema'

function hayMotionReducido(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** El tema guardado, o el del sistema si nunca se eligió. */
export function temaInicial(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE)
    if (guardado === 'oscuro' || guardado === 'claro') return guardado
  } catch {
    // Sin storage (modo privado): sigue el del sistema.
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'oscuro'
    : 'claro'
}

/** Pone o quita la clase en `<html>`. No guarda: guardar es decisión del que alterna. */
export function aplicarTema(tema: Tema): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle(CLASE_TEMA, tema === 'oscuro')
}

/** El tema que está puesto ahora, leyendo el DOM (la fuente de verdad visual). */
export function temaActual(): Tema {
  if (typeof document === 'undefined') return 'claro'
  return document.documentElement.classList.contains(CLASE_TEMA) ? 'oscuro' : 'claro'
}

/**
 * Alterna el tema y lo revela como un círculo que nace en `origen` (las
 * coordenadas del toque/clic, en píxeles de viewport). Sin origen, el círculo
 * sale del centro.
 *
 * Devuelve el tema resultante para que la pantalla lo pinte al toque: la
 * transición del navegador es sólo el efecto, el estado es del DOM y de acá.
 */
export function alternarTema(origen?: { x: number; y: number }): Tema {
  const siguiente: Tema = temaActual() === 'oscuro' ? 'claro' : 'oscuro'

  const aplicar = () => {
    aplicarTema(siguiente)
    try {
      localStorage.setItem(CLAVE, siguiente)
    } catch {
      // Sin storage el tema igual cambia: sólo no queda para la próxima.
    }
  }

  const doc = document as Document & { startViewTransition?: (aplicar: () => void) => unknown }
  if (!doc.startViewTransition || hayMotionReducido()) {
    aplicar()
    return siguiente
  }

  // El radio es la distancia al punto más lejano de la pantalla: así el
  // círculo termina cubriendo las cuatro esquinas, no una porción.
  const x = Math.round(origen?.x ?? window.innerWidth / 2)
  const y = Math.round(origen?.y ?? window.innerHeight / 2)
  const radio = Math.ceil(
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  )
  const raiz = document.documentElement
  raiz.style.setProperty('--tema-x', `${x}px`)
  raiz.style.setProperty('--tema-y', `${y}px`)
  raiz.style.setProperty('--tema-r', `${radio}px`)

  doc.startViewTransition(aplicar)
  return siguiente
}
