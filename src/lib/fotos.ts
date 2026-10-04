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
