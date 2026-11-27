import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Modulo } from '../types'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))

const { modulosRespondidos } = await import('./indicadores')

function res(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error })
}

const modulos: Modulo[] = [
  { id: 'm3', nombre: 'Cumplimiento normativo', descripcion: '', orden: 3, activo: true, created_at: '' },
  { id: 'm1', nombre: 'Higiene y salubridad', descripcion: '', orden: 1, activo: true, created_at: '' },
  { id: 'm2', nombre: 'Atención y operaciones', descripcion: '', orden: 2, activo: true, created_at: '' }
]

/** Tandas de ids que se pidieron a `items`. Los ids llegan por `.in()`, no por `from()`. */
const idsPedidos: string[][] = []
const registrar = (_col: string, ids: string[]) => {
  idsPedidos.push(ids)
  return res(ids.map((id) => ({ id, modulo_id: 'm1' })))
}

beforeEach(() => {
  fromMock.mockReset()
  idsPedidos.length = 0
})

describe('módulos que se pueden imprimir de una evaluación', () => {
  it('devuelve solo los módulos con respuestas, en el orden del PDF', async () => {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'respuestas') return { select: () => ({ eq: () => res([{ item_id: 'it1' }, { item_id: 'it2' }]) }) }
      if (tabla === 'items') return { select: () => ({ in: (_c: string, ids: string[]) => res(ids.map((id) => ({ id, modulo_id: id === 'it1' ? 'm2' : 'm3' }))) }) }
      if (tabla === 'modulos') return { select: () => ({ in: (_c: string, ids: string[]) => res(modulos.filter((m) => ids.includes(m.id))) }) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    const lista = await modulosRespondidos('ev1')
    expect(lista.map((m) => m.id)).toEqual(['m2', 'm3'])
  })

  it('no consulta items ni módulos cuando no hay respuestas', async () => {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'respuestas') return { select: () => ({ eq: () => res([]) }) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    expect(await modulosRespondidos('ev1')).toEqual([])
    // Un catálogo vacío es el caso más común de una evaluación recién abierta.
    // Preguntar igual por los módulos sería un viaje de ida y vuelta sin respuesta.
    expect(fromMock.mock.calls.map(([tabla]) => tabla)).toEqual(['respuestas'])
  })

  it('deduplica los ids repetidos antes de preguntar', async () => {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'respuestas') return { select: () => ({ eq: () => res([{ item_id: 'it1' }, { item_id: 'it1' }, { item_id: 'it2' }]) }) }
      if (tabla === 'items') return { select: () => ({ in: registrar }) }
      if (tabla === 'modulos') return { select: () => ({ in: (_c: string, ids: string[]) => res(modulos.filter((m) => ids.includes(m.id))) }) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    await modulosRespondidos('ev1')
    expect(idsPedidos).toEqual([['it1', 'it2']])
  })

  it('parte los ids en tandas de 100 porque van en la URL', async () => {
    // Una evaluación larga pasa de los 100 ítems. Los ids viajan en el query
    // string de `.in()`, y una URL demasiado larga se corta: la consulta falla y
    // el selector se queda sin módulos, justo en el informe más largo.
    const muchas = Array.from({ length: 250 }, (_, i) => ({ item_id: `it${i}` }))
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'respuestas') return { select: () => ({ eq: () => res(muchas) }) }
      if (tabla === 'items') return { select: () => ({ in: registrar }) }
      if (tabla === 'modulos') return { select: () => ({ in: (_c: string, ids: string[]) => res(modulos.filter((m) => ids.includes(m.id))) }) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    const lista = await modulosRespondidos('ev1')
    expect(idsPedidos.map((tanda) => tanda.length)).toEqual([100, 100, 50])
    expect(lista.map((m) => m.id)).toEqual(['m1'])
  })

  it('devuelve vacío si la consulta de módulos no trae ninguno', async () => {
    // Puede pasar si el módulo se dio de baja entre que se respondió y se generó
    // el informe. Mejor un selector vacío con el aviso que una excepción.
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'respuestas') return { select: () => ({ eq: () => res([{ item_id: 'it1' }]) }) }
      if (tabla === 'items') return { select: () => ({ in: () => res([{ id: 'it1', modulo_id: 'm-fantasma' }]) }) }
      if (tabla === 'modulos') return { select: () => ({ in: () => res([]) }) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    expect(await modulosRespondidos('ev1')).toEqual([])
  })
})