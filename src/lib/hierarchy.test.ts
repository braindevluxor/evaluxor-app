import { describe, it, expect } from 'vitest'
import { itemsEnOrdenJerarquico, hijosDe } from './hierarchy'

type It = { id: string; orden: number; padre_id?: string | null }

describe('itemsEnOrdenJerarquico', () => {
  it('intercala los hijos inmediatamente después de su sección respetando el orden', () => {
    const items: It[] = [
      { id: 'sec2', orden: 4, padre_id: null },
      { id: 'hijoB', orden: 5, padre_id: 'sec2' },
      { id: 'raiz1', orden: 0, padre_id: null },
      { id: 'hijoA', orden: 3, padre_id: 'sec1' },
      { id: 'sec1', orden: 2, padre_id: null },
      { id: 'raiz3', orden: 6, padre_id: null }
    ]
    const ids = itemsEnOrdenJerarquico(items).map((i) => i.id)
    expect(ids).toEqual(['raiz1', 'sec1', 'hijoA', 'sec2', 'hijoB', 'raiz3'])
  })

  it('ordena los hermanos de una sección por su orden', () => {
    const items: It[] = [
      { id: 'sec1', orden: 0, padre_id: null },
      { id: 'h1', orden: 5, padre_id: 'sec1' },
      { id: 'h2', orden: 2, padre_id: 'sec1' }
    ]
    const ids = itemsEnOrdenJerarquico(items).map((i) => i.id)
    expect(ids).toEqual(['sec1', 'h2', 'h1'])
  })

  it('no anida segundo nivel (los hijos no vuelven a recorrer) y deja huérfanos al final', () => {
    const items: It[] = [
      { id: 'sec1', orden: 0, padre_id: null },
      { id: 'hijo', orden: 1, padre_id: 'sec1' },
      { id: 'perdido', orden: 2, padre_id: 'no-existe' },
      { id: 'raiz2', orden: 3, padre_id: null }
    ]
    const ids = itemsEnOrdenJerarquico(items).map((i) => i.id)
    expect(ids).toEqual(['sec1', 'hijo', 'raiz2', 'perdido'])
  })
})

describe('hijosDe', () => {
  it('devuelve los hijos directos de un padre', () => {
    const items: It[] = [
      { id: 'sec1', orden: 0, padre_id: null },
      { id: 'h1', orden: 1, padre_id: 'sec1' },
      { id: 'h2', orden: 2, padre_id: 'sec1' },
      { id: 'raiz', orden: 3, padre_id: null }
    ]
    expect(hijosDe(items, 'sec1').map((i) => i.id).sort()).toEqual(['h1', 'h2'])
    expect(hijosDe(items, 'raiz')).toEqual([])
  })
})