import { supabase } from '../supabase'
import { notaDe, type SeguimientoResponsables } from './indicadores'

/**
 * ALERTAS DE SEGUIMIENTO POR CARGO
 * --------------------------------
 * Dos capas que no se confunden:
 *
 * · El NIVEL se calcula siempre: la nota de la celda contra los umbrales (80%
 *   amonestación, 70% llamado de atención). Vive en la matriz y cambia sola
 *   cuando entran evaluaciones nuevas.
 * · La ALERTA es un registro: lo que el Líder decidió hacer con ese cargo en
 *   esa unidad, con la nota que tenía al decidirlo. Persiste en
 *   `alertas_cargo` y sólo avanza con las acciones de la pantalla.
 *
 * Por eso `filasDeAlertas` cruza las dos: una fila aparece si está en nivel
 * (aún sin registrar) o si tiene registro (aunque hoy haya mejorado). La nota
 * actual es la de la matriz; la de la alerta explica por qué se creó.
 */

/** Por debajo de este porcentaje el cargo queda en amonestación. */
export const UMBRAL_AMONESTACION = 80
/** Por debajo de este porcentaje sube a llamado de atención (y deja amonestación). */
export const UMBRAL_LLAMADO = 70

export type NivelAlerta = 'AMONESTACION' | 'LLAMADO'

/**
 * `79` → amonestación, `69` → llamado, `80` → nada. Sin nota no hay nivel: un
 * cargo al que no se le midió nada no está en alerta, está sin medir (que es
 * un dato distinto y bastante más grave).
 */
export function nivelDeNota(nota: number | null): NivelAlerta | null {
  if (nota == null) return null
  if (nota < UMBRAL_LLAMADO) return 'LLAMADO'
  if (nota < UMBRAL_AMONESTACION) return 'AMONESTACION'
  return null
}

export interface AlertaCargo {
  id: string
  clave_cargo: string
  cargo: string
  sucursal_id: string | null
  departamento_id: string | null
  nivel: NivelAlerta
  /** La nota con la que se decidió registrarla (no la actual: ésa está en la matriz). */
  nota: number
  estado: 'PENDIENTE' | 'ATENDIDA'
  atendida_en: string | null
  atendida_por: string | null
  created_at: string
  /** Embeds: quién atendió y el nombre de la unidad, para las filas cuya unidad hoy no está en la matriz. */
  atendida?: { nombre: string } | null
  sucursal?: { nombre: string } | null
  departamento?: { nombre: string } | null
}

/** La unidad de una alerta, igual que `unidadDe` la decide en las evaluaciones. */
export function unidadDeAlerta(a: AlertaCargo): { id: string; nombre: string } {
  if (a.departamento_id) return { id: a.departamento_id, nombre: a.departamento?.nombre ?? 'Departamento' }
  return { id: a.sucursal_id ?? '', nombre: a.sucursal?.nombre ?? 'Sucursal' }
}

/** Una fila del panel de alertas: cargo × unidad, con su nivel actual y su registro. */
export interface FilaAlerta {
  clave: string
  cargo: string
  unidadId: string
  unidadNombre: string
  unidadTipo: 'sucursal' | 'departamento'
  /** Nota ACTUAL en la matriz; `null` si hoy no se mide esa celda. */
  nota: number | null
  /** Nivel que corresponde según la nota actual. */
  nivel: NivelAlerta | null
  /** El registro persistido: pendiente si lo hay, si no la atendida más reciente. */
  registro: AlertaCargo | null
}

/**
 * El registro vigente por (cargo, unidad): si hay uno pendiente manda ése (es
 * el único que puede haber, lo garantiza el índice único parcial de la base),
 * si no la atendida más reciente. `alertas` viene ordenado de más nueva a más
 * vieja desde `listarAlertas`.
 */
export function mapaDeAlertas(alertas: AlertaCargo[]): Map<string, AlertaCargo> {
  const mapa = new Map<string, AlertaCargo>()
  for (const a of alertas) {
    const u = unidadDeAlerta(a)
    if (!u.id) continue
    const k = `${a.clave_cargo}|${u.id}`
    const previo = mapa.get(k)
    if (!previo || (previo.estado === 'ATENDIDA' && a.estado === 'PENDIENTE')) mapa.set(k, a)
  }
  return mapa
}

