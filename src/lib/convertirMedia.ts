import { esVideo } from './fotos'

/**
 * CONVERTIR LO QUE SUBE EL LÍDER AL FORMATO DE LA PÁGINA
 * -------------------------------------------------------
 * La landing /gran-cosecha.html pide archivos que carguen rápido y se vean
 * nítidos: imágenes en WebP y videos en WebM. El que sube no tiene que saber
 * nada de eso — trae el JPG del celular, la captura en PNG, el MP4 de la
 * cámara— y ESTE módulo lo convierte en el navegador, antes de subirlo al
 * bucket. La consola sólo recibe el archivo y avanza.
 *
 * Por qué en el navegador y no en un servidor: el repo se despliega como
 * build estática (FTP a cPanel o Vercel) sin backend propio para
 * transcodificar. Acá no hay claves nuevas, ni dependencias nuevas, ni un
 * ffmpeg de 30 MB: sólo APIs nativas.
 *
 *  - Imágenes: `createImageBitmap` + canvas → `toBlob('image/webp')`, a la
 *    resolución NATURAL del archivo —no se achica nada, el requisito es que
 *    se vea nítida— y con la orientación EXIF aplicada (las fotos del
 *    celular no quedan rotadas).
 *  - Videos: el navegador reproduce el archivo mientras dibuja cada cuadro
 *    en un canvas YA ACHICADO (1280 px de ancho, 30 fps) y
 *    `canvas.captureStream()` + `MediaRecorder` graba ese canvas: es la
 *    única vía nativa de transcodificar, y por eso tarda lo que dura el
 *    video (el avance se reporta por `timeupdate`). Sólo se toma el track
 *    de VIDEO: el carrusel es FONDO del hero, la página lo reproduce en
 *    mudo y sin audio el WebM pesa menos. Achicar y bajar el bitrate no es
 *    un detalle estético: el archivo que sale es lo que la landing tiene que
 *    bajar MIENTRAS reproduce, y sin eso el hero se trababa a mitad de clip.
 *
 * LÍMITE CONOCIDO: la conversión depende de que el navegador pueda DECODIFICAR
 * lo que llega. Todo lo que produce un celular o una cámara reciente pasa
 * (JPG, PNG, WEBP, GIF, MP4, MOV, WEBM); un .avi, un .mkv con códec raro o
 * un HEIC sin el códec del sistema no lo lee ningún navegador, y el error lo
 * dice claro antes de subir nada.
 */

/** Lo que puede ser un archivo del carrusel, ya decidido. */
export type MediaTipo = 'imagen' | 'video'

/** Límite de la imagen que entra: se convierte a WebP sin achicar nada. */
export const LIMITE_IMAGEN = 15 * 1024 * 1024

/** Límite del video que entra (el que sale pesa mucho menos: se reencodea a 720p y 1,5 Mbps). */
export const LIMITE_VIDEO = 200 * 1024 * 1024

/**
 * Duración máxima del video, en segundos: CINCO MINUTOS.
 *
 * La conversión reproduce el archivo de punta a punta para grabarlo —en
 * tiempo real, con APIs del navegador—, así que un video de 5 minutos
 * tarda 5 minutos en convertir: la barra de avance de la consola lleva
 * ese ritmo y el corte de seguridad se pone a la duración leída + 5 s.
 * Más largo se rechaza al elegirlo, con el motivo a la vista.
 */
export const DURACION_MAX_VIDEO = 300

/**
 * Ancho máximo y cuadros por segundo del WebM saliente.
 *
 * El video es FONDO del hero: va DETRÁS de un velo blanco, así que 1280 px
 * de ancho y 30 fps sobran —y no es sólo el peso: es lo que el navegador
 * tiene que DECODIFICAR a pantalla completa mientras rota la página.
 */
const ANCHO_MAX_VIDEO = 1280
const FPS_VIDEO = 30

