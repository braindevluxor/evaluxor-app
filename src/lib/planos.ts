/**
 * Utilidades de los ítems PLANO_XY (Cumplimiento XY): el evaluador sube la imagen
 * del layout de la sucursal y marca puntos (pines) sobre ella.
 *
 * Los pines se guardan en coordenadas NORMALIZADAS (0..1) respecto de la imagen, no
 * en píxeles: así el mismo pin se ve en el lugar correcto con cualquier zoom, con
 * cualquier ancho de pantalla y al girar el teléfono, y sobrevive a que la imagen se
 * escale en disco (compresión).
 */

/** Rango de zoom del visor. 1 = el plano entra completo en la pantalla. */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 6

export interface Vista {
  zoom: number
  /** Desplazamiento del centro del plano respecto del centro del visor (px de pantalla). */
  x: number
  y: number
}

export const vistaInicial: Vista = { zoom: ZOOM_MIN, x: 0, y: 0 }

/** Acota `n` a ±`lim`. Devuelve +0 (no -0) para que las vistas se comparen bien. */
function clamp(n: number, lim: number): number {
  if (lim <= 0 || !Number.isFinite(n)) return 0
  return Math.min(lim, Math.max(-lim, n))
}

export function limitarZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_MIN
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

/** Tamaño con el que se dibuja la imagen dentro del visor para una vista dada. */
export function tamanoImagen(
  natural: { w: number; h: number },
  visor: { w: number; h: number },
  vista: Vista
): { w: number; h: number; ox: number; oy: number } {
  const base = natural.w > 0 && natural.h > 0 && visor.w > 0 && visor.h > 0 ? Math.min(visor.w / natural.w, visor.h / natural.h) : 1
  const w = (natural.w || 1) * base * vista.zoom
  const h = (natural.h || 1) * base * vista.zoom
  return { w, h, ox: (visor.w - w) / 2 + vista.x, oy: (visor.h - h) / 2 + vista.y }
}

/** Convierte un punto de la pantalla a coordenadas normalizadas sobre la imagen. null si cae fuera. */
export function pantallaANormalizado(
  px: number,
  py: number,
  natural: { w: number; h: number },
  visor: { w: number; h: number },
  vista: Vista
): { x: number; y: number } | null {
  if (!natural.w || !natural.h || !visor.w || !visor.h) return null
  const g = tamanoImagen(natural, visor, vista)
  const x = (px - g.ox) / g.w
  const y = (py - g.oy) / g.h
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null
  return { x, y }
}

/** Posición de un pin normalizado en píxeles de pantalla (para dibujarlo sobre la imagen). */
export function normalizadoAPantalla(
  punto: { x: number; y: number },
  natural: { w: number; h: number },
  visor: { w: number; h: number },
  vista: Vista
): { x: number; y: number } {
  const g = tamanoImagen(natural, visor, vista)
  return { x: g.ox + punto.x * g.w, y: g.oy + punto.y * g.h }
}

/**
 * Zoom centrando en un punto normalizado de la imagen: se usa al tocar un pin
 * existente, para acercar el plano a ese punto.
 */
export function vistaCentradaEnPunto(
  punto: { x: number; y: number },
  natural: { w: number; h: number },
  visor: { w: number; h: number },
  zoom: number
): Vista {
  const z = limitarZoom(zoom)
  const g = tamanoImagen(natural, visor, { zoom: z, x: 0, y: 0 })
  return {
    zoom: z,
    // La posición de un pin en pantalla es (visor - img)/2 + x·img; se iguala a visor/2.
    x: (0.5 - punto.x) * g.w,
    y: (0.5 - punto.y) * g.h
  }
}

/** Zoom manteniendo fijo el punto de la imagen que está bajo (px,py). */
export function vistaConZoomEn(
  factor: number,
  px: number,
  py: number,
  natural: { w: number; h: number },
  visor: { w: number; h: number },
  vista: Vista
): Vista {
  const zoom = limitarZoom(vista.zoom * factor)
  if (zoom === vista.zoom) return vista
  const antes = tamanoImagen(natural, visor, vista)
  if (!antes.w || !antes.h) return { ...vista, zoom }
  const u = (px - antes.ox) / antes.w
  const v = (py - antes.oy) / antes.h
  const g = tamanoImagen(natural, visor, { zoom, x: 0, y: 0 })
  // Desplazamiento que deja el punto (u,v) de la imagen bajo (px,py).
  const x = px - u * g.w - (visor.w - g.w) / 2
  const y = py - v * g.h - (visor.h - g.h) / 2
  return limitarPan({ zoom, x, y }, natural, visor)
}

/** Limita el desplazamiento: el plano nunca sale del visor (y si entra entero, queda centrado). */
export function limitarPan(
  vista: Vista,
  natural: { w: number; h: number },
  visor: { w: number; h: number }
): Vista {
  const g = tamanoImagen(natural, visor, vista)
  const limX = g.w > visor.w ? (g.w - visor.w) / 2 : 0
  const limY = g.h > visor.h ? (g.h - visor.h) / 2 : 0
  return {
    zoom: vista.zoom,
    x: clamp(vista.x, limX) + 0,
    y: clamp(vista.y, limY) + 0
  }
}

/** Normaliza un punto creado a partir de un toque: lo mantiene dentro de la imagen. */
export function normalizarPunto(x: number, y: number): { x: number; y: number } {
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}
