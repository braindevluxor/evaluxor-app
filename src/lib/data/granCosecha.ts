import { supabase } from '../supabase'
import { listarUsuarios, type ProfileVista } from './usuarios'

/**
 * GRAN COSECHA: EL CONCURSO INTERNO DE PROYECTOS
 * ---------------------------------------------
 * Dos tablas (`gran_cosecha_proyecto` y `gran_cosecha_bitacora`) y una
 * escritura: la app toca SÓLO el proyecto. La bitácora la escribe un trigger
 * en la misma transacción (`gran_cosecha_registrar_cambio` en
 * `supabase/schema.sql`), así "todo cambio queda registrado" no depende de
 * que este archivo se acuerde de escribirlo — no hay forma de cambiar un
 * proyecto sin dejar registro, y si la bitácora no se puede escribir, el
 * cambio entero se revierte.
 *
 * Por eso `actualizarProyecto` es una sola llamada y no un par: no hay dos
 * statements que puedan quedar a medias.
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
 * Una persona del equipo. Va con el `usuario_id` (para cruzar contra
 * `profiles`) y el `nombre` de la foto: si el usuario algún día no está, la
 * fila se sigue leyendo igual que en `alerta_trabajadores`.
 */
export interface MiembroEquipo {
  usuario_id: string
  nombre: string
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
    if (vistos.has(m.usuario_id)) return 'Hay integrantes repetidos en el equipo.'
    vistos.add(m.usuario_id)
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

/** Candidatos a integrantes del equipo: los usuarios activos con rol asignado. */
export function candidatosDeEquipo(perfiles: readonly ProfileVista[]): ProfileVista[] {
  return perfiles.filter((p) => p.activo && p.rol !== 'SIN_ROL')
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
function errorDeTabla(error: { code?: string }, mensaje: string): Error {
  if (error.code === '42P01' || error.code === '42501') {
    return new Error('Gran Cosecha todavía no está creada en la base. Ejecuta el bloque gran-cosecha.sql en el SQL Editor de Supabase.')
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
      creador_id: creadorId
    })
    .select('*')
    .single()

  if (error) throw errorDeTabla(error, 'No se pudo guardar el proyecto.')
  return data as ProyectoGranCosecha
}

/**
 * Un cambio en el proyecto: datos, estado, equipo o avance.
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
 * Los posibles integrantes del equipo, listos para elegir.
 *
 * Se reusa `listarUsuarios` (trae el nombre y la sucursal) y acá sólo se
 * recorta a los activos con rol: SIN_ROL todavía no puede entrar a la app, y
 * meterlo en un equipo sería sumar a alguien que no va a ver el concurso.
 */
export async function candidatosDeEquipoAsync(): Promise<ProfileVista[]> {
  return candidatosDeEquipo(await listarUsuarios())
}