/**
 * Bitrate del WebM saliente: 1,5 Mbps se ve nítido en 720p y es lo que la
 * landing alcanza a bajar MIENTRAS reproduce (60 s × 1,5 Mbps ≈ 11 MB).
 * A 5 Mbps un clip de 43 s salía de 21 MB y el hero se trababa a mitad.
 */
const BITRATE_VIDEO = 1_500_000

/**
 * Techo del video YA CONVERTIDO, en bytes.
 *
 * Con el bitrate fijo, un video de la duración máxima saldría ~56 MB:
 * pasa el límite de subida de Storage (50 MB por archivo en el plan
 * gratuito) y nadie debería bajar semejante peso para un fondo de hero.
 * Por eso el bitrate baja SOLO cuando hace falta —min(bitrate fijo,
 * techo × 8 / duración)—: hasta ~4 minutos sigue saliendo con 1,5 Mbps y
 * el de 5 minutos queda en ~1,2 Mbps, que con VP9 y el velo encima se ve
 * bien.
 */
const TAM_MAX_VIDEO = 45 * 1024 * 1024

const MENSAJE_WEBM = 'Este navegador no puede convertir videos a WebM. Probá con Chrome o Edge.'

/**
 * ¿Este MIME es algo que podamos convertir? El MIME manda, no la extensión:
 * el `input[type=file]` puede traer un `.jpg` que en realidad es un PNG.
 */
export function tipoDeArchivo(mime: string): MediaTipo | null {
  if (mime.startsWith('image/')) return 'imagen'
  if (esVideo(mime)) return 'video'
  return null
}

/** El tope de tamaño que aplica al archivo que entra. */
function validarTamanio(tipo: MediaTipo, bytes: number): void {
  const limite = tipo === 'imagen' ? LIMITE_IMAGEN : LIMITE_VIDEO
  if (bytes > limite) {
    const mb = Math.round(limite / (1024 * 1024))
    throw new Error(tipo === 'imagen' ? `La imagen no puede pasar de ${mb} MB.` : `El video no puede pasar de ${mb} MB.`)
  }
}

/**
 * ¿La duración leída pasa el tope?
 *
 * Sólo se valida la duración que el navegador pudo leer: si el contenedor no
 * la expone (`Infinity` en archivos fragmentados) no se rechaza — el corte lo
 * pone el tiempo máximo de grabación en `convertirVideoAWebM`.
 */
export function validarDuracionVideo(segundos: number): void {
  if (Number.isFinite(segundos) && segundos > DURACION_MAX_VIDEO) {
    throw new Error(
      `El video dura más de ${DURACION_MAX_VIDEO} segundos: el carrusel es de fondo, subí un clip más corto.`
    )
  }
}

/**
 * El tipo MIME con el que graba `MediaRecorder`.
 *
 * VP9 si el navegador sabe grabarlo, si no VP8, si no WebM a secas: los tres
 * son WebM y los tres los reproduce la landing. Si no soporta ninguno —Safari
 * sólo sabe grabar MP4— se avisa acá, no a media conversión. Se inyecta el
 * detector para poder probarlo sin navegador.
 */
export function elegirTipoWebm(soporta: (mime: string) => boolean): string {
  for (const candidato of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (soporta(candidato)) return candidato
  }
  throw new Error(MENSAJE_WEBM)
}

/**
 * Imagen → WebP, a su resolución natural.
 *
 * GIF animado queda en su primer cuadro (el carrusel es estático por slide);
 * un archivo que el navegador no sabe decodificar se rechaza con el motivo.
 */
