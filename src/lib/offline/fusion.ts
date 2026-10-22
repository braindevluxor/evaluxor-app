import { claveRespuesta, type DraftEval } from './db'

/**
 * Fusión del avance de OTRO evaluador sobre el borrador local.
 *
 * El problema que resuelve: dos personas cuentan a la vez sobre los mismos ítems
 * compartidos y cada una solo ve su lista, así que si escaneo un producto que ya
 * contó el otro no me avisa de nada. Para que los dos estén al tanto de **todos**
 * los productos escaneados, cada bajada de la nube tiene que **refrescar** lo que
 * ya estaba local, no solo agregar lo que no existía (ese era el comportamiento
 * anterior: una vez fusionada la conciliación del otra persona, sus próximas
 * escaneadas no volvían a aparecer acá).
 *
 * Dos reglas cuidan de no pisar trabajo sin subir:
 *
 *  * `por: 'otros'` es un valor que vino de la nube y que este dispositivo nunca
 *    editó (toda edición lo marca `por: 'yo'`): se refresca sin más.
 *  * `por: 'yo'` solo se toca en conciliación y siempre como **unión por SKU**:
 *    nunca se borra un producto local, solo se suman los que trae la nube. En el
 *    resto de los tipos de ítem el servidor hace last-write-wins (no hay merge de
 *    respaldo), así que pisar mi respuesta con la del otro perdería lo que conté:
 *    ahí no se toca.
 */

export interface RespuestaNube {
  item_id: string
  instancia_id: string | null
  valor: unknown
  respondido_por: string
}

export interface ParamsFusionNube {
  /** Respuestas del borrador local, por clave `item_id::instancia_id`. */
  local: DraftEval['respuestas']
  /** Filas de `respuestas` tal como están hoy en el servidor. */
  nube: RespuestaNube[]
  /** Id del evaluador de este dispositivo. */
  miId: string
  /** Ítems de módulos compartidos: solo de ellos se fusiona lo del otro. */
  compartidos: Set<string>
  /**
   * true cuando el borrador local completo ya fue aceptado por el servidor. En
   * ese caso la fila de la nube me trae **lo mío fusionado con lo del otro** (al
   * subir, el servidor une la conciliación por SKU), así que puede prevalecer sin
   * perder nada. Mientras haya cambios sin subir, manda lo local y de la nube
   * solo se suman productos que aún no tengo.
   */
  subido: boolean
}

export interface ResultadoFusion {
  respuestas: DraftEval['respuestas']
  cambio: boolean
}

/** ¿Es un valor de conciliación? Se identifica por su lista de `productos`. */
export function esValorConciliacion(v: unknown): boolean {
  return !!v && typeof v === 'object' && Array.isArray((v as { productos?: unknown }).productos)
}

function comoObjeto(v: unknown): Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function productosDe(v: unknown): Record<string, unknown>[] {
  if (!esValorConciliacion(v)) return []
  return ((v as { productos?: unknown }).productos as unknown[]).filter(
    (p): p is Record<string, unknown> => !!p && typeof p === 'object' && !Array.isArray(p)
  )
}

function skuDe(p: Record<string, unknown>): string {
  return typeof p.sku === 'string' ? p.sku : ''
}

/** Solo strings: un `paths` con basura se ignora en lugar de propagarse. */
function stringsDe(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function unirStrings(...listas: unknown[]): string[] {
  return Array.from(new Set(listas.flatMap(stringsDe)))
}

/**
 * Dos objetos en uno, ganando el primero en los campos que trae. Lo que solo
 * trae el segundo se conserva, y un `null` del ganador no borra el valor que el
 * otro traía (misma idea que el `coalesce` del merge del servidor).
 */
function ganar(ganador: Record<string, unknown>, otro: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...otro, ...ganador }
  for (const [k, v] of Object.entries(ganador)) {
    if (v == null && otro[k] != null) out[k] = otro[k]
  }
  return out
}

