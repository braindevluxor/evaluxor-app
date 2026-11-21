import { supabase } from '../supabase'
import { convertirImagenAWebP } from '../convertirMedia'
import { BUCKET } from './granCosechaPagina'
import type { ColaboradorAPI } from './colaboradores'

/**
 * GRAN COSECHA: EL CONCURSO INTERNO DE PROYECTOS
 * ---------------------------------------------
 * Tres tablas: `gran_cosecha_proyecto`, `gran_cosecha_bitacora` y
 * `gran_cosecha_riego`. La app toca SÓLO el proyecto: la bitácora la escribe
 * un trigger en la misma transacción (`gran_cosecha_registrar_cambio` en
 * `supabase/schema.sql`), así "todo cambio queda registrado" no depende de
 * que este archivo se acuerde de escribirlo — no hay forma de cambiar un
 * proyecto sin dejar registro, y si la bitácora no se puede escribir, el
 * cambio entero se revierte.
 *
 * Por eso `actualizarProyecto` es una sola llamada y no un par: no hay dos
 * statements que puedan quedar a medias.
 *
 * Los RIEGOS (el "like" de jardín) son la excepción que confirma la regla:
 * su tabla está CERRADA — ni `anon` ni la sesión tienen privilegio — y se
 * entra por DOS puertas: la edge function `registrar-riego` (la llaman los
 * portales hermanos) y `regar_proyecto` (acá, con sesión). Las dos guardan
 * la MISMA clave (`profiles.usuario` de la sesión / el `usuario` que manda el
 * portal), así que un mismo humano cuenta UNA vez entre los tres lados — y
 * esa unicidad vive en la PRIMARY KEY, no acá.
 *
 * La RLS hace el resto: cualquiera con sesión lee, cualquiera crea el SUYO
 * (`creador_id = auth.uid()`), y sólo JUEZ y LÍDER editan el de otro. Nadie
 * borra: se cancela con `estado`, que además queda en la bitácora.
 */

/** En qué punto está el proyecto del concurso. */
export type EstadoProyecto = 'PROPUESTA' | 'EN_CURSO' | 'COMPLETADO' | 'CANCELADO'

/** Lo que la bitácora registra. El nombre lo pone el trigger. */
export type TipoBitacora = 'ALTA' | 'AVANCE' | 'ESTADO' | 'EDICION' | 'MIEMBROS'

/**
 * Una persona del equipo: un usuario de EvaLuxor O un trabajador de la
 * nómina que no tiene cuenta (de cualquier sucursal).
 *
 * El usuario va con su `usuario_id` (el que cruza contra `profiles`); el
 * trabajador sin cuenta va con su CÉDULA (`nacionalidad` + `dni`, la misma
 * identidad que usan bonos y alertas) y `usuario_id` vacío. En los dos, el
 * `nombre` es la foto que se lee en pantalla — en la consola y en la
 * landing—, así que la fila se lee aunque el usuario algún día no esté.
 */
export interface MiembroEquipo {
  /** Usuario de EvaLuxor; `''` cuando es un trabajador sin cuenta. */
  usuario_id: string
  nombre: string
  /** Cédula del trabajador de la nómina (sólo cuando no tiene cuenta). */
  nacionalidad?: string
  dni?: number
}

/**
 * La identidad de UN integrante, para detectar repetidos: su usuario si
 * tiene cuenta, su cédula si es un trabajador de la nómina.
 *
 * Sin esto, dos trabajadores sin cuenta chocaban en el `usuario_id` vacío y
 * parecían el mismo integrante repetido.
 */
export function claveDeMiembro(m: MiembroEquipo): string {
  return m.usuario_id ? `u:${m.usuario_id}` : `w:${m.nacionalidad ?? ''}-${m.dni ?? ''}`
}