/**
 * Las filas del panel: cada cargo × unidad que está en nivel o que tiene una
 * alerta registrada, lo peor primero (nota más baja arriba, sin nota al final,
 * lo pendiente antes que lo atendido entre notas iguales).
 */
export function filasDeAlertas(seguimiento: SeguimientoResponsables, alertas: AlertaCargo[]): FilaAlerta[] {
  const registros = mapaDeAlertas(alertas)
  const filas: FilaAlerta[] = []
  const vistas = new Set<string>()

  for (const f of seguimiento.filas) {
    for (const u of seguimiento.unidades) {
      const base = f.porUnidad[u.id]
      const nota = base ? notaDe(base.logrado, base.posible) : null
      const registro = registros.get(`${f.clave}|${u.id}`) ?? null
      const nivel = nivelDeNota(nota)
      if (!nivel && !registro) continue
      vistas.add(`${f.clave}|${u.id}`)
      filas.push({
        clave: f.clave,
        cargo: f.cargo,
        unidadId: u.id,
        unidadNombre: u.nombre,
        unidadTipo: u.tipo,
        nota,
        nivel,
        registro
      })
    }
  }

  // Los registros cuya unidad hoy no está en la matriz (una tienda sin
  // evaluaciones cerradas): la alerta sigue viva y perderla del panel sería
  // perder el seguimiento justo cuando dejó de "verse" en la matriz.
  for (const [k, a] of registros) {
    if (vistas.has(k)) continue
    const u = unidadDeAlerta(a)
    filas.push({
      clave: a.clave_cargo,
      cargo: a.cargo,
      unidadId: u.id,
      unidadNombre: u.nombre,
      unidadTipo: a.departamento_id ? 'departamento' : 'sucursal',
      nota: null,
      nivel: null,
      registro: a
    })
  }

  const claveNota = (n: number | null): number => (n == null ? Number.MAX_SAFE_INTEGER : n)
  return filas.sort(
    (a, b) =>
      claveNota(a.nota) - claveNota(b.nota) ||
      Number(a.registro?.estado === 'PENDIENTE' ? 0 : 1) - Number(b.registro?.estado === 'PENDIENTE' ? 0 : 1) ||
      a.cargo.localeCompare(b.cargo, 'es')
  )
}

/** Todas las alertas, de más nueva a más vieja: es el orden con el que se elige la vigente. */
export async function listarAlertas(): Promise<AlertaCargo[]> {
  const { data, error } = await supabase
    .from('alertas_cargo')
    .select(
      '*, atendida:atendida_por(nombre), sucursal:sucursales(nombre), departamento:departamentos_centralizados(nombre)'
    )
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as AlertaCargo[]
}

export interface AlertaAARegistrar {
  /** Clave normalizada del cargo, la misma con la que agrupa la matriz. */
  clave: string
  cargo: string
  unidadId: string
  unidadTipo: 'sucursal' | 'departamento'
  nivel: NivelAlerta
  /** La nota actual de la celda: con ésta se decide, no la histórica de la alerta. */
  nota: number
}

/**
 * Registra la alerta. Si ya hay una pendiente para ese cargo y unidad (dos
 * pantallas a la vez), la base devuelve `23505` y no es un error: el estado
 * deseado ya existe y la pantalla lo va a recargar igual.
 */
export async function registrarAlerta(a: AlertaAARegistrar): Promise<void> {
  const { error } = await supabase.from('alertas_cargo').insert({
    clave_cargo: a.clave,
    cargo: a.cargo,
    sucursal_id: a.unidadTipo === 'sucursal' ? a.unidadId : null,
    departamento_id: a.unidadTipo === 'departamento' ? a.unidadId : null,
    nivel: a.nivel,
    nota: a.nota
  })
  if (error && error.code !== '23505') throw new Error(error.message)
}

/**
 * Atiende la alerta: queda en ATENDIDA con fecha y quién. El `.eq('estado',
 * 'PENDIENTE')` es la guarda de la transición: una alerta ya atendida no se
 * re-atiende (ni se pisa quién la atendió) aunque dos pantallas lo intenten.
 */
export async function marcarAtendida(id: string, perfilId: string): Promise<void> {
  const { error } = await supabase
    .from('alertas_cargo')
    .update({ estado: 'ATENDIDA', atendida_en: new Date().toISOString(), atendida_por: perfilId })
    .eq('id', id)
    .eq('estado', 'PENDIENTE')
  if (error) throw new Error(error.message)
}
