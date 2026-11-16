import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  convertirImagenAWebP,
  convertirParaCarrusel,
  DURACION_MAX_VIDEO,
  elegirTipoWebm,
  LIMITE_IMAGEN,
  tipoDeArchivo,
  validarDuracionVideo
} from './convertirMedia'

/**
 * convertirMedia, sin navegador.
 *
 * Lo que se puede probar acá es la parte que decide: qué archivos acepta,
 * los límites, la duración y qué tipo de WebM elige `MediaRecorder`. La
 * conversión en sí (canvas y grabación) corre sólo en el navegador —acá se
 * chequea por TEXTO que usa las APIs nativas y nada de ffmpeg—.
 */
const fuente = readFileSync(fileURLToPath(new URL('./convertirMedia.ts', import.meta.url)), 'utf8')

describe('convertirMedia · qué convierte', () => {
  it('reconoce imágenes y videos por su MIME, y rechaza el resto', () => {
    expect(tipoDeArchivo('image/jpeg')).toBe('imagen')
    expect(tipoDeArchivo('image/heic')).toBe('imagen')
    expect(tipoDeArchivo('video/mp4')).toBe('video')
    expect(tipoDeArchivo('video/quicktime')).toBe('video')
    expect(tipoDeArchivo('application/pdf')).toBeNull()
    expect(tipoDeArchivo('')).toBeNull()
  })

  it('la entrada que no puede ser del carrusel se explica, sin tocar el DOM', async () => {
    await expect(convertirParaCarrusel(new File(['x'], 'hoja.pdf', { type: 'application/pdf' }))).rejects.toThrow(
      /imagen.*video/
    )
    await expect(convertirImagenAWebP(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).rejects.toThrow(
      /tiene que ser una imagen/
    )
  })

  it('una imagen que pasa del límite se rechaza antes de decodificar nada', async () => {
    const gigante = new File([new ArrayBuffer(LIMITE_IMAGEN + 1)], 'giga.jpg', { type: 'image/jpeg' })
    await expect(convertirImagenAWebP(gigante)).rejects.toThrow(/15 MB/)
  })
})

describe('convertirMedia · la duración de los videos', () => {
  it('acepta hasta el tope y rechaza lo que lo pasa, con el motivo', () => {
    expect(() => validarDuracionVideo(0)).not.toThrow()
    expect(() => validarDuracionVideo(DURACION_MAX_VIDEO)).not.toThrow()
    expect(() => validarDuracionVideo(DURACION_MAX_VIDEO + 0.1)).toThrow(new RegExp(DURACION_MAX_VIDEO + ' segundos'))
    expect(() => validarDuracionVideo(600)).toThrow(/fondo/)
  })

  it('el tope es de 5 minutos y el bitrate se acomoda al techo de tamaño', () => {
    expect(fuente).toContain('export const DURACION_MAX_VIDEO = 300')
    // Con bitrate fijo, 5 minutos saldrían ~187 MB: no suben a Storage
    // (límite de 50 MB por archivo) y es un peso absurdo para un fondo.
    expect(fuente).toContain('const TAM_MAX_VIDEO = 45 * 1024 * 1024')
    expect(fuente).toContain('Math.min(BITRATE_VIDEO, Math.round((TAM_MAX_VIDEO * 8)')
  })

  it('si el navegador no pudo leer la duración, no se rechaza el archivo', () => {
    // `Infinity` es el caso de contenedores fragmentados: el corte lo pone
    // el tiempo máximo de grabación, no una validación que no se pudo hacer.
    expect(() => validarDuracionVideo(Infinity)).not.toThrow()
    expect(() => validarDuracionVideo(NaN)).not.toThrow()
  })
})

describe('convertirMedia · el WebM que graba', () => {
  it('prefiere VP9 y baja a VP8 o a WebM a secas', () => {
    expect(elegirTipoWebm((mime) => mime === 'video/webm;codecs=vp9')).toBe('video/webm;codecs=vp9')
    expect(elegirTipoWebm((mime) => mime === 'video/webm;codecs=vp8')).toBe('video/webm;codecs=vp8')
    expect(elegirTipoWebm((mime) => mime === 'video/webm')).toBe('video/webm')
  })

  it('si no sabe grabar ninguno, lo dice antes de empezar', () => {
    expect(() => elegirTipoWebm(() => false)).toThrow(/Chrome o Edge/)
  })
})

describe('convertirMedia · contra el navegador', () => {
  it('las imágenes pasan por canvas a WebP, sin achicar y con la EXIF aplicada', () => {
    expect(fuente).toContain('createImageBitmap(archivo, { imageOrientation: \'from-image\' })')
    expect(fuente).toContain("canvas.toBlob(resolve, 'image/webp', 0.92)")
    // `toBlob` devuelve PNG si el navegador no sabe escribir WebP: subir eso
    // como `.webp` sería peor que el error.
    expect(fuente).toContain("webp.type !== 'image/webp'")
    // Sin resize: el bitmap va al canvas con su tamaño natural.
    expect(fuente).toContain('canvas.width = bitmap.width')
  })

  it('los videos se graban con APIs nativas y sólo el track de video', () => {
    expect(fuente).toContain('captureStream?.()')
    expect(fuente).toContain('new MediaRecorder(stream')
    // Sin audio: el carrusel es fondo y se reproduce en mudo.
    expect(fuente).toContain('getVideoTracks()[0]')
    expect(fuente).not.toContain('getAudioTracks')
    // Nada de ffmpeg ni dependencias: el repo se despliega estático y la
    // única importación es un helper propio del repo.
    expect(fuente).not.toContain('@ffmpeg')
    expect(fuente).toContain("from './fotos'")
  })
})