export interface ProyectoGranCosecha {
  id: string
  /** `2026-T1`…`2026-T4`: el trimestre en que participa. */
  periodo: string
  titulo: string
  descripcion: string
  miembros: MiembroEquipo[]
  avance: number
  /** La nota del último avance; el historial completo está en la bitácora. */
  avance_nota: string | null
  estado: EstadoProyecto
  /**
   * Las DOS fotos del participante en la landing: `imagen` es la del proyecto
   * (la cara de la tarjeta, siempre visible) y `foto` la del equipo, que la
   * página revela al pasar el mouse. Vacías = la tarjeta usa la inicial.
   * Se editan en el propio proyecto (alta o edición).
   */
  imagen: string
  foto: string
  /**
   * Los archivos de la presentación (documentos y videos). Opcional: es la
   * última columna agregada y una base con el bloque sin reaplicar no la
   * trae — por eso la pantalla usa `?? []`.
   */
  adjuntos?: AdjuntoProyecto[]
  creador_id: string | null
  created_at: string
  updated_at: string
}

/** Una fila de la bitácora de un proyecto. */
export interface FilaBitacora {
  id: string
  proyecto_id: string
  tipo: TipoBitacora
  /** Sólo en los avances. */
  porcentaje: number | null
  detalle: string
  autor_id: string | null
  created_at: string
}

// --- Lo que se puede decir en pantalla, sin tocar la red --------------------

export type ChipPastel = 'cumple' | 'riesgo' | 'noCumple' | 'sinDato'

/**
 * Cómo se lee cada estado, con su chip pastel.
 *
 * `PROPUESTA` va en gris y no en ámbar: es el estado en el que el proyecto
 * todavía no arrancó, y "sin dato" dice eso mejor que "en riesgo".
 */
export const ESTADOS: Record<EstadoProyecto, { etiqueta: string; chip: ChipPastel }> = {
  PROPUESTA: { etiqueta: 'Propuesta', chip: 'sinDato' },
  EN_CURSO: { etiqueta: 'En curso', chip: 'riesgo' },
  COMPLETADO: { etiqueta: 'Completado', chip: 'cumple' },
  CANCELADO: { etiqueta: 'Cancelado', chip: 'noCumple' }
}

/** El rótulo de cada tipo de fila en la bitácora. */
export const TIPOS_BITACORA: Record<TipoBitacora, string> = {
  ALTA: 'Proyecto presentado',
  AVANCE: 'Avance',
  ESTADO: 'Cambio de estado',
  EDICION: 'Edición',
  MIEMBROS: 'Equipo'
}

/**
 * El trimestre de una fecha, con el formato del concurso: `2026-T4`.
 *
 * Va el año primero y no al revés porque el período se ORDENA como texto en
 * la lista de proyectos (`order('periodo')`): con el año adelante, `2026-T1`
 * va antes que `2026-T2` sin tener que interpretar nada.
 */
export function periodoDe(fecha: Date = new Date()): string {
  const trimestre = Math.floor(fecha.getMonth() / 3) + 1
  return `${fecha.getFullYear()}-T${trimestre}`
}

/** `2026-T4` → `T4 2026`, para el selector y los rótulos. */
export function etiquetaPeriodo(periodo: string): string {
  const [anio, t] = periodo.split('-')
  if (!anio || !t) return periodo
  return `${t} ${anio}`
}

/**
 * Los últimos N trimestres, del más reciente al más viejo, incluyendo el de
 * la fecha dada. Es el rango que ofrece el selector: el concurso es por
 * trimestre y lo que interesa mirar es este y los anteriores.
 */
export function periodosRecientes(cantidad = 8, desde: Date = new Date()): string[] {
  const salida: string[] = []
  const actual = new Date(desde.getFullYear(), Math.floor(desde.getMonth() / 3) * 3, 1)
  for (let i = 0; i < cantidad; i++) {
    salida.push(periodoDe(actual))
    actual.setMonth(actual.getMonth() - 3)
  }
  return salida
}

/**
 * El equipo mínimo: tres personas y sin repetidas.
 *
 * Devuelve el mensaje del problema o `null` si está bien — el mismo estilo
 * que `trabajadoresParaCargo`, para que la pantalla sólo tenga que mostrar lo
 * que vuelva. El mínimo también vive en un `check` de la base; ésta es la
 * capa que lo explica antes de que el INSERT falle con un 23514 crudo.
 */
