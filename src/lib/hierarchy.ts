/**
 * Orden jerárquico de ítems dentro de un módulo: los ítems con `padre_id`
 * (hijos de una sección CONTENEDOR) se intercalan inmediatamente después de
 * su contenedor, manteniendo el orden por `orden` en cada nivel.
 * Soporta un solo nivel de anidación (los hijos nunca se vuelven a recorrer).
 */
export function itemsEnOrdenJerarquico<T extends { id: string; orden: number; padre_id?: string | null }>(items: T[]): T[] {
  const ordenados = [...items].sort((a, b) => a.orden - b.orden)
  const ids = new Set(ordenados.map((i) => i.id))
  const hijos = new Map<string, T[]>()
  const huerfanos: T[] = []
  for (const i of ordenados) {
    if (i.padre_id && ids.has(i.padre_id)) {
      const arr = hijos.get(i.padre_id) ?? []
      arr.push(i)
      hijos.set(i.padre_id, arr)
    } else if (i.padre_id) {
      huerfanos.push(i)
    }
  }
  const out: T[] = []
  for (const i of ordenados) {
    if (i.padre_id) continue
    out.push(i)
    const hs = hijos.get(i.id)
    if (hs) out.push(...hs)
  }
  out.push(...huerfanos)
  return out
}

/** Ids de los ítems hijos que dependen directamente de un ítem padre. */
export function hijosDe<T extends { id: string; padre_id?: string | null }>(items: T[], padreId: string): T[] {
  return items.filter((i) => i.padre_id === padreId)
}

/** Lista aplanada en orden jerárquico de los ítems que se responden en la evaluación (excluye las secciones CONTENEDOR). */
export function itemsRespondibles<T extends { id: string; orden: number; padre_id?: string | null; tipo: string }>(items: T[]): T[] {
  return itemsEnOrdenJerarquico(items).filter((i) => i.tipo !== 'CONTENEDOR')
}

/** Hijos de una sección en orden de evaluación. */
export function hijosOrdenados<T extends { id: string; orden: number; padre_id?: string | null }>(items: T[], padreId: string): T[] {
  return items.filter((i) => i.padre_id === padreId).sort((a, b) => a.orden - b.orden)
}