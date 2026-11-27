import { incumplimientosPorResponsable, valorPorResponsable } from '../scoring'
import {
  aplicarOpcionesSucursal,
  hallazgosDeCargo,
  notaDe,
  unidadDe,
  type ConjuntoDatos
} from './indicadores'
import { claveNormalizada } from './responsables'

/**
 * SEGUIMIENTO POR UNIDAD · UNA CELDA POR EVALUACIÓN
 * ------------------------------------------------
 * La matriz vieja (`seguimientoResponsables`) promediaba TODO el histórico de
 * un cargo en una unidad: «87%» decía cómo venía rindiendo, no qué pasó en la
 * visita de marzo. El seguimiento necesita lo contrario: una fila por EVALUACIÓN,
 * con la nota que sacó cada cargo EN ESA VISITA, para que cada caída tenga su
 * propio llamado de atención y la próxima evaluación pueda decir si se repitió.
 *
 * Misma fórmula que el resto de la app: la nota sale de `valorPorResponsable`
 * con los pesos repartidos igual, así un 68% acá es el mismo 68% del
 * «Puntaje por responsable» de EvaluacionDetalle. Lo único que cambia es el
 * alcance: en vez de todas las respuestas del histórico, sólo las de ESA
 * evaluación.
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
 *
 * Vive acá y no en `alertasCargo` porque el nivel ES una lectura de la celda:
 * la alerta es lo que se decidió hacer con ese nivel, y traerla de vuelta para
 * calcularlo abriría un ciclo entre los dos módulos.
 */
export function nivelDeNota(nota: number | null): NivelAlerta | null {
  if (nota == null) return null
  if (nota < UMBRAL_LLAMADO) return 'LLAMADO'
  if (nota < UMBRAL_AMONESTACION) return 'AMONESTACION'
  return null
}

/** El cargo en UNA evaluación concreta: es la unidad mínima del seguimiento. */
export interface CeldaSeguimiento {
  evaluacion_id: string
  fecha: string
  unidad: { id: string; nombre: string; tipo: 'sucursal' | 'departamento' }
  /** Clave normalizada del cargo, la misma con la que se cruzan las alertas. */
  clave: string
  cargo: string
  /** Nota del cargo SÓLO en esta evaluación. `null` = no se le pudo medir nada. */
  nota: number | null
  /** Puntos que perdió en esta evaluación (desempata entre notas iguales). */
  puntos: number
}

/**
 * Una caída concreta de un cargo: el ítem, el punto de checklist si lo hay, y
 * su historia en esa unidad.
 *
 * Van juntos el total y la reincidencia porque el número sólo se entiende
 * acompañado: «reincidente» sin decir «5 faltas en el histórico» es un juicio
 * sin contexto, y «5 faltas» sin decir cuántas se repitieron esconde que tres
 * de ellas cayeron seguidas.
 */
export interface PuntoFalla {
  modulo: string
  item_id: string
  item: string
  /** El check concreto que falló; `null` cuando la falla es del ítem completo. */
  check: string | null
  /** Cuántas veces le falló ese punto en el histórico del cargo en esa unidad. */
  faltas: number
  /**
   * Cuántas de esas faltas se repitieron en la evaluación inmediata anterior.
   * La racha se corta cuando una evaluación no lo falla: 1,2 | 4,5,6 son 5
   * faltas y 3 reincidencias, porque la 3 no falló y la 4 empieza racha nueva.
   */
  reincidencias: number
  /** ¿Esta falla de la evaluación seleccionada se repitió en la anterior? */
  esReincidente: boolean
}

/**
 * Cada cargo con nota o con fallas, evaluación por evaluación, de peor nota a
 * mejor. SÓLO entra lo que está en nivel (por debajo del umbral de
 * amonestación): el resto del histórico no pide seguimiento y listarlo sería
 * ruido — la pantalla mide acciones pendientes, no el libro de calificaciones.
 */
export function seguimientoPorEvaluacion(datos: ConjuntoDatos): CeldaSeguimiento[] {
  const evalDe = new Map(datos.evaluaciones.map((e) => [e.id, e]))
  const itemDe = new Map(datos.items.map((i) => [i.id, i]))
  // (evaluación, cargo) → lo que perdió ahí. Se parte por evaluación porque ése
  // es el alcance de la nota: nunca se junta el logrado de dos visitas.
  const celdas = new Map<string, CeldaSeguimiento & { logrado: number; posible: number }>()

  for (const r of datos.respuestas) {
    const ev = evalDe.get(r.evaluacion_id)
    const item = itemDe.get(r.item_id)
    if (!ev || !item) continue
    const unidadId = unidadDe(ev)
    const itemAplicado = aplicarOpcionesSucursal(item, unidadId, datos)

    const notas = valorPorResponsable([itemAplicado], [r])
    const incs = incumplimientosPorResponsable(itemAplicado, r.valor)
    if (!notas.length && !incs.length) continue

    const unidad = {
      id: unidadId,
      nombre: ev.sucursal?.nombre ?? ev.departamento?.nombre ?? 'Sin unidad',
      tipo: ev.departamento_id ? ('departamento' as const) : ('sucursal' as const)
    }

    const obtener = (responsable: string) => {
      const clave = claveNormalizada(responsable)
      if (!clave) return null
      const k = `${ev.id}|${clave}`
      const existente = celdas.get(k)
      if (existente) return existente
      const nueva = {
        evaluacion_id: ev.id,
        fecha: ev.fecha,
        unidad,
        clave,
        cargo: responsable,
        nota: null,
        puntos: 0,
        logrado: 0,
        posible: 0
      }
      celdas.set(k, nueva)
      return nueva
    }

    for (const n of notas) {
      const celda = obtener(n.responsable)
      if (!celda) continue
      celda.logrado += n.logrado
      celda.posible += n.posible
    }
    for (const a of incs) {
      const celda = obtener(a.responsable)
      if (!celda) continue
      celda.puntos += a.puntos
    }
  }

  return Array.from(celdas.values())
    .map((c) => ({ ...c, nota: notaDe(c.logrado, c.posible) }))
    .filter((c) => c.nota != null && c.nota < UMBRAL_AMONESTACION)
    .sort(
      (a, b) =>
        (a.nota ?? 0) - (b.nota ?? 0) ||
        b.puntos - a.puntos ||
        b.fecha.localeCompare(a.fecha) ||
        a.cargo.localeCompare(b.cargo, 'es')
    )
}

