import { convertirImagenAWebP, convertirParaCarrusel } from '../convertirMedia'
import { supabase } from '../supabase'

/**
 * EL CONTENIDO DE LA LANDING PÚBLICA /gran-cosecha.html
 * -----------------------------------------------------
 * La página de la Gran Cosecha es HTML estático: se sirve desde `dist/` y
 * queda FUERA del router de React, así que no puede usar esta sesión ni el
 * cliente de la app para mostrar algo. Lo que cambia en ella —el hero con su
 * carrusel y los premios— vive en UNA fila
 * (`public.gran_cosecha_pagina`) y la página lo lee sola, por su cuenta, con
 * `ver_contenido_gran_cosecha` (la única función además de las de los
 * enlaces y el login que está abierta a `anon`). Lo que se ve de los
 * PARTICIPANTES viene de otra parte: de `gran_cosecha_proyecto`, con su
 * conteo de riegos.
 *
 * Todo lo visual se SUBE CONVERTIDO: las imágenes en WebP y los videos en
 * WebM, en el navegador, antes de llegar al bucket (ver `../convertirMedia`)
 * — la landing pide esos formatos y el que sube trae el archivo como lo tenga.
 *
 * Acá se lee y se escribe con la sesión de la consola:
 *
 *  - Leer: la tabla, con la política `for select to authenticated`.
 *  - Escribir: la misma tabla, con la política `for all ... es_lider()` —
 *    la misma cerradura que el guard de la ruta y el item del menú.
 *  - Fotos: bucket `gran-cosecha`, PÚBLICO (es el primer bucket público del
 *    repo; `evidencias` sigue privado), porque la página las ve sin sesión.
 *    Sube sólo el Líder, con las políticas del propio bucket.
 *
 * Si la fila todavía no existe —nadie guardó nunca— se devuelven los
 * VALORES POR DEFECTO, que son exactamente los que trae el HTML: la consola
 * siempre muestra algo y la landing funciona aunque Supabase esté caído.
 */

/**
 * Un item del carrusel del hero, ya convertido al formato de la página:
 * las imágenes suben como WebP y los videos como WebM (ver `convertirMedia`),
 * así que `tipo` es lo que decide cómo la landing lo pinta.
 */
export interface ItemCarrusel {
  tipo: 'imagen' | 'video'
  /** URL pública en el bucket. */
  url: string
}

/** El bloque del hero: lema, bajada, fechas, fondo y carrusel. */
export interface HeroPagina {
  lema: string
  bajada: string
  /** Día de inicio, tal como se pinta: "23". */
  fechaDesde: string
  /** Mes de inicio en tres letras: "AGT". */
  fechaDesdeMes: string
  fechaHasta: string
  fechaHastaMes: string
  /**
   * Foto de fondo, que es lo que queda cuando NO hay carrusel: la landing la
   * pinta con un velo navy encima, igual que antes.
   */
  fondo: string
  /**
   * Medios que rotan detrás del hero (vacío = se muestra `fondo`).
   * Vive dentro del jsonb `hero`, así que no pide ningún cambio de esquema.
   */
  carrusel: ItemCarrusel[]
}

/** Un premio de la sección «PREMIOS»: "1° PUESTO" y qué se gana. */
export interface PremioPagina {
  puesto: string
  descripcion: string
}

export interface ContenidoPagina {
  hero: HeroPagina
  premios: PremioPagina[]
}

/**
 * Lo que muestra la página si la base está vacía.
 *
 * Es el espejo de los valores hardcodeados en `public/gran-cosecha.html`:
 * si cambia uno, cambian los dos —la landing los pinta aunque no haya red—.
 */
export const CONTENIDO_BASE: ContenidoPagina = {
  hero: {
    lema: 'COMPETENCIA INTERNA DE EXCELENCIA Y SERVICIO',
    bajada: 'IMPULSANDO EL TALENTO DE NUESTRAS SUCURSALES LUXOR',
    fechaDesde: '23',
    fechaDesdeMes: 'AGT',
    fechaHasta: '27',
    fechaHastaMes: 'SEPT',
    fondo: '',
    carrusel: []
  },
  premios: [
    { puesto: '1° PUESTO', descripcion: 'Gran Premio Corporativo y Trofeo Luxor' },
    { puesto: '2° PUESTO', descripcion: 'Incentivo Especial para Todo el Equipo' },
    { puesto: '3° PUESTO', descripcion: 'Reconocimiento Destacado y Cesta Luxor' }
  ]
}

/**
 * El contenido de la página, o los valores por defecto si todavía no hay.
 *
 * El `hero` se mergea con el suyo: una fila guardada en una versión anterior
 * de la consola no puede quedarse sin un campo nuevo que la página necesita
 * pintar.
 */
export async function cargarContenidoPagina(): Promise<ContenidoPagina> {
  const { data, error } = await supabase
    .from('gran_cosecha_pagina')
    .select('hero, premios')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  if (!data) return CONTENIDO_BASE
  const hero = { ...CONTENIDO_BASE.hero, ...(data.hero as Partial<HeroPagina> | null) }
  // Una fila guardada antes del carrusel no lo trae, y una con un JSON raro
  // no puede romper la consola: se normaliza a lista, igual que `premios`.
  if (!Array.isArray(hero.carrusel)) hero.carrusel = []
  return {
    hero,
    premios: Array.isArray(data.premios) ? (data.premios as PremioPagina[]) : []
  }
}