export function validarEquipo(miembros: readonly MiembroEquipo[]): string | null {
  if (miembros.length < 3) return 'El equipo necesita al menos 3 personas.'
  const vistos = new Set<string>()
  for (const m of miembros) {
    if (!m.nombre.trim()) return 'Un integrante del equipo no tiene nombre.'
    // Sin identidad no hay equipo trazable: ni usuario ni cédula.
    if (!m.usuario_id && m.dni == null) {
      return 'Un integrante no tiene ni usuario ni cédula.'
    }
    // La identidad es el usuario si tiene cuenta, la cédula si es de la
    // nómina: dos trabajadores sin cuenta antes chocaban en el usuario_id
    // vacío y parecían repetidos.
    const identidad = claveDeMiembro(m)
    if (vistos.has(identidad)) return 'Hay integrantes repetidos en el equipo.'
    vistos.add(identidad)
  }
  return null
}

/**
 * El historial de avances de un proyecto, de más reciente a más viejo.
 *
 * Sale de la MISMA bitácora que el resto de los cambios: no hay un segundo
 * historial que pueda contradecir al primero.
 */
export function historialAvances(filas: readonly FilaBitacora[]): FilaBitacora[] {
  return filas.filter((f) => f.tipo === 'AVANCE')
}

// --- La red -----------------------------------------------------------------

/**
 * Traduce el error de una tabla que todavía no existe en la base.
 *
 * El bloque `gran-cosecha.sql` se pega a mano en el SQL Editor: hasta que eso
 * pasa, cualquier consulta a las tablas devuelve 42P01. Decirlo es mejor que
 * un "No se pudo cargar" sin pista de qué hacer (mismo criterio que
 * `listarBitacora`).
 */
function errorDeTabla(error: { code?: string; message?: string }, mensaje: string): Error {
  if (error.code === '42P01' || error.code === '42501') {
    return new Error('Gran Cosecha todavía no está creada en la base. Ejecuta el bloque gran-cosecha.sql en el SQL Editor de Supabase.')
  }
  // Columna que todavía no existe en la base (un `alter table` pendiente,
  // como las fotos del proyecto): el mensaje crudo de PostgREST habla de
  // "schema cache" y no dice nada útil.
  if (error.code === 'PGRST204' || /schema cache/i.test(error.message ?? '')) {
    return new Error('Falta una columna nueva en la base: pegá el bloque de Gran Cosecha en el SQL Editor de Supabase (ver README) y recargá.')
  }
  return new Error(mensaje)
}

/** Los proyectos, del más nuevo al más viejo, opcionalmente de un trimestre. */
export async function listarProyectos(periodo?: string): Promise<ProyectoGranCosecha[]> {
  let consulta = supabase
    .from('gran_cosecha_proyecto')
    .select('*')
    .order('created_at', { ascending: false })
  if (periodo) consulta = consulta.eq('periodo', periodo)

  const { data, error } = await consulta
  if (error) throw errorDeTabla(error, 'No se pudieron cargar los proyectos.')
  return (data ?? []) as ProyectoGranCosecha[]
}

/**
 * La bitácora de UN proyecto, de más nueva a más vieja.
 *
 * Se trae entera del proyecto que se está mirando y no página por página: un
 * proyecto dura un trimestre y sus cambios se cuentan con una mano.
 */
export async function listarBitacora(proyectoId: string): Promise<FilaBitacora[]> {
  const { data, error } = await supabase
    .from('gran_cosecha_bitacora')
    .select('*')
    .eq('proyecto_id', proyectoId)
    .order('created_at', { ascending: false })

  if (error) throw errorDeTabla(error, 'No se pudo leer la bitácora del proyecto.')
  return (data ?? []) as FilaBitacora[]
}

/**
 * Los proyectos de un trimestre con su bitácora, para mirarlos de una sola
 * pasada: el detalle pide las dos cosas juntas y con esto no hay dos viajes.
 */
export async function listarProyectoConBitacora(
  proyectoId: string
): Promise<{ proyecto: ProyectoGranCosecha; bitacora: FilaBitacora[] } | null> {
  const { data, error } = await supabase
    .from('gran_cosecha_proyecto')
    .select('*, bitacora:gran_cosecha_bitacora(*)')
    .eq('id', proyectoId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw errorDeTabla(error, 'No se pudo abrir el proyecto.')
  }
  const fila = data as ProyectoGranCosecha & { bitacora: FilaBitacora[] }
  const bitacora = [...fila.bitacora].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return { proyecto: fila, bitacora }
}