/** Dos productos del mismo SKU en uno: gana `ganador`, pero nada del otro se pierde. */
function mezclarProducto(ganador: Record<string, unknown>, otro: Record<string, unknown>): Record<string, unknown> {
  const out = ganar(ganador, otro)
  // Las fotos solo se agregan, nunca se borran (regla de todo el sistema).
  const paths = unirStrings(ganador.paths, otro.paths)
  if (paths.length) out.paths = paths
  else delete out.paths
  const locales = unirStrings(ganador.photoIds, otro.photoIds)
  if (locales.length) out.photoIds = locales
  else delete out.photoIds
  return out
}

/**
 * Dos valores de conciliación en uno solo, uniendo `productos` por SKU.
 *
 *  * `prevaleceNube` → en los SKUs comunes manda la nube (lo que subí ya
 *    fusionado con lo del otro); los SKUs que solo están locales se conservan
 *    igual, porque un push rechazado o cambios sin subir no pueden perderse.
 *  * lo contrario → mandan los productos locales y la nube solo aporta SKUs
 *    nuevos.
 */
export function fusionarConciliacion(local: unknown, nube: unknown, prevaleceNube: boolean): unknown {
  const objLocal = comoObjeto(local)
  const objNube = comoObjeto(nube)
  const base = ganar(prevaleceNube ? objNube : objLocal, prevaleceNube ? objLocal : objNube)

  const prodLocal = productosDe(local)
  const prodNube = productosDe(nube)
  const principales = prevaleceNube ? prodNube : prodLocal
  const secundarios = prevaleceNube ? prodLocal : prodNube
  const skusPrincipales = new Set(principales.map(skuDe))

  const mezclados = principales.map((p) => {
    const otro = secundarios.find((x) => skuDe(x) === skuDe(p) && !!skuDe(x))
    return otro ? mezclarProducto(p, otro) : p
  })
  for (const p of secundarios) {
    if (!skusPrincipales.has(skuDe(p))) mezclados.push(p)
  }
  // Solo se escribe `productos` si algo hay o si el valor ya lo traía: un valor
  // que no es conciliación no gana una lista vacía por el camino.
  if (mezclados.length || 'productos' in base) base.productos = mezclados

  // Fotos del ítem en el formato viejo (arriba del valor, fuera de `productos`).
  const paths = unirStrings(objLocal.paths, objNube.paths)
  if (paths.length) base.paths = paths
  else delete base.paths
  return base
}

function iguales(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Los valores vienen de JSON: el orden de las claves es estable, así que la
  // serialización alcanza para saber si cambió algo (y evita re-pintar de más).
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  } catch {
    return false
  }
}

/**
 * Fusiona las filas de la nube sobre las respuestas locales. Devuelve `cambio`
 * para que quien llama solo re-renderice/persista si algo se movió.
 */
export function fusionarRespuestasNube(p: ParamsFusionNube): ResultadoFusion {
  const respuestas: DraftEval['respuestas'] = { ...p.local }
  let cambio = false

  for (const r of p.nube) {
    // Solo módulos compartidos participan de la colaboración en vivo.
    if (!p.compartidos.has(r.item_id)) continue
    const key = claveRespuesta(r.item_id, r.instancia_id)
    const actual = respuestas[key]

    if (!actual) {
      // No tengo copia local. Si la fila es mía ya está en la nube: la pinta la
      // apertura de la evaluación, acá no hace falta traerla.
      if (r.respondido_por === p.miId) continue
      respuestas[key] = { valor: r.valor, por: 'otros' }
      cambio = true
      continue
    }

    if (esValorConciliacion(actual.valor) || esValorConciliacion(r.valor)) {
      // Unión por SKU: lo mío sin subir manda; si mi borrador ya está entero
      // arriba, la nube pasa a mandar porque trae lo del servidor (mi subida
      // fusionada con la del otro). `prevaleceNube` nunca borra productos locales.
      const prevaleceNube = p.subido || actual.por === 'otros'
      const mezcla = fusionarConciliacion(actual.valor, r.valor, prevaleceNube)
      if (!iguales(actual.valor, mezcla)) {
        respuestas[key] = { ...actual, valor: mezcla }
        cambio = true
      }
      continue
    }

    // Resto de tipos: solo se refresca lo que es del otro (ver módulo).
    if (actual.por !== 'otros') continue
    if (!iguales(actual.valor, r.valor)) {
      respuestas[key] = { valor: r.valor, por: 'otros' }
      cambio = true
    }
  }

  return { respuestas, cambio }
}
