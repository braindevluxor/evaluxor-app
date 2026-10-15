import type { Item, Opcion } from './types'

/**
 * Helpers puros de la herramienta de Inspección de Vehículo.
 *
 * Vive aparte de la pantalla a propósito: sin React, sin IndexedDB y sin DOM,
 * para poder probarlo solo (así se hace con `preguntasRevision` y con
 * `pasos.ts`).
 */

/** Marca del módulo-herramienta en `modulos.herramienta`. */
export const CLAVE_INSPECCION = 'INSPECCION_VEHICULO'

/** Sistemas de combustible que se ofrecen en la ficha del vehículo. */
export const COMBUSTIBLES = [
  'Gasolina',
  'GNV (Gas vehicular)',
  'Diésel',
  'Híbrido',
  'Eléctrico',
  'Eléctrico enchufable'
] as const

export interface GrupoInspeccion {
  /** Título de la sección CONTENEDOR; `null` = ítems sueltos sin sección. */
  seccion: string | null
  items: Item[]
}

/**
 * Los ítems del módulo agrupados por su sección, en el orden en que se imprimen.
 *
 * Van primero las secciones con sus hijos y al final los sueltos, que es donde
 * el catálogo pone el dictamen: cerrar con «¿queda en condiciones de circular?»
 * después de las tres revisiones es el orden en que se lee una inspección. Un
 * hijo cuya sección no esté en la lista (desactivada entre tantas) no se pierde:
 * cae con los sueltos, porque perder una pregunta de inspección es mentirle al
 * que va a firmar el PDF.
 */
export function seccionarItems(items: Item[]): GrupoInspeccion[] {
  const evaluables = items.filter((i) => i.tipo !== 'CONTENEDOR')
  const contenedores = items.filter((i) => i.tipo === 'CONTENEDOR')
  const idsSecciones = new Set(contenedores.map((c) => c.id))

  const grupos: GrupoInspeccion[] = []
  for (const c of contenedores) {
    const hijos = evaluables.filter((i) => i.padre_id === c.id)
    if (hijos.length) grupos.push({ seccion: c.texto, items: hijos })
  }

  // Sueltos: el dictamen final del catálogo y los huérfanos (sección padre que
  // ya no está activa), que van al final en vez de perderse.
  const sueltos = evaluables.filter((i) => !i.padre_id || !idsSecciones.has(i.padre_id))
  if (sueltos.length) grupos.push({ seccion: null, items: sueltos })

  return grupos
}

export interface EvidenciaPie {
  /** Qué se ve en la foto: el ítem y, si aplica, la opción o la incidencia. */
  pie: string
  /** Fotos que siguen en el dispositivo (todavía no subidas). */
  photoIds: string[]
  /** Fotos ya en el bucket: rutas para pedir una URL firmada. */
  paths: string[]
}

/** El valor de ItemRenderer, sea un objeto (checklist) o una lista de evidencias. */
function evidenciasCrudas(valor: unknown): { claves: string[]; valorPorClave: Record<string, unknown> } {
  const v = valor as { evidencias?: unknown } | null
  const ev = v?.evidencias
  if (!ev) return { claves: [], valorPorClave: {} }
  if (Array.isArray(ev)) {
    // CUMPLE_NO_CUMPLE: lista de { photoIds, comentario }.
    const mapa: Record<string, unknown> = {}
    const claves = ev.map((e, i) => {
      const clave = String(i)
      mapa[clave] = e
      return clave
    })
    return { claves, valorPorClave: mapa }
  }
  if (typeof ev === 'object') {
    const mapa = ev as Record<string, unknown>
    return { claves: Object.keys(mapa), valorPorClave: mapa }
  }
  return { claves: [], valorPorClave: {} }
}

/**
 * Las fotos de UNA respuesta, ya con el pie que va impreso en el PDF.
 *
 * El pie es lo único que hace útil una foto en el papel: «frente» sin más no
 * dice nada, «Carrocería y pintura · Sin rayones» sí dice qué se miró. Si la
 * evidencia traía un comentario (una incidencia escrita a mano), va también.
 */
export function evidenciasDe(item: Item, valor: unknown): EvidenciaPie[] {
  const { claves, valorPorClave } = evidenciasCrudas(valor)
  const opciones = new Map(((item.opciones ?? []) as Opcion[]).map((o) => [o.id, o]))

  const salida: EvidenciaPie[] = []
  for (const clave of claves) {
    const e = valorPorClave[clave] as { photoIds?: string[]; paths?: string[]; comentario?: string } | null
    const ids = e?.photoIds ?? []
    // `.local/<id>` es el marcador con el que `transform.ts` nombra una foto que
    // nunca llegó al bucket: no es una ruta real y pedirle una URL firmada da 404.
    const nube = (e?.paths ?? []).filter((p) => p && !p.startsWith('.local/'))
    if (!ids.length && !nube.length) continue
    // En un CHECKLIST la clave es el id de la opción; en un CUMPLE_NO_CUMPLE es
    // la posición de la evidencia en la lista y no lleva etiqueta propia.
    const opcion = opciones.get(clave)
    const comentario = typeof e?.comentario === 'string' ? e.comentario.trim() : ''
    const cola = [opcion?.etiqueta?.trim() ?? '', comentario].filter(Boolean).join(' · ')
    salida.push({ pie: cola ? `${item.texto} · ${cola}` : item.texto, photoIds: ids, paths: nube })
  }
  return salida
}

/** Todas las evidencias de un set de respuestas, listas para el PDF. */
export function evidenciasDeRespuestas(items: Item[], respuestas: Record<string, unknown>): EvidenciaPie[] {
  const salida: EvidenciaPie[] = []
  for (const item of items) {
    if (item.tipo === 'CONTENEDOR') continue
    salida.push(...evidenciasDe(item, respuestas[item.id]))
  }
  return salida
}