export async function convertirImagenAWebP(archivo: File): Promise<Blob> {
  if (tipoDeArchivo(archivo.type) !== 'imagen') {
    throw new Error('El archivo tiene que ser una imagen.')
  }
  validarTamanio('imagen', archivo.size)
  let bitmap: ImageBitmap
  try {
    // `from-image` aplica la orientación EXIF: sin eso, las fotos del
    // celular suben rotadas 90°.
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('El navegador no pudo leer esta imagen: probá con JPG, PNG o WEBP.')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo preparar la conversión de la imagen.')
    ctx.drawImage(bitmap, 0, 0)
    const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92))
    // Ojo con el spec de `toBlob`: si el navegador no sabe escribir WebP,
    // devuelve un PNG en vez de fallar — subir eso como `.webp` sería peor
    // que el error.
    if (!webp || webp.type !== 'image/webp') {
      throw new Error('Este navegador no pudo convertir la imagen a WebP.')
    }
    return webp
  } finally {
    bitmap.close()
  }
}

/** Lee la duración del video ya cargado, o tira un error entendible. */
function leerDuracion(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve(video.duration)
    video.onerror = () => reject(new Error('El navegador no pudo leer este video: probá con MP4 o WEBM.'))
  })
}

/**
 * Reproduce el video hasta el final y detiene la grabación.
 *
 * Con red de seguridad: si `ended` nunca llega (la duración mintió, el
 * archivo se cortó), el corte por reloj la detiene a los `corteSeg` segundos
 * para no colgar la pantalla.
 */
function grabarHastaElFinal(video: HTMLVideoElement, recorder: MediaRecorder, corteSeg: number): Promise<void> {
  return new Promise((resolve) => {
    let corte = 0
    const parar = () => {
      window.clearTimeout(corte)
      video.ontimeupdate = null
      video.onended = null
      video.pause()
      if (recorder.state !== 'inactive') recorder.stop()
      resolve()
    }
    corte = window.setTimeout(parar, corteSeg * 1000)
    video.onended = parar
  })
}

/**
 * Video → WebM, ACHICADO a `ANCHO_MAX_VIDEO` / `FPS_VIDEO` y sin audio.
 *
 * `alAvanzar` recibe la fracción ya convertida (0 a 1) para la barra de la
 * consola: como la grabación es en tiempo real, la barra avanza al ritmo del
 * propio video.
 */
