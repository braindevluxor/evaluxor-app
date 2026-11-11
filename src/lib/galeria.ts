/**
 * Respaldo de evidencia fuera de la app.
 *
 * El objetivo es que si el teléfono pierde los datos de la aplicación (o la app
 * se desinstala), la foto siga existiendo en el equipo. Eso es lo que pide
 * "resguardar el material".
 *
 * La PWA no puede escribir en la galería por su cuenta: no existe esa API en el
 * navegador. Lo que sí existe es llegar hasta ahí pasando por el sistema:
 *
 *  - **iPhone** → `navigator.share` con archivos abre la hoja nativa, que trae
 *    "Guardar imagen" y de ahí a Fotos. Es la única vía y exige que el usuario
 *    toque algo, así que sólo se intenta si el equipo es Apple.
 *  - **El resto** → la copia cae en la carpeta *Descargas*, que las galerías del
 *    teléfono (Samsung, Xiaomi, Motorola…) muestran como carpeta de imágenes.
 *
 * La copia se hace con el archivo **original** de la cámara, sin comprimir: si
 * algún día hay que rescatar material, que esté con toda la calidad. La versión
 * comprimida de 1280 px vive en la app, no sirve para rescate.
 *
 * El respaldo corre sólo en **teléfonos y tabletas**. En una PC de escritorio
 * la copia caería en la carpeta *Descargas* del equipo en cada foto tomada, y
 * eso el usuario lo reportó como ruido, no como respaldo: en la PC la foto ya
 * vive en la app y en el bucket, no hace falta duplicarla en disco.
 */

/**
 * ¿Este equipo hace el respaldo solo (teléfono/tablet), o es una PC donde la
 * copia en *Descargas* sólo estorba?
 *
 * Se decide por el agente: `Mobi`/`Android`/`iPad` son táctiles; `Windows NT`,
 * `Macintosh` y `Linux` a secas son escritorio. Lo desconocido se conserva con
 * respaldo para no quitarle la garantía a ningún teléfono raro.
 */
export function respaldoAutomatico(ua?: string): boolean {
  const texto = ua ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  if (esIOS(texto)) return true
  if (/\b(Android|Windows Phone|Mobi|Tablet|iPad|iPod|iPhone)\b/i.test(texto)) return true
  if (/(Windows NT|Win64|Macintosh|Linux|X11|CrOS)/.test(texto)) return false
  return true
}

/**
 * ¿Dónde acaba la copia en este equipo? Se usa en el texto de la pantalla.
 * `'ninguno'` = PC de escritorio: no se respalda y no se promete ningún destino.
 */
export function destinoRespaldo(ua?: string): 'fotos' | 'descargas' | 'ninguno' {
  if (!respaldoAutomatico(ua)) return 'ninguno'
  return esIOS(ua) ? 'fotos' : 'descargas'
}

/**
 * Guarda una copia de los archivos originales fuera de la app.
 *
 * Se pasa la lista completa para que iPhone comparta todo de una sola vez en vez
 * de abrir una hoja por foto.
 *
 * @returns qué pasó, por si se quiere registrar en el log o avisar en pantalla.
 */
export async function guardarEnGaleria(files: File[]): Promise<'compartido' | 'descargado' | 'ninguno'> {
  if (!files.length || typeof navigator === 'undefined') return 'ninguno'
  // Guardia doble: aunque algún llamador se olvide de preguntar, en una PC de
  // escritorio no se descarga nada (el usuario lo reportó como ruido).
  if (!respaldoAutomatico()) return 'ninguno'

  if (esIOS() && puedeCompartir(files)) {
    try {
      await navigator.share({ files })
      return 'compartido'
    } catch (e) {
      // El usuario cerró la hoja: fue una decisión, no un fallo. No se
      // descarga encima para no quitarle la elección.
      if (esErrorDe(e, 'AbortError')) return 'ninguno'
      // Sin gesto del usuario u otro motivo: caemos a la descarga para que
      // siempre quede la copia.
    }
  }

  let ok = true
  for (const file of files) {
    if (!descargar(file)) ok = false
  }
  return ok ? 'descargado' : 'ninguno'
}

/** ¿El equipo de Apple donde "Guardar imagen" lleva a la galería? */
function esIOS(ua?: string): boolean {
  const texto = ua ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  if (/iP(hone|ad|od)/.test(texto)) return true
  // iPadOS 13+ se hace pasar por Mac: no se distingue por el agente, sólo por
  // que un "Mac" con pantalla táctil grande es un iPad.
  return (
    typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  )
}

function puedeCompartir(files: File[]): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files })
  } catch {
    return false
  }
}

/**
 * Deja el archivo en Descargas.
 *
 * El nombre lleva fecha, hora y milisegundos: dos fotos seguidas no chocan y el
 * navegador no pregunta "¿descargar de nuevo?", que es justo lo que rompe una
 * tanda de fotos de campo.
 */
function descargar(file: File): boolean {
  try {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = nombreDeRespaldo(file)
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // No se revoca en el acto: el navegador todavía necesita el blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return true
  } catch {
    return false
  }
}

function nombreDeRespaldo(file: File): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const marca = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(
    d.getSeconds()
  )}${p(d.getMilliseconds())}`
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '.jpg').toLowerCase()
  return `EvaLuxor-${marca}${ext}`
}

function esErrorDe(e: unknown, nombre: string): boolean {
  return typeof e === 'object' && e !== null && 'name' in e && (e as { name?: string }).name === nombre
}