/** Guarda el contenido entero (la fila nace con el primer guardado). */
export async function guardarContenidoPagina(contenido: ContenidoPagina): Promise<void> {
  const { error } = await supabase.from('gran_cosecha_pagina').upsert(
    { id: true, ...contenido, actualizado_en: new Date().toISOString() },
    { onConflict: 'id' }
  )
  if (error) throw error
}

/**
 * El problema del contenido, o `null` si está listo para publicar.
 *
 * Es la capa que EXPLICA en pantalla lo que el `check` de la base rechazaría
 * a lo bruto (42514): el formulario puede decir «el premio 2 necesita su
 * puesto» en vez de fallar con un código de Postgres.
 */
export function validarContenido(contenido: ContenidoPagina): string | null {
  if (!contenido.hero.lema.trim()) return 'El lema del hero no puede quedar vacío.'
  if (!contenido.hero.bajada.trim()) return 'La bajada del hero no puede quedar vacía.'
  if (!contenido.hero.fechaDesde.trim() || !contenido.hero.fechaDesdeMes.trim()) {
    return 'Falta la fecha de inicio del hero.'
  }
  if (!contenido.hero.fechaHasta.trim() || !contenido.hero.fechaHastaMes.trim()) {
    return 'Falta la fecha de cierre del hero.'
  }
  for (const [i, item] of contenido.hero.carrusel.entries()) {
    if (!item || (item.tipo !== 'imagen' && item.tipo !== 'video') || !item.url.trim()) {
      return `El elemento ${i + 1} del carrusel no tiene un archivo subido.`
    }
  }
  if (!contenido.premios.length) return 'La página necesita al menos un premio.'
  for (const [i, premio] of contenido.premios.entries()) {
    if (!premio.puesto.trim() || !premio.descripcion.trim()) {
      return `El premio ${i + 1} necesita su puesto y su descripción.`
    }
  }
  return null
}

/**
 * La única foto con slot fijo que queda: el fondo del hero. Los rounds se
 * retiraron de la página, y con ellos `round1..3`.
 */
export type FotoPagina = 'fondo'

export const BUCKET = 'gran-cosecha'
/** Extensión del archivo ya convertido, según el tipo que salió de la conversión. */
const EXT_POR_TIPO = { imagen: 'webp', video: 'webm' } as const

/** La ruta dentro del bucket de una URL pública nuestra ('' si no es nuestra). */
function rutaDeUrlPublica(url: string): string {
  const marca = `/object/public/${BUCKET}/`
  const i = url.indexOf(marca)
  if (i < 0) return ''
  return url.slice(i + marca.length).split('?')[0]
}

/**
 * Sube una foto de la página y devuelve su URL pública.
 *
 * La imagen se CONVIERTE a WebP antes de subirla, a su resolución natural
 * (ver `convertirMedia`): la landing pide WebP y que se vea nítida, y el que
 * elige el archivo no tiene que saberlo. Cualquier formato que el navegador
 * lea sirve de entrada — JPG, PNG, WEBP, GIF—.
 *
 * El nombre del archivo sale del SLOT y no del archivo elegido: subir dos
 * veces la misma foto reemplaza la anterior en vez de acumular copias en el
 * bucket. La URL lleva `?v=` con la hora porque el navegador y el CDN de
 * Supabase ya tienen la anterior cacheada — con el mismo path, la página
 * seguiría mostrando la foto vieja.
 */
export async function subirFotoPagina(slot: FotoPagina, archivo: File, urlActual: string): Promise<string> {
  const webp = await convertirImagenAWebP(archivo)
  const ruta = `pagina/${slot}.webp`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, webp, {
    contentType: 'image/webp',
    upsert: true
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  const url = `${data.publicUrl}?v=${Date.now()}`
  // Los slots viejos guardaban jpg/png: al migrar a webp el archivo anterior
  // queda huérfano en el bucket. Se borra sólo si es otro distinto del recién
  // subido, y un fallo acá no deshace la subida.
  const anterior = rutaDeUrlPublica(urlActual)
  if (anterior && anterior !== ruta) {
    await supabase.storage.from(BUCKET).remove([anterior]).catch(() => null)
  }
  return url
}

/**
 * Sube un item del carrusel YA CONVERTIDO (WebP o WebM) y devuelve el item
 * listo para guardar en el hero.
 *
 * La ruta lleva un uuid y no un slot porque el carrusel no tiene cupos
 * fijos: cada subida es un archivo nuevo —no hay nada que reemplazar—, así
 * que la URL ya sale distinta y no hace falta el `?v=` que rompe la caché
 * en los slots fijos.
 */
export async function subirMediaCarrusel(
  archivo: File,
  alAvanzar?: (fraccion: number) => void
): Promise<ItemCarrusel> {
  const { blob, tipo } = await convertirParaCarrusel(archivo, alAvanzar)
  const ruta = `pagina/carrusel/${crypto.randomUUID()}.${EXT_POR_TIPO[tipo]}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: blob.type })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  return { tipo, url: data.publicUrl }
}
