import { claveRespuesta } from './pasos'
import { valorSinFotos } from './offline/transform'
import { yaExisteRegistroConEtiqueta } from './registro'
import type { DraftInstancia, DraftResp } from './offline/db'
import type { RegistroPrevio, RespuestaPrevia } from './data/precarga'

/** Lo que hay que meter en el borrador de la evaluación nueva. */
export interface PrecargaSecciones {
  /** Sección (CONTENEDOR) → registros nuevos, ya con id de esta evaluación. */
  instancias: Record<string, DraftInstancia[]>
  /** Respuestas de los hijos de esas secciones, por clave `item_id::instancia_id`. */
  respuestas: Record<string, DraftResp>
}

/**
 * Valor de la visita anterior listo para el borrador nuevo: SIN evidencias.
 *
 * Las fotos de la visita vieja viven en el bucket de la evaluación ANTERIOR
 * (`ev/<id>/…`) y reutilizarlas haría que una foto de meses atrás pareciera
 * evidencia de la visita de hoy. `valorSinFotos` ya quita `photoIds` (formato
 * local), pero los valores que vienen de la nube traen `paths` y ese tope se
 * limpia acá.
 */
function valorDePrecarga(valor: unknown): unknown {
  const limpio = valorSinFotos(valor)
  if (limpio && typeof limpio === 'object' && !Array.isArray(limpio) && 'paths' in limpio) {
    const copia: Record<string, unknown> = { ...(limpio as Record<string, unknown>) }
    delete copia.paths
    return copia
  }
  return limpio
}

/**
 * Precarga de secciones desde la última evaluación de la misma unidad.
 *
 * Copia sólo lo de ítems tipo sección (CONTENEDOR): los registros que el
 * evaluador fue cargando equipo por equipo y las respuestas de sus hijos
 * (p. ej. COMPONENTES, LIMPIEZA, IMPRESORA FISCAL). Los demás ítems quedan
 * vacíos, como hasta ahora.
 *
 * Tres reglas que no se pueden saltear:
 *
 * 1. **Ids nuevos**: cada registro copiado recibe un id fresco. Reusar el id
 *    de la visita anterior rompería la evaluación vieja al subir (el upsert
 *    de `instancias_grupo` es por id y re-apuntaría la fila a la evaluación
 *    nueva). Por eso las respuestas se re-clavan contra el id nuevo.
 * 2. **No pisa lo de la evaluación nueva**: los registros que ya existen en
 *    el borrador (agregados por este evaluador o por un compañero desde la
 *    nube) se detectan por etiqueta y la copia se salta; sin registro no se
 *    copia su respuesta tampoco.
 * 3. **Sólo hijos de secciones del catálogo actual**: si un ítem o una
 *    sección ya no existen (o no aplican a esta sucursal), su dato viejo no
 *    entra.
 *
 * `nuevoId` es inyectable para los tests.
 */
export function precargarSeccionesDe(
  previa: { instancias: RegistroPrevio[]; respuestas: RespuestaPrevia[] },
  items: { id: string; tipo: string; padre_id?: string | null }[],
  existentes: Record<string, DraftInstancia[]>,
  nuevoId: () => string = () => crypto.randomUUID()
): PrecargaSecciones {
  const secciones = new Set(items.filter((i) => i.tipo === 'CONTENEDOR').map((i) => i.id))
  const hijos = new Set(
    items.filter((i) => i.padre_id && secciones.has(i.padre_id)).map((i) => i.id)
  )

  const instancias: Record<string, DraftInstancia[]> = {}
  /** id del registro viejo → id con el que vive en la evaluación nueva. */
  const mapaIds = new Map<string, string>()
  const ordenadas = [...previa.instancias].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  for (const ins of ordenadas) {
    if (!secciones.has(ins.item_id)) continue
    if (yaExisteRegistroConEtiqueta(existentes[ins.item_id] ?? [], ins.etiqueta)) continue
    const id = nuevoId()
    mapaIds.set(ins.id, id)
    const copia: DraftInstancia = {
      id,
      etiqueta: ins.etiqueta,
      orden: typeof ins.orden === 'number' ? ins.orden : 0
    }
    if (ins.api_id) copia.api_id = ins.api_id
    if (ins.datos) copia.datos = ins.datos
    ;(instancias[ins.item_id] ??= []).push(copia)
  }

  const respuestas: Record<string, DraftResp> = {}
  for (const r of previa.respuestas) {
    if (!r.instancia_id) continue // sólo lo respondido dentro de un registro
    const idNuevo = mapaIds.get(r.instancia_id)
    if (!idNuevo) continue
    if (!hijos.has(r.item_id)) continue
    respuestas[claveRespuesta(r.item_id, idNuevo)] = { valor: valorDePrecarga(r.valor), por: 'yo' }
  }

  return { instancias, respuestas }
}
