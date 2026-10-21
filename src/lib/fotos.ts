const MAX_DIM = 1280
const JPEG_QUALITY = 0.72

/** El plano se amplía con zoom para leer el detalle: se guarda con más resolución que una foto de evidencia. */
const MAX_DIM_PLANO = 2400
const JPEG_QUALITY_PLANO = 0.85

export async function comprimirFoto(file: File): Promise<{ blob: Blob; mime: string }> {
  return comprimir(file, MAX_DIM, JPEG_QUALITY)
}

/**
 * Versión para las imágenes de los ítems PLANO_XY (layout de la sucursal). Van a
 * quedar en pantallaampliadas con zoom, así que se guardan con más resolución y
 * calidad que una foto de evidencia corriente.
 */
export async function comprimirPlano(file: File): Promise<{ blob: Blob; mime: string }> {
  return comprimir(file, MAX_DIM_PLANO, JPEG_QUALITY_PLANO)
}

async function comprimir(file: File, maxDim: number, quality: number): Promise<{ blob: Blob; mime: string }> {
  const img = await cargarImagen(file)
  if (!img) {
    return { blob: file, mime: file.type || 'image/jpeg' }
  }
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: file, mime: file.type || 'image/jpeg' }
  ctx.drawImage(img, 0, 0, w, h)
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  )
  return { blob: blob ?? file, mime: 'image/jpeg' }
}

function cargarImagen(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** Lee el tamaño natural de una imagen (para registrarlo junto al pin y no depender del visor). */
export function medirImagen(blob: Blob): Promise<{ ancho: number; alto: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ ancho: img.naturalWidth, alto: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/* --- Trazo sobre la foto ---------------------------------------------------- */

/**
 * Marcas dibujadas a mano sobre la evidencia para **resaltar un daño o un
 * detalle** (la rayadura, el golpe, el número de serie ilegible).
 *
 * El trazo se guarda en coordenadas de la **imagen final** (no de la pantalla),
 * así que sobrevive a cualquier zoom y al reescalado. Al guardar se **quema**
 * sobre el blob: la foto queda marcada para siempre, y por lo tanto el PDF y la
 * nube reciben la marca sin que nadie tenga que regenerar nada.
 */
export interface Trazo {
  color: string
  /** Ancho en píxeles de la imagen final (ya traducido desde la pantalla). */
  grosor: number
  puntos: { x: number; y: number }[]
}

/** Paleta pensada para daño: rojo para lo crítico, amarillo para el detalle y blanco sobre fondo oscuro. */
export const COLORES_TRAZO = [
  { id: 'rojo', hex: '#ef4444', nombre: 'Rojo' },
  { id: 'amarillo', hex: '#facc15', nombre: 'Amarillo' },
  { id: 'blanco', hex: '#ffffff', nombre: 'Blanco' }
] as const

/** Grosor de la línea en pantalla (constante, no depende del zoom del dispositivo). */
export const GROSOR_PANTALLA = 5

/**
 * Punto del dedo → píxel de la imagen.
 *
 * El canvas del editor cubre exactamente la imagen renderizada, así que sólo hay
 * que pasar de la caja visible a la natural: sin offsets de letterbox ni
 * suposiciones de proporción.
 */
export function puntoAImagen(
  punto: { x: number; y: number },
  caja: { left: number; top: number; ancho: number; alto: number },
  imagen: { ancho: number; alto: number }
): { x: number; y: number } {
  const escalaX = imagen.ancho / (caja.ancho || 1)
  const escalaY = imagen.alto / (caja.alto || 1)
  return {
    x: Math.max(0, Math.min(imagen.ancho, (punto.x - caja.left) * escalaX)),
    y: Math.max(0, Math.min(imagen.alto, (punto.y - caja.top) * escalaY))
  }
}

/** El trazo se dibuja con el mismo grosor en pantalla pase lo que pase el zoom. */
export function grosorEnImagen(
  caja: { ancho: number; alto: number },
  imagen: { ancho: number; alto: number }
): number {
  const escala = imagen.ancho / (caja.ancho || 1)
  return Math.max(1, GROSOR_PANTALLA * escala)
}

/**
 * Pinta los trazos sobre un contexto (el del canvas de la foto final).
 *
 * Un trazo de un solo punto se pega como punto: si no, un toque seco no dejaría
 * ninguna marca y el usuario creería que no sirvió.
 */
export function pintarTrazos(ctx: CanvasRenderingContext2D, trazos: Trazo[]): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const t of trazos) {
    if (!t.puntos.length) continue
    ctx.strokeStyle = t.color
    ctx.fillStyle = t.color
    ctx.lineWidth = t.grosor
    const [primero, ...resto] = t.puntos
    if (!resto.length) {
      ctx.beginPath()
      ctx.arc(primero.x, primero.y, t.grosor / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(primero.x, primero.y)
    for (const p of resto) ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
}

/**
 * Compone la foto con sus trazos y devuelve la imagen marcada, lista para
 * guardarse **en el mismo id**: el PDF, la nube y cualquier referencia posterior
 * ven la marca sin cambiar nada más.
 */
export async function quemarTrazos(
  original: Blob,
  trazos: Trazo[]
): Promise<{ blob: Blob; mime: string }> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const url = URL.createObjectURL(original)
    const el = new Image()
    el.onload = () => {
      URL.revokeObjectURL(url)
      resolve(el)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    el.src = url
  })
  if (!img) return { blob: original, mime: original.type || 'image/jpeg' }

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: original, mime: original.type || 'image/jpeg' }
  ctx.drawImage(img, 0, 0)
  pintarTrazos(ctx, trazos)
  const marcada: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  )
  return { blob: marcada ?? original, mime: 'image/jpeg' }
}