export interface NuevoProyecto {
  periodo: string
  titulo: string
  descripcion: string
  miembros: MiembroEquipo[]
  /** Las dos fotos de la landing: vacías, la tarjeta usa su inicial. */
  imagen: string
  foto: string
}

/**
 * Presenta un proyecto.
 *
 * `creador_id` lo manda quien crea: la RLS exige que sea su propio id
 * (`creador_id = auth.uid()`), así que con mandar el de otro el INSERT ni si
 *quiera pasa. El equipo se guarda entero en el mismo INSERT, donde el `check`
 * de la base exige los tres mínimos.
 */
export async function crearProyecto(entrada: NuevoProyecto, creadorId: string): Promise<ProyectoGranCosecha> {
  const { data, error } = await supabase
    .from('gran_cosecha_proyecto')
    .insert({
      periodo: entrada.periodo,
      titulo: entrada.titulo.trim(),
      descripcion: entrada.descripcion.trim(),
      miembros: entrada.miembros,
      avance: 0,
      estado: 'PROPUESTA',
      imagen: entrada.imagen,
      foto: entrada.foto,
      creador_id: creadorId
    })
    .select('*')
    .single()

  if (error) throw errorDeTabla(error, 'No se pudo guardar el proyecto.')
  return data as ProyectoGranCosecha
}

/**
 * Un cambio en el proyecto: datos, estado, equipo, avance o fotos.
 *
 * Sólo se manda lo que cambió. No por el trigger —él compara campo por campo
 * y un valor idéntico no genera fila—, sino para que el `update` no pise una
 * versión de otro con campos que ésta pantalla no tocó.
 */
export interface CambiosProyecto {
  titulo?: string
  descripcion?: string
  periodo?: string
  estado?: EstadoProyecto
  miembros?: MiembroEquipo[]
  avance?: number
  avance_nota?: string
  imagen?: string
  foto?: string
  /** Los archivos de la presentación (documentos y videos). */
  adjuntos?: AdjuntoProyecto[]
}

/**
 * Aplica los cambios. La bitácora la escribe el trigger en la misma
 * transacción, así que o se guardan las dos cosas o no se guarda ninguna.
 */
export async function actualizarProyecto(id: string, cambios: CambiosProyecto): Promise<void> {
  const limpio: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(cambios)) {
    if (valor !== undefined) limpio[clave] = valor
  }
  if (!Object.keys(limpio).length) return

  limpio.updated_at = new Date().toISOString()
  const { error } = await supabase.from('gran_cosecha_proyecto').update(limpio).eq('id', id)
  if (error) throw errorDeTabla(error, 'No se pudo guardar el cambio en el proyecto.')
}

/**
 * Borra el proyecto DE VERDAD: la fila sale sola y con ella, por
 * `on delete cascade`, su bitácora y sus riegos. Acá sólo se retiran las DOS
 * fotos del bucket —no viven en la fila— y a pérdida: si el `remove` falla
 * queda un archivo huérfano, pero el proyecto ya borrado no vuelve por eso.
 *
 * QUIÉN: la RLS `gran_cosecha_proyecto_delete` es la misma cerradura que
 * editar (el equipo que lo creó, o JUEZ/LÍDER). Un `delete` filtrado por RLS
 * NO da error: devuelve cero filas, así que el `select` posterior es el que
 * distingue «borrado» de «no te corresponde» — sin él, el aviso mentiría.
 *
 * Para sacar un proyecto del concurso sin borrar su historia no se borra:
 * se CANCELA con `estado`.
 */
export async function eliminarProyecto(
  proyecto: Pick<ProyectoGranCosecha, 'id' | 'imagen' | 'foto'>
): Promise<void> {
  const { data, error } = await supabase
    .from('gran_cosecha_proyecto')
    .delete()
    .eq('id', proyecto.id)
    .select('id')
  if (error) throw errorDeTabla(error, 'No se pudo borrar el proyecto.')
  if (!data?.length) {
    // Con el botón puesto (la pantalla sólo lo ofrece a quien puede editar),
    // cero filas casi siempre es la política de borrado que todavía no existe
    // en la base: decirlo ahorra una búsqueda de culpables.
    throw new Error(
      'No se pudo borrar el proyecto. Si recién actualizaste la app, reaplicá el bloque gran-cosecha.sql en el SQL Editor de Supabase (crea la política de borrado); si no, este proyecto no te corresponde borrarlo.'
    )
  }

  const rutas = [proyecto.imagen, proyecto.foto].map(rutaDeObjeto).filter(Boolean)
  if (rutas.length) await supabase.storage.from(BUCKET).remove(rutas).catch(() => null)
}

