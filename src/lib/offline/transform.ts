import { extensionDeMime } from '../fotos'

/**
 * Ruta en Storage de una evidencia. La extensión la dicta el MIME del archivo
 * (antes era siempre `.jpg`): así un video no termina con nombre de imagen, y
 * de la extensión se colige el tipo al mostrarla —una URL firmada no trae el
 * contentType—.
 */
export function photoPath(evaluacionId: string, itemId: string, photoId: string, mime = 'image/jpeg'): string {
  return `ev/${evaluacionId}/${itemId}/${photoId}.${extensionDeMime(mime)}`
}

/**
 * Rutas con las que esa evidencia pudo haberse subido, en orden de
 * probabilidad: la extensión depende del MIME y el registro local puede haberse
 * borrado tras una vuelta incompleta de la cola, así que el camino de
 * respaldo («no está local, ¿dónde estará?») prueba las extensiones conocidas
 * antes de dar el id por perdido.
 */
export function pathsCandidatosFoto(evaluacionId: string, photoId: string): string[] {
  return ['jpg', 'mp4', 'webm', 'mov'].map((ext) => `ev/${evaluacionId}/evidencia/${photoId}.${ext}`)
}

/**
 * CONCILIACIÓN: las fotos de evidencia están **casadas a cada producto**
 * (`productos[i].photoIds` locales o `productos[i].paths` ya subidos). Se
 * identifica ANTES que los demás formatos porque un valor de conciliación también
 * encajaría en `isFotoValor` y ahí se perderían los productos.
 */
function isConciliacionValor(valor: unknown): { productos: unknown[] } | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null
  const v = valor as { productos?: unknown }
  return Array.isArray(v.productos) ? (v as { productos: unknown[] }) : null
}

