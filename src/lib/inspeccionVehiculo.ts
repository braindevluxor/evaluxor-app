import type { PreEntregaRecord } from './offline/db'
import type { Item, Opcion, RevisionPreEntrega } from './types'

/**
 * Helpers puros de la herramienta de Inspección de Vehículo.
 *
 * Vive aparte de la pantalla a propósito: sin React, sin IndexedDB y sin DOM,
 * para poder probarlo solo (así se hace con `preguntasRevision` y con
 * `pasos.ts`).
 */

/** Marca del módulo-herramienta en `modulos.herramienta`. */
export const CLAVE_INSPECCION = 'INSPECCION_VEHICULO'

/** Dónde vive la herramienta dentro de `/evaluar` y la de su historial. */
export const RUTA_INSPECCION = '/evaluar/inspeccion-vehiculo'
export const RUTA_HISTORIAL = `${RUTA_INSPECCION}/historial`

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

/* --- Historial --------------------------------------------------------------- */

/**
 * El historial se alimenta de las dos orillas: lo que sigue en el equipo
 * (borradores y finalizadas aún sin subir) y lo que ya está en el servidor
 * (donde acaban las finalizadas: al subir salen de IndexedDB con sus fotos).
 * Sin las dos, un teléfono nuevo no vería nada de lo hecho antes.
 */

/** Fila del historial: la inspección vista como «qué, cuándo y en qué estado». */
export interface FilaHistorial {
  id: string
  /** Fecha calendario de la inspección (YYYY-MM-DD). */
  fecha: string
  placa: string
  /** «TOYOTA HILUX 2020»; vacío si el vehículo no se pudo traer. */
  vehiculo: string
  /** Nombre del propietario; vacío si no se capturó. */
  propietario: string
  estado: 'BORRADOR' | 'FINALIZADA'
  /** La copia del equipo todavía no llegó al servidor. */
  pendiente: boolean
  /** Última edición en ms: de ahí sale el orden (más nueva, arriba). */
  ms: number
}

/** Forma mínima que comparten el registro del equipo y la fila del servidor. */
export interface BaseHistorial {
  id: string
  fecha: string
  placa: string
  vehiculo: Record<string, unknown>
  chofer: Record<string, unknown>
  estado: string
  /** Sólo existe en el registro local; el servidor ya está subido. */
  sync?: string
  /** ms en el equipo, ISO en el servidor: de ahí sale el orden. */
  updated_at: string | number
}

function msDe(t: string | number): number {
  const n = typeof t === 'number' ? t : Date.parse(t)
  return Number.isFinite(n) ? n : 0
}

/** Una fila del historial a partir de un registro (del equipo o del servidor). */
export function filaHistorial(r: BaseHistorial): FilaHistorial {
  const v = r.vehiculo ?? {}
  const carro = [v.marca, v.modelo, v.anio]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' ')
  const c = r.chofer ?? {}
  const dueno = [c.nombre, c.apellido]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return {
    id: r.id,
    fecha: r.fecha,
    placa: String(r.placa ?? '').trim().toUpperCase(),
    vehiculo: carro,
    propietario: dueno,
    estado: r.estado === 'FINALIZADA' ? 'FINALIZADA' : 'BORRADOR',
    // El servidor no trae `sync`: una fila remota, por definición, ya subió.
    pendiente: r.sync === 'pendiente',
    ms: msDe(r.updated_at)
  }
}

/**
 * Historial unido sin repetir. Si una inspección está en las dos orillas manda
 * la del equipo: es la que lleva los cambios que todavía no se subieron.
 */
export function fusionarHistorial(local: BaseHistorial[], servidor: BaseHistorial[]): FilaHistorial[] {
  const porId = new Map<string, FilaHistorial>()
  for (const s of servidor) porId.set(s.id, filaHistorial(s))
  for (const l of local) porId.set(l.id, filaHistorial(l))
  return [...porId.values()].sort((a, b) => b.ms - a.ms)
}

/**
 * Fila del servidor → registro del equipo, para reabrir una inspección ya
 * subida y regenerar su PDF aunque el original se haya borrado del teléfono.
 */
export function registroDesdeServidor(r: RevisionPreEntrega): PreEntregaRecord {
  return {
    ...r,
    // El servidor admite observaciones vacías como null; el registro local no.
    observaciones: r.observaciones ?? '',
    // Las fotos ya no están en el equipo: el PDF las toma del bucket, por las
    // `paths` que quedaron guardadas en las respuestas.
    photoIds: [],
    created_at: msDe(r.created_at),
    updated_at: msDe(r.updated_at),
    sync: 'enviado'
  }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «15 oct 2026» a partir de la fecha calendario, sin depender del ICU del equipo. */
export function fechaLegible(fecha: string): string {
  const [y, m, d] = String(fecha ?? '').split('-').map((n) => Number(n))
  if (!y || !m || !d) return fecha
  return `${d} ${MESES[m - 1]} ${y}`
}
