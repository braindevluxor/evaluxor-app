import { supabase } from '../supabase'

/**
 * EL CONTENIDO DE LA LANDING PÚBLICA /gran-cosecha.html
 * -----------------------------------------------------
 * La página de la Gran Cosecha es HTML estático: se sirve desde `dist/` y
 * queda FUERA del router de React, así que no puede usar esta sesión ni el
 * cliente de la app para mostrar algo. Lo que cambia en ella —el hero, los
 * premios, los equipos y las fotos— vive en UNA fila
 * (`public.gran_cosecha_pagina`) y la página lo lee sola, por su cuenta, con
 * `ver_contenido_gran_cosecha` (la única función además de las de los
 * enlaces y el login que está abierta a `anon`).
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

/** El bloque del hero: lema, bajada, fechas y fondo. */
export interface HeroPagina {
  lema: string
  bajada: string
  /** Día de inicio, tal como se pinta: "23". */
  fechaDesde: string
  /** Mes de inicio en tres letras: "AGT". */
  fechaDesdeMes: string
  fechaHasta: string
  fechaHastaMes: string
  /** URL de la foto de fondo ('' = el degradado por defecto de la página). */
  fondo: string
}

/** Un premio de la sección «PREMIOS»: "1° PUESTO" y qué se gana. */
export interface PremioPagina {
  puesto: string
  descripcion: string
}

/** Un equipo que aparece en la sección «EQUIPOS PARTICIPANTES». */
export interface EquipoPagina {
  nombre: string
  sucursal: string
}

/** Las tres fotos de los rounds de la página. */
export interface ImagenesPagina {
  round1: string
  round2: string
  round3: string
}

export interface ContenidoPagina {
  hero: HeroPagina
  premios: PremioPagina[]
  equipos: EquipoPagina[]
  imagenes: ImagenesPagina
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
    fondo: ''
  },
  premios: [
    { puesto: '1° PUESTO', descripcion: 'Gran Premio Corporativo y Trofeo Luxor' },
    { puesto: '2° PUESTO', descripcion: 'Incentivo Especial para Todo el Equipo' },
    { puesto: '3° PUESTO', descripcion: 'Reconocimiento Destacado y Cesta Luxor' }
  ],
  equipos: [],
  imagenes: { round1: '', round2: '', round3: '' }
}

/**
 * El contenido de la página, o los valores por defecto si todavía no hay.
 *
 * El `hero` y las `imagenes` se mergean con los suyos: una fila guardada en
 * una versión anterior de la consola no puede quedarse sin un campo nuevo
 * que la página necesita pintar.
 */
export async function cargarContenidoPagina(): Promise<ContenidoPagina> {
  const { data, error } = await supabase
    .from('gran_cosecha_pagina')
    .select('hero, premios, equipos, imagenes')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  if (!data) return CONTENIDO_BASE
  return {
    hero: { ...CONTENIDO_BASE.hero, ...(data.hero as Partial<HeroPagina> | null) },
    premios: Array.isArray(data.premios) ? (data.premios as PremioPagina[]) : [],
    equipos: Array.isArray(data.equipos) ? (data.equipos as EquipoPagina[]) : [],
    imagenes: { ...CONTENIDO_BASE.imagenes, ...(data.imagenes as Partial<ImagenesPagina> | null) }
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
  if (!contenido.premios.length) return 'La página necesita al menos un premio.'
  for (const [i, premio] of contenido.premios.entries()) {
    if (!premio.puesto.trim() || !premio.descripcion.trim()) {
      return `El premio ${i + 1} necesita su puesto y su descripción.`
    }
  }
  for (const [i, equipo] of contenido.equipos.entries()) {
    if (!equipo.nombre.trim()) return `El equipo ${i + 1} necesita su nombre.`
  }
  return null
}

/** Las fotos que la página puede cambiar: una por slot, con su URL propia. */
export type FotoPagina = 'fondo' | 'round1' | 'round2' | 'round3'

const BUCKET = 'gran-cosecha'
/** El límite es de la pantalla: la foto entra en una tarjeta de la landing. */
const LIMITE_FOTO = 5 * 1024 * 1024
const EXTENSIONES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

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
 * El nombre del archivo sale del SLOT y no del archivo elegido: subir dos
 * veces la misma foto reemplaza la anterior en vez de acumular copias en el
 * bucket. La URL lleva `?v=` con la hora porque el navegador y el CDN de
 * Supabase ya tienen la anterior cacheada — con el mismo path, la página
 * seguiría mostrando la foto vieja.
 */
export async function subirFotoPagina(slot: FotoPagina, archivo: File, urlActual: string): Promise<string> {
  if (!EXTENSIONES[archivo.type]) {
    throw new Error('La imagen tiene que ser un archivo JPG, PNG o WEBP.')
  }
  if (archivo.size > LIMITE_FOTO) {
    throw new Error('La imagen no puede pasar de 5 MB.')
  }
  const ruta = `pagina/${slot}.${EXTENSIONES[archivo.type]}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
    contentType: archivo.type,
    upsert: true
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  const url = `${data.publicUrl}?v=${Date.now()}`
  // Si el slot cambió de extensión (jpg → png), el archivo anterior queda
  // huérfano en el bucket: se borra sólo si es otro distinto del recién
  // subido, y un fallo acá no deshace la subida.
  const anterior = rutaDeUrlPublica(urlActual)
  if (anterior && anterior !== ruta) {
    await supabase.storage.from(BUCKET).remove([anterior]).catch(() => null)
  }
  return url
}
