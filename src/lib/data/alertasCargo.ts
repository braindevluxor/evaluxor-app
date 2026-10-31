import { supabase } from '../supabase'
import { claveNormalizada } from './responsables'
import { nivelDeNota, type CeldaSeguimiento, type NivelAlerta } from './seguimientoEvaluaciones'

/**
 * ALERTAS DE SEGUIMIENTO POR CARGO · UNA POR EVALUACIÓN
 * ----------------------------------------------------
 * Dos capas que no se confunden:
 *
 * · El NIVEL se calcula siempre: la nota del cargo EN ESA EVALUACIÓN contra los
 *   umbrales (80% amonestación, 70% llamado de atención). Vive en las celdas de
 *   `seguimientoPorEvaluacion` y cambia solo cuando se cierra una visita.
 * · La ALERTA es un registro: lo que el Líder decidió hacer con ese cargo en
 *   ESA VISITA, con la nota que tenía ese día. Persiste en `alertas_cargo` y
 *   sólo avanza con las acciones de la pantalla.
 *
 * Una alerta por (cargo, unidad, evaluación): el llamado de atención pertenece
 * a una visita concreta, no a la relación histórica entre el cargo y la
 * tienda. Por eso, al atenderla, esa combinación queda LIMPIA: la fila deja de
 * pedir acción hasta la próxima evaluación, que traerá sus propias fallas y
 * dirá cuáles son reincidencias.
 */

export { UMBRAL_AMONESTACION, UMBRAL_LLAMADO, nivelDeNota } from './seguimientoEvaluaciones'
export type { NivelAlerta } from './seguimientoEvaluaciones'

/**
 * A quién se le aplicó el llamado o la amonestación: una persona concreta, con
 * la identidad con la que viene la API de trabajadores (nacionalidad + dni).
 */
export interface TrabajadorAlerta {
  dni: number
  nacionalidad: string
  nombre: string
}

export interface AlertaCargo {
  id: string
  clave_cargo: string
  cargo: string
  sucursal_id: string | null
  departamento_id: string | null
  /** La evaluación de la que habla el llamado. Toda alerta nueva tiene una. */
  evaluacion_id: string
  nivel: NivelAlerta
  /** La nota con la que se decidió registrarla (no la actual: ésa está en la celda). */
  nota: number
  estado: 'PENDIENTE' | 'ATENDIDA'
  atendida_en: string | null
  atendida_por: string | null
  created_at: string
  /** Embeds: quién atendió y el nombre de la unidad, para las filas cuya unidad hoy no está en el conjunto. */
  atendida?: { nombre: string } | null
  sucursal?: { nombre: string } | null
  departamento?: { nombre: string } | null
  /** Los trabajadores elegidos al registrarla (ver `alerta_trabajadores`). */
  trabajadores?: TrabajadorAlerta[]
}

/** La unidad de una alerta, igual que `unidadDe` la decide en las evaluaciones. */
export function unidadDeAlerta(a: AlertaCargo): { id: string; nombre: string } {
  if (a.departamento_id) return { id: a.departamento_id, nombre: a.departamento?.nombre ?? 'Departamento' }
  return { id: a.sucursal_id ?? '', nombre: a.sucursal?.nombre ?? 'Sucursal' }
}

/**
 * La clave con la que una alerta se cruza con su celda: cargo, unidad Y
 * evaluación. Es la misma que usa el índice único de la base, así que dos
 * llamados de visitas distintas del mismo cargo no se pisan.
 */
export function claveAlerta(claveCargo: string, unidadId: string, evaluacionId: string): string {
  return `${claveCargo}|${unidadId}|${evaluacionId}`
}

/**
 * La alerta vigente por celda: si hay una pendiente manda ése (es el único que
 * puede haber por celda, lo garantiza el índice único parcial de la base), si
 * no la atendida más reciente. `alertas` viene ordenado de más nueva a más
 * vieja desde `listarAlertas`.
 */
export function mapaDeAlertas(alertas: AlertaCargo[]): Map<string, AlertaCargo> {
  const mapa = new Map<string, AlertaCargo>()
  for (const a of alertas) {
    const u = unidadDeAlerta(a)
    if (!u.id || !a.evaluacion_id) continue
    const k = claveAlerta(a.clave_cargo, u.id, a.evaluacion_id)
    const previo = mapa.get(k)
    if (!previo || (previo.estado === 'ATENDIDA' && a.estado === 'PENDIENTE')) mapa.set(k, a)
  }
  return mapa
}

/** Una fila del panel: el cargo en UNA evaluación, con su nivel y su registro. */
export interface FilaAlerta {
  clave: string
  cargo: string
  unidadId: string
  unidadNombre: string
  unidadTipo: 'sucursal' | 'departamento'
  /** La evaluación de la que habla la fila. */
  evaluacionId: string
  /** Fecha de esa evaluación; `null` cuando la fila viene sólo del registro. */
  fecha: string | null
  /** Nota del cargo en ESA evaluación; `null` si el conjunto no la trae. */
  nota: number | null
  nivel: NivelAlerta | null
  /** El registro persistido: pendiente si lo hay, si no la atendida más reciente. */
  registro: AlertaCargo | null
}