/**
 * La ruta dentro del bucket a partir de la URL pública
 * (`…/object/public/gran-cosecha/proyectos/<uuid>.webp?v=123`).
 *
 * Vacío si la URL no es de ESTE bucket o no está bajo `proyectos/`: esas
 * fotos no las borra nadie por acá, que es lo que quiere el prefijo de la
 * política del bucket.
 */
function rutaDeObjeto(url: string | null | undefined): string {
  if (!url) return ''
  const marca = `/object/public/${BUCKET}/`
  const ruta = url.includes(marca) ? (url.split(marca)[1]?.split('?')[0] ?? '') : ''
  return ruta.startsWith('proyectos/') ? ruta : ''
}

/* -------------------------------------------------------------------------
 * LOS RIEGOS: el "like" de jardín del concurso
 *
 * Dos RPC y NI UNA lectura de tabla: `gran_cosecha_riego` está cerrada, así
 * que lo único que sale de ella es el NÚMERO y si yo ya regué — nunca quién.
 * ------------------------------------------------------------------------- */

/** El estado del riego de UN proyecto: cuántas veces y si YO ya lo regué. */
export interface RiegosProyecto {
  riegos: number
  /** `true` si la sesión de hoy ya regó ése (el botón queda puesto). */
  mio: boolean
}

/**
 * El conteo de riegos de TODOS los proyectos, por id.
 *
 * `null` = la RPC todavía no existe en la base (bloque de riegos sin
 * aplicar): la pantalla no pinta NINGÚN chip en vez de enseñar un cero que
 * sería mentira.
 */
export async function riegosDeLaCosecha(): Promise<Record<string, RiegosProyecto> | null> {
  try {
    const { data, error } = await supabase.rpc('riegos_de_la_cosecha')
    if (error) return null
    return (data ?? {}) as Record<string, RiegosProyecto>
  } catch {
    return null
  }
}

/**
 * Regar un proyecto desde EvaLuxor.
 *
 * Una vez por usuario y proyecto (la PRIMARY KEY manda): el segundo llamado
 * no agrega fila y devuelve `ya_regado: true`. La clave que se guarda es el
 * `usuario` de ESTA sesión — la misma que mandan los portales hermanos—, y
 * la función ni siquiera acepta un identificador de terceros: no hay forma
 * de regar "por otro".
 */
export async function regarProyecto(
  proyectoId: string
): Promise<{ ya_regado: boolean; riegos: number }> {
  const { data, error } = await supabase.rpc('regar_proyecto', { p_proyecto_id: proyectoId })
  if (error) {
    if (error.code === '42883' || /regar_proyecto/.test(error.message)) {
      throw new Error(
        'El SQL de riegos todavía no está aplicado en la base: pegá el bloque en el SQL Editor de Supabase y recargá esta pantalla.'
      )
    }
    throw new Error(error.message)
  }
  const r = data as { ya_regado?: boolean; riegos?: number } | null
  return { ya_regado: Boolean(r?.ya_regado), riegos: Number(r?.riegos ?? 0) }
}

/**
 * Quitar el PROPIO riego de un proyecto: el "deshacer" del me gusta.
 *
 * En espejo con `regarProyecto`: la función no acepta identidad — arma el
 * `usuario` con la sesión—, así que sólo se deshace el mío y el de los demás
 * queda intacto. Idempotente: si ya no había riego, `quitado` sale en
 * `false` y el conteo sigue siendo el verdadero.
 */
export async function quitarRiego(
  proyectoId: string
): Promise<{ quitado: boolean; riegos: number }> {
  const { data, error } = await supabase.rpc('quitar_riego', { p_proyecto_id: proyectoId })
  if (error) {
    if (error.code === '42883' || /quitar_riego/.test(error.message)) {
      throw new Error(
        'El SQL de riegos todavía no está aplicado en la base: pegá el bloque en el SQL Editor de Supabase y recargá esta pantalla.'
      )
    }
    throw new Error(error.message)
  }
  const r = data as { quitado?: boolean; riegos?: number } | null
  return { quitado: Boolean(r?.quitado), riegos: Number(r?.riegos ?? 0) }
}