/**
 * Las caídas de UN cargo en UNA evaluación, con su historia en esa unidad.
 *
 * La reincidencia se decide contra la evaluación INMEDIATA ANTERIOR de ese
 * cargo en esa unidad — no contra «cualquier evaluación pasada—: si el punto
 * se arregló y volvió a caer, es un hecho nuevo, y contar eso como
 * reincidencia sería mentirle al Líder sobre lo que está pasando.
 *
 * El corte de la racha se apoya en el listado de evaluaciones de la unidad, no
 * en las fallas: una evaluación donde el punto no falló no aparece en los
 * hallazgos y aun así tiene que cortar la racha (que es exactamente el caso de
 * la evaluación 3 del ejemplo de negocio).
 */
export function puntosFalladosDeCargo(
  datos: ConjuntoDatos,
  cargo: string,
  unidadId: string,
  evaluacionId: string
): PuntoFalla[] {
  const clave = claveNormalizada(cargo)
  if (!clave) return []
  const hallazgos = hallazgosDeCargo(datos, cargo, unidadId)
  if (!hallazgos.length) return []

  // Las evaluaciones del cargo en esa unidad, en orden: es la cinta contra la
  // que se mide si una falta vino seguida de otra.
  const evaluaciones = datos.evaluaciones
    .filter((ev) => unidadDe(ev) === unidadId)
    .map((ev) => ev.id)
    .sort((a, b) => {
      const fa = datos.evaluaciones.find((e) => e.id === a)?.fecha ?? ''
      const fb = datos.evaluaciones.find((e) => e.id === b)?.fecha ?? ''
      return fa.localeCompare(fb) || a.localeCompare(b)
    })
  const posicion = new Map(evaluaciones.map((id, i) => [id, i]))

  interface Acumulado {
    modulo: string
    item_id: string
    item: string
    check: string | null
    faltas: number
    reincidencias: number
    enSeleccion: boolean
    esReincidente: boolean
  }
  const acumulados = new Map<string, Acumulado>()
  const clavePunto = (item_id: string, check: string | null): string => `${item_id}|${check ?? ''}`
  // Un check caído es un punto, y cada uno lleva su propio historial: el ítem
  // puede fallar en tres puntos distintos y sólo uno de ellos reincidente. Los
  // ítems sin checks (cumple/no cumple, plano) son un solo punto sin nombre.
  const puntosDe = (h: { item_id: string; checks: string[] }): (string | null)[] =>
    h.checks.length ? h.checks : [null]
  // Qué puntos cayeron en cada evaluación, para preguntarle a la anterior.
  const porEvaluacion = new Map<string, Set<string>>()
  for (const h of hallazgos) {
    const set = porEvaluacion.get(h.evaluacion_id) ?? new Set<string>()
    for (const check of puntosDe(h)) set.add(clavePunto(h.item_id, check))
    porEvaluacion.set(h.evaluacion_id, set)
  }

  for (const h of hallazgos) {
    for (const check of puntosDe(h)) {
      const k = clavePunto(h.item_id, check)
      const a = acumulados.get(k) ?? {
        modulo: h.modulo,
        item_id: h.item_id,
        item: h.item,
        check,
        faltas: 0,
        reincidencias: 0,
        enSeleccion: false,
        esReincidente: false
      }
      a.faltas++

      const i = posicion.get(h.evaluacion_id)
      const anterior = i != null && i > 0 ? evaluaciones[i - 1] : null
      const seRepitio = !!anterior && (porEvaluacion.get(anterior)?.has(k) ?? false)
      if (seRepitio) a.reincidencias++
      if (h.evaluacion_id === evaluacionId) {
        a.enSeleccion = true
        a.esReincidente = seRepitio
      }
      acumulados.set(k, a)
    }
  }

  return Array.from(acumulados.values())
    .filter((a) => a.enSeleccion)
    .map((a) => ({
      modulo: a.modulo,
      item_id: a.item_id,
      item: a.item,
      check: a.check,
      faltas: a.faltas,
      reincidencias: a.reincidencias,
      esReincidente: a.esReincidente
    }))
    .sort(
      (a, b) =>
        Number(b.esReincidente) - Number(a.esReincidente) ||
        b.faltas - a.faltas ||
        a.item.localeCompare(b.item, 'es') ||
        (a.check ?? '').localeCompare(b.check ?? '', 'es')
    )
}