/**
 * Las filas del panel: cada celda que está en nivel o que tiene un llamado
 * registrado, lo peor primero (nota más baja arriba, sin nota al final, lo que
 * todavía pide acción antes que lo ya atendido entre notas iguales).
 *
 * `celdas` puede traer las del conjunto aunque no estén en nivel: el filtro
 * vive acá para que el panel no dependa de que el llamador lo recuerde. Los
 * registros que no encuentran su celda (una evaluación que salió del rango
 * cargado) se agregan igual: perder el llamado sería perder el seguimiento
 * justo donde más falta hace.
 */
export function filasDeAlertas(celdas: CeldaSeguimiento[], alertas: AlertaCargo[]): FilaAlerta[] {
  const registros = mapaDeAlertas(alertas)
  const filas: FilaAlerta[] = []
  const vistas = new Set<string>()

  for (const c of celdas) {
    const k = claveAlerta(c.clave, c.unidad.id, c.evaluacion_id)
    const registro = registros.get(k) ?? null
    // Sin nivel y sin registro, la celda no pide nada: no es ruido útil en un
    // panel de acciones pendientes.
    if (!nivelDeNota(c.nota) && !registro) continue
    vistas.add(k)
    filas.push({
      clave: c.clave,
      cargo: c.cargo,
      unidadId: c.unidad.id,
      unidadNombre: c.unidad.nombre,
      unidadTipo: c.unidad.tipo,
      evaluacionId: c.evaluacion_id,
      fecha: c.fecha,
      nota: c.nota,
      nivel: nivelDeNota(c.nota),
      registro
    })
  }

  for (const [k, a] of registros) {
    if (vistas.has(k)) continue
    const u = unidadDeAlerta(a)
    filas.push({
      clave: a.clave_cargo,
      cargo: a.cargo,
      unidadId: u.id,
      unidadNombre: u.nombre,
      unidadTipo: a.departamento_id ? 'departamento' : 'sucursal',
      evaluacionId: a.evaluacion_id,
      fecha: null,
      nota: null,
      nivel: null,
      registro: a
    })
  }

  const claveNota = (n: number | null): number => (n == null ? Number.MAX_SAFE_INTEGER : n)
  // Lo que todavía pide acción va antes: tanto la celda en nivel sin registrar
  // como la alerta pendiente; lo ya atendido cierra.
  const pideAccion = (f: FilaAlerta): number => (f.registro?.estado === 'ATENDIDA' ? 1 : 0)
  return filas.sort(
    (a, b) =>
      claveNota(a.nota) - claveNota(b.nota) ||
      pideAccion(a) - pideAccion(b) ||
      (b.fecha ?? '').localeCompare(a.fecha ?? '') ||
      a.cargo.localeCompare(b.cargo, 'es')
  )
}

/** Una unidad con sus evaluaciones, para agrupar el panel. */
export interface GrupoUnidad {
  unidadId: string
  nombre: string
  tipo: 'sucursal' | 'departamento'
  /** De más nueva a más vieja. */
  evaluaciones: { evaluacionId: string; fecha: string | null; filas: FilaAlerta[] }[]
  /** Cuántas filas de la unidad están esperando atención. */
  pendientes: number
}

/**
 * El panel agrupado: unidad → evaluación → cargos. Las unidades con más
 * pendientes quedan arriba, porque son las que piden acción hoy; dentro, la
 * visita más reciente primero, que es la que todavía se puede corregir.
 */
export function gruposPorUnidad(filas: FilaAlerta[]): GrupoUnidad[] {
  const unidades = new Map<string, GrupoUnidad>()
  for (const f of filas) {
    const g =
      unidades.get(f.unidadId) ??
      { unidadId: f.unidadId, nombre: f.unidadNombre, tipo: f.unidadTipo, evaluaciones: [], pendientes: 0 }
    const e =
      g.evaluaciones.find((x) => x.evaluacionId === f.evaluacionId) ??
      { evaluacionId: f.evaluacionId, fecha: f.fecha, filas: [] }
    e.filas.push(f)
    if (!g.evaluaciones.includes(e)) g.evaluaciones.push(e)
    if (f.registro?.estado !== 'ATENDIDA') g.pendientes++
    unidades.set(f.unidadId, g)
  }
  return Array.from(unidades.values())
    .map((g) => ({
      ...g,
      evaluaciones: [...g.evaluaciones].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    }))
    .sort((a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, 'es'))
}

/** El filtro del panel, tal como lo pide la pantalla. */
export interface FiltroSeguimiento {
  /** Texto libre contra el nombre del cargo, normalizado («Enc. de turno» encuentra «Encargado de turno»). */
  busqueda?: string
  /** Id de la unidad, o vacío para todas. */
  unidadId?: string
  /** Estado del llamado: `todos`, `sin_registrar`, `pendientes` o `atendidas`. */
  estado?: string
}

