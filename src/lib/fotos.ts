const MAX_DIM = 1280
const JPEG_QUALITY = 0.72

export async function comprimirFoto(file: File): Promise<{ blob: Blob; mime: string }> {
  const img = await cargarImagen(file)
  if (!img) {
    return { blob: file, mime: file.type || 'image/jpeg' }
  }
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: file, mime: file.type || 'image/jpeg' }
  ctx.drawImage(img, 0, 0, w, h)
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
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