import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guardarBorradorNube } from './sync'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

/** Respuesta de Supabase como promesa, con lo mínimo que usa el puente. */
function res(data: unknown, error: unknown = null) {
  return { then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data, error })) }
}

const FK_ITEM = {
  code: '23503',
  message: 'insert or update on table "respuestas" violates foreign key constraint "respuestas_item_id_fkey"',
  details: ''
}

const EV = 'ev-1'
const USUARIO = 'usr-1'

const respuesta = (item_id: string, valor: unknown = 'sí') => ({ item_id, instancia_id: null, valor })
const instancia = (id: string, item_id: string) => ({ id, item_id, etiqueta: `Fila ${id}`, orden: 1 })

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

/** Simula el catálogo: `vivos` son los ítems que siguen existiendo. */
function catalogo(vivos: string[]) {
  fromMock.mockImplementation((tabla: string) => {
    if (tabla === 'items') {
      return { select: () => ({ in: (_col: string, ids: string[]) => res(ids.filter((i) => vivos.includes(i)).map((id) => ({ id }))) }) }
    }
    if (tabla === 'instancias_grupo') {
      return { upsert: () => res(null, null) }
    }
    throw new Error(`tabla inesperada: ${tabla}`)
  })
}

/** Filas del ÚLTIMO intento: el que importa es el que el servidor aceptó. */
function filasEnviadas(): { item_id: string; valor: unknown }[] {
  const llamadas = rpcMock.mock.calls.filter(([nombre]) => nombre === 'upsert_respuestas')
  const ultima = llamadas[llamadas.length - 1]
  return (ultima?.[1] as { rows: { item_id: string; valor: unknown }[] }).rows
}

describe('subida con ítems borrados del catálogo', () => {
  it('sube todo y no descarta nada cuando el catálogo está completo', async () => {
    catalogo(['i1', 'i2'])
    rpcMock.mockResolvedValue({ data: null, error: null })

    const r = await guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])

    expect(r.item_ids).toEqual([])
    expect(filasEnviadas().map((f) => f.item_id)).toEqual(['i1', 'i2'])
  })

  it('el 23503 de respuestas no bloquea el resto del avance', async () => {
    // i1 sigue en la plantilla; i2 se borró al editar el cuestionario.
    catalogo(['i1'])
    rpcMock.mockResolvedValueOnce({ data: null, error: FK_ITEM }).mockResolvedValueOnce({ data: null, error: null })

    const r = await guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])

    expect(r.item_ids).toEqual(['i2'])
    // El reintento lleva solo lo vigente: es lo que antes se quedaba trabado.
    expect(rpcMock.mock.calls.filter(([n]) => n === 'upsert_respuestas')).toHaveLength(2)
    expect(filasEnviadas().map((f) => f.item_id)).toEqual(['i1'])
    expect(filasEnviadas()[0].valor).toBe('sí')
  })

  it('filtra también los registros del ítem borrado, que fallan antes que las respuestas', async () => {
    // Las instancias se suben primero (FK): si no se filtraran, el lote moría
    // ahí y la recuperación de respuestas nunca llegaba a correr.
    catalogo(['i1'])
    const subida: string[][] = []
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'items') return { select: () => ({ in: (_c: string, ids: string[]) => res(ids.filter((i) => i === 'i1').map((id) => ({ id }))) }) }
      if (tabla === 'instancias_grupo') {
        return {
          upsert: (filas: { item_id: string }[]) => {
            if (filas.some((f) => f.item_id === 'i2')) {
              return res(null, { code: '23503', message: 'violates foreign key constraint "instancias_grupo_item_id_fkey"' })
            }
            subida.push(filas.map((f) => f.item_id))
            return res(null, null)
          }
        }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    rpcMock.mockResolvedValue({ data: null, error: null })

    const r = await guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')], [instancia('a', 'i1'), instancia('b', 'i2')])

    expect(r.item_ids).toEqual(['i2'])
    expect(subida).toEqual([['i1']])
  })

  it('propaga el error si no se puede consultar el catálogo, antes que descartar de más', async () => {
    fromMock.mockImplementation((tabla: string) => {
      if (tabla === 'items') return { select: () => ({ in: () => res(null, { message: 'timeout' }) }) }
      if (tabla === 'instancias_grupo') return { upsert: () => res(null, null) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    rpcMock.mockResolvedValue({ data: null, error: FK_ITEM })

    await expect(guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])).rejects.toThrow(/violates foreign key/i)
    expect(rpcMock.mock.calls.filter(([n]) => n === 'upsert_respuestas')).toHaveLength(1)
  })

  it('no reintenta en loop si el 23503 no venía de un ítem', async () => {
    // Todos los ítems existen: la FK rota es otra (evaluación o registro). El
    // filtro no saca nada, así que el error se propaga tal cual.
    catalogo(['i1', 'i2'])
    rpcMock.mockResolvedValue({ data: null, error: FK_ITEM })

    await expect(guardarBorradorNube(EV, USUARIO, [respuesta('i1'), respuesta('i2')])).rejects.toThrow(/violates foreign key/i)
    expect(rpcMock.mock.calls.filter(([n]) => n === 'upsert_respuestas')).toHaveLength(1)
  })

  it('el error que propaga queda clasificado como ítem borrado, no como conexión', async () => {
    catalogo(['i1', 'i2'])
    rpcMock.mockResolvedValue({ data: null, error: FK_ITEM })

    await expect(guardarBorradorNube(EV, USUARIO, [respuesta('i1')])).rejects.toMatchObject({ causa: 'item_borrado' })
  })
})

describe('la pantalla no promete lo que un ítem borrado no puede dar', () => {
  const pagina = () => fuente('../../pages/evaluar/EvaluarSucursal.tsx')

  it('no arma el intervalo de reintento cuando la causa no se reintenta', () => {
    // `cadaMs` es 0 para `item_borrado`: sin este guardia el `setInterval`
    // disparaba sin pausa contra un rechazo que nunca va a pasar.
    expect(pagina()).toMatch(/if \(!mensajeSubida\(fallaSubida\.causa\)\.reintentar\) return/)
  })

  it('esconde el botón de reintentar y el "se reintenta cada X s" cuando no aplica', () => {
    const p = pagina()
    const reintenta = p.match(/mensajeSubida\(fallaSubida\.causa\)\.reintentar \? \(([\s\S]{0,600}?)\) : null/g) ?? []
    expect(reintenta.length).toBeGreaterThanOrEqual(2)
  })

  it('avisa qué respuestas no subiendo, con la etiqueta del ítem y no el UUID', () => {
    const p = pagina()
    expect(p).toContain('no se pudo subir')
    expect(p).toContain('etiquetaDeItem.get(id)')
  })
})