/**
 * El recorte del panel. Va en la capa de datos y no en el componente porque es
 * una regla de negocio, no de pantalla: «sin registrar» es exactamente la fila
 * en nivel sin registro, y confundirlo con «pendiente» (que ya tiene alerta)
 * cambiaría el sentido de los contadores del encabezado.
 */
export function filtrarFilas(filas: FilaAlerta[], filtro: FiltroSeguimiento = {}): FilaAlerta[] {
  const q = (filtro.busqueda ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return filas.filter((f) => {
    if (filtro.unidadId && f.unidadId !== filtro.unidadId) return false
    if (q && !claveNormalizada(f.cargo).includes(q)) return false
    if (filtro.estado === 'pendientes') return f.registro?.estado === 'PENDIENTE'
    if (filtro.estado === 'sin_registrar') return !f.registro && f.nivel != null
    if (filtro.estado === 'atendidas') return f.registro?.estado === 'ATENDIDA'
    return true
  })
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

/**
 * Los trabajadores elegidos en cada alerta, agrupados por alerta.
 *
 * Va en SU PROPIA consulta y no como embed de `listarAlertas` porque la tabla
 * `alerta_trabajadores` es recién agregada: con el embed, una base que todavía
 * no aplicó ese bloque no puede siquiera LISTAR las alertas —PostgREST truena
 * por la relación inexistente— y la pantalla entera se cae por lo que es un
 * detalle. Acá lo que se pierde, si algo, son los nombres.
 */
export async function listarTrabajadoresPorAlerta(): Promise<Map<string, TrabajadorAlerta[]>> {
  const { data, error } = await supabase
    .from('alerta_trabajadores')
    .select('alerta_id, nacionalidad, dni, nombre')
    .order('nombre')
  if (error) throw new Error(error.message)
  const mapa = new Map<string, TrabajadorAlerta[]>()
  for (const fila of (data ?? []) as unknown as (TrabajadorAlerta & { alerta_id: string })[]) {
    const lista = mapa.get(fila.alerta_id) ?? []
    lista.push({ dni: fila.dni, nacionalidad: fila.nacionalidad, nombre: fila.nombre })
    mapa.set(fila.alerta_id, lista)
  }
  return mapa
}

export interface AlertaAARegistrar {
  /** Clave normalizada del cargo, la misma con la que agrupa el seguimiento. */
  clave: string
  cargo: string
  unidadId: string
  unidadTipo: 'sucursal' | 'departamento'
  /** La visita concreta que origina el llamado: no se registra sobre el histórico. */
  evaluacionId: string
  nivel: NivelAlerta
  /** La nota del cargo en ESA evaluación: con ésta se decide, no con un promedio. */
  nota: number
  /**
   * A quién se le aplica: las personas que el Líder eligió del listado de la
   * sucursal. Sin ellos la alerta sigue siendo del cargo (queda registrada, sin
   * destinatarios concretos), que es lo que pasa en los departamentos, donde no
   * hay nómina que consultar.
   */
  trabajadores?: TrabajadorAlerta[]
}

/** Qué salió del registro: la alerta y si las personas llegaron a guardarse. */
export interface ResultadoRegistro {
  /**
   * `false` = la alerta SÍ quedó creada pero las personas no se pudieron
   * guardar (tabla nueva sin aplicar, permiso, etc.). La pantalla lo avisa
   * distinto: decir «no se pudo registrar» cuando la alerta existe es mentir.
   */
  trabajadoresGuardados: boolean
  /** Motivo legible de por qué no se guardaron. */
  motivo?: string
}

/**
 * Registra la alerta y, si vienen, a quién se le aplicó.
 *
 * Si ya hay una pendiente para esa celda (dos pantallas a la vez), la base
 * devuelve `23505` y no es un error: el estado deseado ya existe.
 *
 * Las personas van en un segundo insert y su falla NO tumba el registro — ya
 * está creado —: vuelve `motivo` para que la pantalla diga qué falta aplicar.
 */
export async function registrarAlerta(a: AlertaAARegistrar): Promise<ResultadoRegistro> {
  const { data, error } = await supabase
    .from('alertas_cargo')
    .insert({
      clave_cargo: a.clave,
      cargo: a.cargo,
      sucursal_id: a.unidadTipo === 'sucursal' ? a.unidadId : null,
      departamento_id: a.unidadTipo === 'departamento' ? a.unidadId : null,
      evaluacion_id: a.evaluacionId,
      nivel: a.nivel,
      nota: a.nota
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return { trabajadoresGuardados: true }
    throw new Error(error.message)
  }

  if (!a.trabajadores?.length) return { trabajadoresGuardados: true }

  const { error: errorTrabajadores } = await supabase.from('alerta_trabajadores').insert(
    a.trabajadores.map((t) => ({
      alerta_id: (data as { id: string }).id,
      nacionalidad: t.nacionalidad,
      dni: t.dni,
      nombre: t.nombre
    }))
  )
  if (errorTrabajadores) return { trabajadoresGuardados: false, motivo: errorTrabajadores.message }
  return { trabajadoresGuardados: true }
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
