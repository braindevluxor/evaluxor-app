import { supabase } from '../supabase'
import {
  estadosCompletosAnteriores,
  normalizarListaColaboradores
} from './colaboradoresEstado'
import type { ColaboradorItem } from '../scoring'

/**
 * Qué trabajadores de esta tienda ya salieron completos en una evaluación
 * anterior, con el estado que tenían entonces.
 *
 * POR QUÉ ESTO SE LEE DEL SERVIDOR Y NO DEL TELÉFONO
 * -------------------------------------------------
 * El teléfono no sabe nada: cada evaluación arranca con su lista vacía, así que
 * la única memoria de "esto ya lo revisé" está en las respuestas guardadas. Y se
 * leen del servidor, no de una copia local, para que dé lo mismo si el ítem lo
 * evalúa otro evaluador o desde otro celular.
 *
 * No hace falta pedirle permiso extra: `respuestas_select` pasa por
 * `puede_ver_evaluacion`, que para el EVALUADOR no exige que la evaluación esté
 * ACTIVA, solo que el módulo le esté asignado a esa sucursal. O sea que las
 * evaluaciones anteriores de la tienda son legibles.
 *
 * Y no rompe sin conexión: cargar el listado de trabajadores ya necesita red
 * (va a una Edge Function), así que este dato se pide en el mismo momento y no
 * agrega una dependencia nueva.
 */

/** Cuántas evaluaciones hacia atrás se miran. */
const EVALUACIONES_REVISADAS = 12

/**
 * Devuelve, por DNI, el estado de los trabajadores que estaban completos en la
 * evaluación más reciente donde aparecen. Un `Map` vacío significa "no hay
 * historial" y no es un error: la lista se muestra entera.
 *
 * Nunca tira. Si algo falla se devuelve el mapa vacío, que es el mismo
 * comportamiento que no tener historial: se ve la lista completa y listo. Perder
 * el historial es una molestia; romper la carga del listado deja al evaluador
 * sin poder trabajar.
 */
export async function estadosCompletosDeEvaluacionesAnteriores(
  sucursalId: string,
  itemId: string,
  fechaActual: string,
  idsChecks: readonly string[]
): Promise<Map<number, ColaboradorItem>> {
  const vacio = new Map<number, ColaboradorItem>()
  if (!sucursalId || !itemId || !fechaActual || !idsChecks.length) return vacio

  try {
    // `lt` y no `ne`: la evaluación de hoy no cuenta, aunque se esté rehaciendo
    // una de la misma fecha.
    const { data: evaluaciones, error: errorEv } = await supabase
      .from('evaluaciones')
      .select('id, fecha')
      .eq('sucursal_id', sucursalId)
      .lt('fecha', fechaActual)
      .order('fecha', { ascending: false })
      .limit(EVALUACIONES_REVISADAS)

    if (errorEv || !evaluaciones?.length) return vacio

    const ids = (evaluaciones as Array<{ id: string; fecha: string }>).map((e) => e.id)
    const { data: respuestas, error: errorResp } = await supabase
      .from('respuestas')
      .select('evaluacion_id, valor')
      .eq('item_id', itemId)
      .in('evaluacion_id', ids)

    if (errorResp || !respuestas?.length) return vacio

    // Un ítem repetible guarda una respuesta por registro, así que una evaluación
    // puede traer varias listas del mismo ítem. Se agrupan: el trabajador tiene que
    // estar completo en todos los registros donde aparece.
    const porEvaluacion = new Map<string, ColaboradorItem[][]>()
    for (const fila of respuestas as Array<{ evaluacion_id: string; valor: unknown }>) {
      const colaboradores = normalizarListaColaboradores(fila.valor)
      if (!colaboradores.length) continue
      const listas = porEvaluacion.get(fila.evaluacion_id) ?? []
      listas.push(colaboradores)
      porEvaluacion.set(fila.evaluacion_id, listas)
    }

    // El orden lo trae la consulta (fecha descendente) y `estadosCompletosAnteriores`
    // depende de eso: gana la evaluación más reciente en la que salió cada uno.
    const ordenadas = (evaluaciones as Array<{ id: string; fecha: string }>)
      .filter((e) => porEvaluacion.has(e.id))
      .map((e) => ({ fecha: e.fecha, listas: porEvaluacion.get(e.id)! }))

    return estadosCompletosAnteriores(ordenadas, idsChecks)
  } catch {
    return vacio
  }
}