/**
 * Sube una de las DOS fotos del proyecto (la imagen o la del equipo) y
 * devuelve su URL pública.
 *
 * Va al bucket de la landing bajo `proyectos/…` con nombre uuid —dos subidas
 * nunca comparten ruta, como el carrusel— y la URL anterior del MISMO campo se
 * borra si era nuestra (queda huérfana sólo si el fallo es de la red). Va
 * convertida a WebP al vuelo, igual que todo lo que sube la app.
 *
 * El prefijo `proyectos/` es el que la política del bucket abre para cualquier
 * sesión: el que puede editar el proyecto puede cambiar sus fotos.
 */
export async function subirFotoProyecto(archivo: File, urlActual: string): Promise<string> {
  const webp = await convertirImagenAWebP(archivo)
  const ruta = `proyectos/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, webp, {
    contentType: 'image/webp',
    upsert: true
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  const url = `${data.publicUrl}?v=${Date.now()}`
  const anterior = rutaDeObjeto(urlActual)
  if (anterior) {
    await supabase.storage.from(BUCKET).remove([anterior]).catch(() => null)
  }
  return url
}

/* -------------------------------------------------------------------------
 * LOS ADJUNTOS DE LA PRESENTACIÓN: documentos y videos del proyecto
 * ------------------------------------------------------------------------- */

/** Un archivo de la presentación, en la forma que queda guardada. */
export interface AdjuntoProyecto {
  /** Ruta en el bucket (`proyectos/<proyecto>/<archivo>`). */
  ruta: string
  /** Nombre con el que se subió: es el que se muestra. */
  nombre: string
  /** MIME type: decide si la página lo reproduce o lo ofrece para bajar. */
  tipo: string
  /** Tamaño en bytes. */
  bytes: number
  /** URL pública (el bucket de la landing es público). */
  url: string
  /** ISO de cuándo se subió. */
  subido_at: string
}

/** Lo que admite el input: video y documentos de lectura/oficina. */
export const ACEPTA_ADJUNTOS =
  'video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt'

/**
 * Límite por archivo: 50 MB, que es además el `file_size_limit` por
 * defecto de un bucket de Supabase. Subir de más falla del lado del
 * servidor con un mensaje que no explica nada, así que se corta ACÁ, en
 * castellano y antes de subir un megabyte.
 */
export const MAX_ADJUNTO_BYTES = 50 * 1024 * 1024

/** MIME types que entran. El prefijo `video/` cubre mp4, webm, mov… */
const TIPOS_ADJUNTO = [
  'video/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv'
]

/**
 * Por qué NO entra este archivo, o `null` si entra.
 *
 * Se rechaza en el cliente con mensaje propio: ni el tipo desconocido ni el
 * límite del bucket dicen nada útiles en el error crudo del servidor.
 */
export function rechazoDeAdjunto(archivo: File): string | null {
  const tipo = (archivo.type || '').toLowerCase()
  const permitido = TIPOS_ADJUNTO.some((p) => (p.endsWith('/') ? tipo.startsWith(p) : tipo === p))
  if (!permitido) {
    return `«${archivo.name}» no es un formato permitido: subí videos o documentos (PDF, Word, Excel, PowerPoint).`
  }
  if (archivo.size > MAX_ADJUNTO_BYTES) {
    return `«${archivo.name}» pesa ${formatoBytes(archivo.size)} y el máximo por archivo es ${formatoBytes(MAX_ADJUNTO_BYTES)}.`
  }
  return null
}

/** `1234567` → `1.2 MB`, sin depender del locale. */
export function formatoBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}

/** El nombre que va al bucket: sin acentos, sin separadores de ruta. */
function nombreSano(nombre: string): string {
  const limpio = nombre
    .normalize('NFD')
    // Con la NFD los acentos salen como combinantes detrás de la letra
    // (U+0300 a U+036F): sin esto, «presentación.pdf» viajaría con un byte
    // raro en medio del nombre.
    .split('')
    .filter((c) => {
      const codigo = c.charCodeAt(0)
      return codigo < 0x0300 || codigo > 0x036f
    })
    .join('')
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    // Se corta por el FINAL: así se conserva la extensión, que es lo que
    // decide cómo la abre el navegador.
    .slice(-80)
  return limpio || 'archivo'
}

/**
 * Sube un archivo de la presentación y devuelve su descriptor.
 *
 * Va al MISMO prefijo que las fotos (`proyectos/<id>/…`), que la política
 * del bucket ya abre para el que puede editar el proyecto. El nombre se
 * sanea y se le antepone un timestamp: dos subidas del mismo archivo no
 * pisan la URL ni el navegador sirve una versión vieja desde su caché.
 *
 * Se sube TAL CUAL —sin conversión ni recorte—: es material de
 * presentación, no una foto de la tarjeta.
 */
export async function subirAdjunto(proyectoId: string, archivo: File): Promise<AdjuntoProyecto> {
  const ruta = `proyectos/${proyectoId}/${Date.now()}-${nombreSano(archivo.name)}`
  const tipo = archivo.type || 'application/octet-stream'
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
    contentType: tipo,
    upsert: false
  })
  if (error) {
    if (/size|large|413/i.test(error.message ?? '')) {
      throw new Error(`«${archivo.name}» supera el límite de ${formatoBytes(MAX_ADJUNTO_BYTES)}.`)
    }
    throw new Error(`No se pudo subir «${archivo.name}»: ${error.message}`)
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  return {
    ruta,
    nombre: archivo.name,
    tipo,
    bytes: archivo.size,
    url: data.publicUrl,
    subido_at: new Date().toISOString()
  }
}

/**
 * Saca el archivo del bucket.
 *
 * El llamador borra PRIMERO la fila (la columna `adjuntos`) y después llama
 * acá sin esperar su resultado: si esto falla queda un archivo huérfano —que
 * no molesta— y nunca un enlace roto apuntando a algo que ya no está.
 */
export async function quitarAdjunto(adjunto: AdjuntoProyecto): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([adjunto.ruta])
  if (error) throw new Error(`No se pudo borrar «${adjunto.nombre}» del almacenamiento: ${error.message}`)
}

/* -------------------------------------------------------------------------
 * LOS INTEGRANTES SIN CUENTA: trabajadores de la nómina, de cualquier
 * sucursal — el equipo no es sólo para usuarios de EvaLuxor.
 * ------------------------------------------------------------------------- */

/**
 * Un trabajador de la nómina, en la forma CRUDA que devuelve la RPC.
 *
 * Es un `ColaboradorAPI` (mismo contrato que la API de colaboradores: los
 * campos de actividad llegan como llegan de la API) más la cédula y la
 * sucursal tal como se guardan acá. Por eso `nombreCompleto` y `esActivo`
 * lo interpretan igual que al resto — sin duplicar la normalización, que
 * vive sólo en el cliente.
 */
export interface TrabajadorNomina extends ColaboradorAPI {
  nacionalidad: string
  dni: number
  sucursal: string | null
}

/**
 * Trabajadores que coinciden con `texto` —nombre, apellido, sucursal o
 * cédula—, con cuenta o no: así el equipo acepta a cualquiera, de cualquier
 * sucursal.
 *
 * Va por RPC y no por la tabla: `trabajadores_nomina` sólo la leen LÍDER y
 * GERENTE_TH por su política, y armar equipo puede cualquiera. La función
 * devuelve SÓLO lo que el picker necesita (nunca el `datos` completo de la
 * API) y con límite: la nómina tiene miles de filas, por eso la búsqueda va
 * en el servidor y el navegador nunca la ve entera.
 *
 * `[]` significa «no coincidió nadie» — o texto demasiado corto (menos de
 * dos letras no busca); el error de red o de permisos lo recibe el llamador.
 */
export async function listarTrabajadoresEquipo(texto: string): Promise<TrabajadorNomina[]> {
  const { data, error } = await supabase.rpc('listar_trabajadores_equipo', { p_texto: texto })
  if (error) throw errorDeTabla(error, 'No se pudo buscar en la nómina de trabajadores.')
  return (data ?? []) as TrabajadorNomina[]
}