export async function convertirVideoAWebM(
  archivo: File,
  alAvanzar?: (fraccion: number) => void
): Promise<Blob> {
  if (tipoDeArchivo(archivo.type) !== 'video') {
    throw new Error('El archivo tiene que ser un video.')
  }
  validarTamanio('video', archivo.size)
  if (typeof MediaRecorder === 'undefined') throw new Error(MENSAJE_WEBM)

  const url = URL.createObjectURL(archivo)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  /** Cuadro de `requestAnimationFrame` pendiente, para soltarlo al salir. */
  let cuadro = 0
  /** ¿Sigue corriendo el bucle que pinta el canvas? */
  let pintando = false
  try {
    const duracion = await leerDuracion(video)
    validarDuracionVideo(duracion)
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('El navegador no pudo leer este video: probá con MP4 o WEBM.')
    }

    // EL LIENZO ACHICADO: el `MediaRecorder` graba lo que se le da, así que
    // para achicar hay que pasar el video a mano por un canvas. Va la
    // resolución del FONDO y no la del archivo: un 4K de celular pesa y
    // decodifica de más para un video que queda tras un velo blanco.
    const ancho = Math.min(ANCHO_MAX_VIDEO, video.videoWidth - (video.videoWidth % 2))
    const alto = Math.round((video.videoHeight * ancho) / video.videoWidth)
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto - (alto % 2)
    const ctx = lienzo.getContext('2d')
    if (!ctx) throw new Error('No se pudo preparar la conversión del video.')
    // El primer cuadro va sobre fondo negro: sin esto el WebM arranca con
    // transparencias, que la landing pinta como si no hubiera video.
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, lienzo.width, lienzo.height)

    // `captureStream` está en la spec de HTMLCanvasElement; el `?.` es para
    // que un navegador sin la API falle con el mensaje claro del WebM.
    const capturada = lienzo.captureStream?.(FPS_VIDEO)
    const pista = capturada?.getVideoTracks()[0]
    if (!pista) throw new Error(MENSAJE_WEBM)
    // Sólo el track de video: el carrusel es fondo y se reproduce en mudo.
    stream = new MediaStream([pista])
    // El bitrate baja sólo si el video es largo: con el techo de tamaño,
    // el de 5 minutos queda en ~1,2 Mbps en vez de los ~56 MB que
    // saldrían con 1,5 Mbps fijos.
    const duracionParaBitrate = Number.isFinite(duracion) ? duracion : DURACION_MAX_VIDEO
    const bitrate = Math.min(BITRATE_VIDEO, Math.round((TAM_MAX_VIDEO * 8) / duracionParaBitrate))
    recorder = new MediaRecorder(stream, {
      mimeType: elegirTipoWebm((mime) => MediaRecorder.isTypeSupported(mime)),
      videoBitsPerSecond: bitrate
    })
    const trozos: BlobPart[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) trozos.push(e.data)
    }
    const grabado = new Promise<Blob>((resolve) => {
      recorder!.onstop = () => resolve(new Blob(trozos, { type: 'video/webm' }))
    })

    // El avance es contra la duración leída; si no se leyó (Infinity), contra
    // el tope, que es hasta dónde va a llegar igual. Ese mismo `timeupdate`
    // vuelve a pintar el canvas: con la pestaña OCULTA no corre
    // `requestAnimationFrame` y sin este repintado la grabación se quedaría
    // congelada en un cuadro mientras el video sigue corriendo.
    const tope = Number.isFinite(duracion) ? duracion : DURACION_MAX_VIDEO
    video.ontimeupdate = () => {
      alAvanzar?.(Math.min(1, video.currentTime / tope))
      ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height)
    }

    // DIBUJAR CADA CUADRO: el recorder mira el canvas, no el video, así que
    // hay que pasárselo a mano mientras corre. Entra ANTES de `play()` para
    // que el primer cuadro ya esté pintado cuando arranca a grabar.
    pintando = true
    const pintar = () => {
      if (!pintando) return
      ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height)
      cuadro = window.requestAnimationFrame(pintar)
    }
    pintar()

    recorder.start(200)
    try {
      await video.play()
    } catch {
      throw new Error('El navegador no pudo reproducir el video para convertirlo.')
    }
    // Con duración leída el corte va 5 s después del final (para no cortar
    // un video sano que tarde en reportar `ended`); sin duración, el tope ES
    // el corte: el clip queda truncado en 5 minutos.
    const corteSeg = Number.isFinite(duracion) ? tope + 5 : DURACION_MAX_VIDEO
    await grabarHastaElFinal(video, recorder, corteSeg)
    const webm = await grabado
    alAvanzar?.(1)
    return webm
  } finally {
    pintando = false
    if (cuadro) window.cancelAnimationFrame(cuadro)
    video.ontimeupdate = null
    video.onended = null
    video.pause()
    // Si se tiró a mitad de grabación, `stop()` la finaliza y el `onstop`
    // resuelve en una promesa que nadie espera: no es un rechazo sin atender.
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stream?.getTracks().forEach((t) => t.stop())
    URL.revokeObjectURL(url)
  }
}

/**
 * Convierte lo que el Líder elige para el carrusel y devuelve el blob listo
 * para subir, con su tipo ya decidido (imagen → WebP, video → WebM).
 */
export async function convertirParaCarrusel(
  archivo: File,
  alAvanzar?: (fraccion: number) => void
): Promise<{ blob: Blob; tipo: MediaTipo }> {
  const tipo = tipoDeArchivo(archivo.type)
  if (!tipo) {
    throw new Error('Subí una imagen (JPG, PNG, WEBP…) o un video (MP4, MOV, WEBM…).')
  }
  if (tipo === 'imagen') return { blob: await convertirImagenAWebP(archivo), tipo }
  return { blob: await convertirVideoAWebM(archivo, alAvanzar), tipo }
}