function idsStrings(x: unknown): string[] {
  return Array.isArray(x) ? (x.filter((v) => typeof v === 'string') as string[]) : []
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

/** Recorre los productos de una conciliación devolviendo copias editables. */
function mapearProductos(conciliacion: { productos: unknown[] }, fn: (p: Record<string, unknown>) => Record<string, unknown>): unknown[] {
  return conciliacion.productos.map((raw) => (esObjeto(raw) ? fn({ ...raw }) : raw))
}

/** Fotografías de evidencia de un producto de conciliación (ya subidas o locales). */
function fotosDeProducto(p: Record<string, unknown>): { viejas: string[]; locales: string[] } {
  return { viejas: idsStrings(p.paths), locales: idsStrings(p.photoIds) }
}

function isFotoValor(valor: unknown): string[] | null {
  if (Array.isArray(valor)) return valor.filter((v) => typeof v === 'string') as string[]
  const v = valor as { photoIds?: string[] } | null
  if (v && Array.isArray(v.photoIds) && v.photoIds.every((x) => typeof x === 'string')) return v.photoIds
  return null
}

function isCumpleValor(valor: unknown): string[][] | null {
  const v = valor as { value?: boolean | null; evidencias?: { photoIds?: unknown; comentario?: unknown }[] } | null
  if (!v || (v.value != null && typeof v.value !== 'boolean') || !Array.isArray(v.evidencias)) return null
  return v.evidencias.map((e) => (Array.isArray(e.photoIds) ? e.photoIds.filter((x) => typeof x === 'string') : []))
}

function isPlanoValor(valor: unknown): { planos: { photoIds?: unknown }[] } | null {
  const v = valor as { planos?: unknown } | null
  if (!v || !Array.isArray(v.planos)) return null
  return v as { planos: { photoIds?: unknown }[] }
}

function isChecklistValor(valor: unknown): Record<string, string[]> | null {
  const v = valor as { selected?: string[]; evidencias?: Record<string, { photoIds?: unknown } | null> } | null
  if (!v || !Array.isArray(v.selected)) return null
  const evs = v.evidencias
  if (!evs || typeof evs !== 'object' || Array.isArray(evs)) return null
  const out: Record<string, string[]> = {}
  for (const [optId, e] of Object.entries(evs)) {
    const ids = e && Array.isArray(e.photoIds) ? e.photoIds.filter((x) => typeof x === 'string') : []
    if (ids.length) out[optId] = ids
  }
  return out
}

/**
 * Comentario por punto (id de la opción → texto).
 *
 * Viaja **dentro del valor** y no tiene nada que ver con las fotos, pero las
 * dos proyecciones de abajo (la que sube a la nube y la que quita las fotos)
 * arman el objeto campo por campo y se lo tragaban: el comentario se perdía al
 * sincronizar y el punto quedaba mudo en el informe.
 *
 * Los valores de UNIDAD_CHECKLIST y LISTA_COLABORADORES no pasan por acá (no
 * los arma ninguna de las dos proyecciones: van enteros), así que sus
 * comentarios viajan sin que haya que hacer nada.
 */
function copiarComentarios(
  v: { comentarios?: unknown },
  out: Record<string, unknown>
): void {
  if (!v.comentarios || typeof v.comentarios !== 'object' || Array.isArray(v.comentarios)) return
  if (!Object.keys(v.comentarios as Record<string, unknown>).length) return
  out.comentarios = v.comentarios
}

/**
 * Responsables elegidos y gerente de la sucursal: viajan **dentro del valor** y
 * no tienen nada que ver con las fotos.
 *
 * Las dos proyecciones de abajo (la que sube a la nube y la que quita las fotos)
 * arman el objeto campo por campo y se los tragaban. Perderlos al subir tenía
 * dos daños concretos: al reabrir la evaluación el punto volvía a la
 * **preselección** (los chips de siempre encendidos, con la selección del
 * evaluador tirada), y los reportes (PDF, Excel, indicadores) le atribuían la
 * falla al gerente en vez de a quien eligió el evaluador.
 *
 * Un `responsables: []` vacío se salta a propósito: significa "sin selección",
 * que es exactamente lo mismo que ausente para quien lo lee.
 */
function copiarResponsables(
  v: { responsables?: unknown; responsablesPorOpcion?: unknown; responsablesGerente?: unknown },
  out: Record<string, unknown>
): void {
  if (Array.isArray(v.responsables) && v.responsables.length) out.responsables = v.responsables
  if (v.responsablesPorOpcion && typeof v.responsablesPorOpcion === 'object' && !Array.isArray(v.responsablesPorOpcion)) {
    out.responsablesPorOpcion = v.responsablesPorOpcion
  }
  if (v.responsablesGerente !== undefined) out.responsablesGerente = v.responsablesGerente
}

// Proyección sin IDs de fotos locales, para consumidores que explícitamente no
// deban incluir evidencias. El auto-guardado normal las sube y guarda sus rutas.
export function valorSinFotos(valor: unknown): unknown {
  const conciliacion = isConciliacionValor(valor)
  if (conciliacion) {
    const out: Record<string, unknown> = { ...conciliacion }
    delete out.photoIds
    delete out.paths
    out.productos = mapearProductos(conciliacion, (p) => {
      delete p.photoIds
      delete p.paths
      return p
    })
    return out
  }
  const plano = isPlanoValor(valor)
  if (plano) {
    const v = valor as { planos: { id: string; nombre: string; photoIds?: string[] }[]; puntos?: unknown; informativo?: boolean; responsables?: string[]; responsablesGerente?: string | null }
    const out: Record<string, unknown> = {
      planos: v.planos.map((p) => ({ id: p.id, nombre: p.nombre, photoIds: [] })),
      puntos: v.puntos ?? []
    }
    if (v.informativo) out.informativo = true
    copiarResponsables(v, out)
    return out
  }
  const cumple = isCumpleValor(valor)
  if (cumple) {
    const v = valor as { value?: boolean | null; evidencias?: { comentario?: string }[]; informativo?: boolean; responsables?: string[]; responsablesGerente?: string | null }
    const out: Record<string, unknown> = {
      value: v.value ?? null,
      evidencias: (v.evidencias ?? []).map((e) => ({ comentario: e.comentario ?? '' }))
    }
    if (v.informativo) out.informativo = true
    copiarResponsables(v, out)
    return out
  }
  const checklist = isChecklistValor(valor)
  if (checklist) {
    const v = valor as { selected?: string[]; existe?: string[]; informativos?: string[]; valores?: Record<string, number>; evidencias?: unknown; comentarios?: Record<string, string>; responsables?: string[]; responsablesPorOpcion?: Record<string, string[]>; responsablesGerente?: string | null }
    const out: Record<string, unknown> = { selected: v.selected ?? [] }
    // Doble check: `existe` se conserva aunque venga vacío, porque su sola
    // presencia (como array) le dice al puntaje que la segunda marca es
    // obligatoria. Soltarlo convertiría una respuesta sin validaciones en puntos
    // cumplidos.
    if (Array.isArray(v.existe)) out.existe = v.existe
    if ((v.informativos ?? []).length) out.informativos = v.informativos
    if (v.valores && Object.keys(v.valores).length) out.valores = v.valores
    copiarComentarios(v, out)
    copiarResponsables(v, out)
    return out
  }
  if (isFotoValor(valor)) return { photoIds: [] }
  return valor
}

export function extraerPhotoIds(valor: unknown): string[] {
  const conciliacion = isConciliacionValor(valor)
  if (conciliacion) {
    // Las fotos pendientes de subir están casadas al producto; arriba solo puede
    // quedar alguna de una versión vieja del valor.
    const legacy = idsStrings((conciliacion as { photoIds?: unknown }).photoIds)
    const porProducto = conciliacion.productos.flatMap((raw) => (esObjeto(raw) ? idsStrings(raw.photoIds) : []))
    return Array.from(new Set([...legacy, ...porProducto]))
  }
  const plano = isPlanoValor(valor)
  if (plano) return plano.planos.flatMap((p) => (Array.isArray(p.photoIds) ? p.photoIds.filter((x) => typeof x === 'string') : []))
  const directos = isFotoValor(valor)
  if (directos) return directos
  const checklist = isChecklistValor(valor)
  if (checklist) return Object.values(checklist).flat()
  return isCumpleValor(valor)?.flat() ?? []
}

export function idsFotosRespuesta(
  respuestas: { valor: unknown }[],
  idsGuardados: string[] = []
): string[] {
  return Array.from(new Set([...idsGuardados, ...respuestas.flatMap((respuesta) => extraerPhotoIds(respuesta.valor))]))
}

export function convertirValor(valor: unknown, map: Map<string, string>): unknown {
  const conciliacion = isConciliacionValor(valor)
  if (conciliacion) {
    const out: Record<string, unknown> = { ...conciliacion }
    // Fotos de nivel valor heredadas de una versión vieja del formato: se unen
    // igual que las del producto para que no se pierdan.
    const pathsTop = Array.from(new Set([
      ...idsStrings(out.paths),
      ...idsStrings(out.photoIds).map((id) => map.get(id) ?? `.local/${id}`)
    ]))
    delete out.photoIds
    if (pathsTop.length) out.paths = pathsTop
    else delete out.paths

    // Las fotos de cada producto también solo se agregan: las ya subidas (paths)
    // se conservan y se suman las locales nuevas, así una fila reabierta desde la
    // nube no pierde la evidencia de ese SKU.
    out.productos = mapearProductos(conciliacion, (p) => {
      const { viejas, locales } = fotosDeProducto(p)
      const paths = Array.from(new Set([...viejas, ...locales.map((id) => map.get(id) ?? `.local/${id}`)]))
      delete p.photoIds
      if (paths.length) p.paths = paths
      else delete p.paths
      return p
    })
    return out
  }
  const plano = isPlanoValor(valor)
  if (plano) {
    const v = valor as { planos: { id: string; nombre: string; photoIds?: string[] }[]; puntos?: unknown; informativo?: boolean; responsables?: string[]; responsablesGerente?: string | null }
    const out: Record<string, unknown> = {
      planos: v.planos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        // La imagen del plano se sube al bucket como evidencia: al pintarle los pines
        // el evaluador carga el layout real de la sucursal, así que es su foto.
        paths: (p.photoIds ?? []).map((id) => map.get(id) ?? `.local/${id}`)
      })),
      puntos: v.puntos ?? []
    }
    if (v.informativo) out.informativo = true
    if (v.responsables?.length) out.responsables = v.responsables
    if (v.responsablesGerente !== undefined) out.responsablesGerente = v.responsablesGerente
    return out
  }
  const ids = isFotoValor(valor)
  if (ids) return { paths: ids.map((id) => map.get(id) ?? `.local/${id}`) }
  const cumpleIds = isCumpleValor(valor)
  if (cumpleIds) {
    const v = valor as { value?: boolean | null; evidencias?: { photoIds?: string[]; comentario?: string }[]; informativo?: boolean; responsables?: string[]; responsablesGerente?: string | null }
    const out: Record<string, unknown> = {
      value: v.value ?? null,
      evidencias: (v.evidencias ?? []).map((e, i) => ({
        comentario: e.comentario ?? '',
        paths: (cumpleIds[i] ?? []).map((id) => map.get(id) ?? `.local/${id}`)
      }))
    }
    if (v.informativo) out.informativo = true
    // Sin esto la fila subía sin la selección del evaluador: al reabrir, el
    // punto volvía a la preselección con todos los chips encendidos.
    copiarResponsables(v, out)
    return out
  }
  const checklistIds = isChecklistValor(valor)
  if (checklistIds) {
    const v = valor as { selected?: string[]; existe?: string[]; informativos?: string[]; valores?: Record<string, number>; evidencias?: Record<string, { photoIds?: string[] } | null>; comentarios?: Record<string, string>; responsables?: string[]; responsablesPorOpcion?: Record<string, string[]>; responsablesGerente?: string | null }
    const evidencias: Record<string, unknown> = {}
    for (const [optId, ids] of Object.entries(checklistIds)) {
      evidencias[optId] = { paths: ids.map((id) => map.get(id) ?? `.local/${id}`) }
    }
    const out: Record<string, unknown> = {
      selected: v.selected ?? [],
      evidencias
    }
    // Igual que en `valorSinFotos`: la marca de presencia del doble check viaja
    // aunque esté vacía, para no degradar la respuesta a modo check único.
    if (Array.isArray(v.existe)) out.existe = v.existe
    if ((v.informativos ?? []).length) out.informativos = v.informativos
    if (v.valores && Object.keys(v.valores).length) out.valores = v.valores
    copiarComentarios(v, out)
    copiarResponsables(v, out)
    return out
  }
  return valor
}