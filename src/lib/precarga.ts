import { claveRespuesta } from './pasos'
import { valorSinFotos } from './offline/transform'
import { yaExisteRegistroConEtiqueta } from './registro'
import { estadoConciliacion } from './scoring'
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
 * De los SKU que NO conciliaron en la visita anterior, qué parte entra como
 * muestra en la precarga de conciliación.
 *
 * No se copia la conciliación entera porque el inventario cambió por completo
 * entre visitas: traer teórica y física viejas obliga a recontar igual y
 * encima deja en la pantalla números que ya no son ciertos (y que puntúan si
 * nadie los toca). Lo que sí sirve es la LISTA de qué revisar —que siga
 * descuadrando lo que ya descuadraba— y de eso sólo un 20 %, al azar: es una
 * muestra de verificación, no el inventario completo.
 */
export const MUESTRA_CONCILIACION = 0.2

/** Un producto de la visita anterior, con lo mínimo para muestrearlo. */
interface ProductoPrevio {
  sku?: string
  teorica?: number | null
  fisica?: number | null
}

/**
 * La conciliación de la visita anterior, muestreada y SIN cantidades.
 *
 * Se queda sólo con los SKU que no conciliaron (los que sí, ya no hacen
 * falta: si el inventario sigue igual, van a conciliar solos) y sólo con una
 * parte de esos. Va SIN teórica ni física: el evaluador reconta y el número
 * del sistema lo trae el escaneo, como en cualquier producto nuevo. El
 * nombre tampoco se copia —puede haber cambiado— y lo trae el mismo escaneo.
 */
function conciliacionMuestreada(valor: unknown, aleatorio: () => number): unknown {
  const v = valor as { productos?: unknown } | null
  const productos = Array.isArray(v?.productos) ? (v.productos as ProductoPrevio[]) : []
  const desconciliados = productos.filter(
    (p) => typeof p.sku === 'string' && p.sku && estadoConciliacion(p) !== 'concilia'
  )
  const cantidad = Math.ceil(desconciliados.length * MUESTRA_CONCILIACION)
  const muestra = muestrear(desconciliados, cantidad, aleatorio)
  const base = (valorSinFotos(valor) ?? {}) as Record<string, unknown>
  return { ...base, productos: muestra.map((p) => ({ sku: p.sku })) }
}

/** `cantidad` elementos elegidos al azar, sin repetir (Fisher-Yates). */
function muestrear<T>(lista: T[], cantidad: number, aleatorio: () => number): T[] {
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia.slice(0, cantidad)
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
function valorDePrecarga(valor: unknown, tipo: string | undefined, aleatorio: () => number): unknown {
  // La conciliación no se copia: se muestrea, por las razones de
  // `conciliacionMuestreada`.
  if (tipo === 'CONCILIACION') return conciliacionMuestreada(valor, aleatorio)
  const limpio = valorSinFotos(valor)
  if (limpio && typeof limpio === 'object' && !Array.isArray(limpio) && 'paths' in limpio) {
    const copia: Record<string, unknown> = { ...(limpio as Record<string, unknown>) }
    delete copia.paths
    return copia
  }
  return limpio
}

/**
 * Precarga desde la última evaluación de la misma unidad.
 *
 * Qué copia de cada ítem lo decide el interruptor «Traer datos de la
 * evaluación pasada» de Config → Ítems (`items.precarga`, default activo):
 *
 * - **Sección (CONTENEDOR)**: sus registros (equipos, línea de caja…) y, con
 *   ellos, las respuestas de sus hijos marcados.
 * - **Hijo de sección**: su respuesta dentro de cada registro copiado.
 * - **Ítem suelto** (sin sección): su respuesta directa de la visita previa.
 *
 * El `LISTA_COLABORADORES` queda fuera siempre: la rotación de personal hace
 * inútil la lista de trabajadores de meses atrás.
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
 *    copia su respuesta tampoco. Las respuestas precargadas además van al
 *    fondo del spread en `EvaluarSucursal`, nunca por encima.
 * 3. **Sólo hijos de secciones del catálogo actual**: si un ítem o una
 *    sección ya no existen (o no aplican a esta sucursal), su dato viejo no
 *    entra.
 *
 * `nuevoId` es inyectable para los tests.
 */
export function precargarSeccionesDe(
  previa: { instancias: RegistroPrevio[]; respuestas: RespuestaPrevia[] },
  items: { id: string; tipo: string; padre_id?: string | null; precarga?: boolean | null }[],
  existentes: Record<string, DraftInstancia[]>,
  nuevoId: () => string = () => crypto.randomUUID(),
  /** Inyectable como `nuevoId` para poder probar el muestreo de conciliación. */
  aleatorio: () => number = Math.random
): PrecargaSecciones {
  // Elegible para la precarga: el listado de trabajadores queda fuera sea
  // cual sea su interruptor y el resto sólo si está marcado (`!== false`:
  // los ítems guardados antes de la columna no la traen y cuentan como
  // marcados, así la feature no cambia el comportamiento existente).
  const elegible = (i: { tipo: string; precarga?: boolean | null }) =>
    i.tipo !== 'LISTA_COLABORADORES' && i.precarga !== false

  const secciones = new Set(items.filter((i) => i.tipo === 'CONTENEDOR' && elegible(i)).map((i) => i.id))
  const hijos = new Set(
    items.filter((i) => i.padre_id && secciones.has(i.padre_id) && elegible(i)).map((i) => i.id)
  )
  /** Tipo de cada ítem: es lo que decide CÓMO se copia su respuesta. */
  const tipoDe = new Map(items.map((i) => [i.id, i.tipo]))

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
    if (!r.instancia_id) continue // las directas se tratan más abajo
    const idNuevo = mapaIds.get(r.instancia_id)
    if (!idNuevo) continue // la sección no se copió → su respuesta tampoco
    if (!hijos.has(r.item_id)) continue
    respuestas[claveRespuesta(r.item_id, idNuevo)] = {
      valor: valorDePrecarga(r.valor, tipoDe.get(r.item_id), aleatorio),
      por: 'yo'
    }
  }

  // Ítems sueltos marcados: su respuesta directa de la visita anterior
  // (clave `item_id::`, sin instancia). Si el ítem ahora vive dentro de una
  // sección o ya no existe, su dato viejo no entra.
  const sueltos = new Set(
    items.filter((i) => i.tipo !== 'CONTENEDOR' && !i.padre_id && elegible(i)).map((i) => i.id)
  )
  for (const r of previa.respuestas) {
    if (r.instancia_id) continue
    if (!sueltos.has(r.item_id)) continue
    respuestas[claveRespuesta(r.item_id)] = {
      valor: valorDePrecarga(r.valor, tipoDe.get(r.item_id), aleatorio),
      por: 'yo'
    }
  }

  return { instancias, respuestas }
}
