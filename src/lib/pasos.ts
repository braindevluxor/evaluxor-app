import type { Item } from './types'
import { itemsEnOrdenJerarquico, hijosOrdenados } from './hierarchy'

/** Clave de una respuesta en el borrador/nube: `${item_id}::${instancia_id ?? ''}` (registro de sección, o vacío si es un ítem directo). */
export function claveRespuesta(itemId: string, instanciaId?: string | null): string {
  return `${itemId}::${instanciaId ?? ''}`
}

export interface InstanciaPlana {
  id: string
  item_id: string
  orden: number
}

/** Un "paso" a responder en la evaluación: un ítem directo o un ítem hijo de una sección dentro de un registro (instancia). */
export interface PasoEval {
  item: Item
  /** Clave de la respuesta en el borrador. */
  key: string
  instancia_id: string | null
  /** Sección (CONTENEDOR) dueña del registro, si aplica. */
  seccion: Item | null
  /** Índice global dentro del módulo. */
  orden: number
}

/**
 * Pasos a responder de un módulo:
 * - ítems raíz (sin sección) → un paso directo.
 * - cada sección CONTENEDOR → un paso por cada ítem hijo × cada registro (instancia) creado.
 */
export function pasosDeModulo(items: Item[], instancias: InstanciaPlana[]): PasoEval[] {
  const raices = itemsEnOrdenJerarquico(items).filter((i) => !i.padre_id)
  const porSeccion = new Map<string, InstanciaPlana[]>()
  for (const ins of instancias) {
    const arr = porSeccion.get(ins.item_id) ?? []
    arr.push(ins)
    porSeccion.set(ins.item_id, arr)
  }
  for (const arr of porSeccion.values()) arr.sort((a, b) => a.orden - b.orden)

  const out: PasoEval[] = []
  for (const raiz of raices) {
    if (raiz.tipo === 'CONTENEDOR') {
      for (const ins of porSeccion.get(raiz.id) ?? []) {
        for (const hijo of hijosOrdenados(items, raiz.id)) {
          out.push({ item: hijo, key: claveRespuesta(hijo.id, ins.id), instancia_id: ins.id, seccion: raiz, orden: out.length })
        }
      }
    } else {
      out.push({ item: raiz, key: claveRespuesta(raiz.id), instancia_id: null, seccion: null, orden: out.length })
    }
  }
  return out
}

/** Ítems raíz (secciones y ítems sueltos) de un módulo, en orden jerárquico. */
export function raicesDeModulo<T extends { id: string; orden: number; padre_id?: string | null; tipo: string }>(items: T[]): T[] {
  return itemsEnOrdenJerarquico(items).filter((i) => !i.padre_id)
}