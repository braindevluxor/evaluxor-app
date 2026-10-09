import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { getCache, getDB, normalizarCache, respuestasConInstancia, type CacheData, type DraftEval } from './db'
import { claveRespuesta } from '../pasos'

describe('respuestasConInstancia', () => {
  it('excluye respuestas fusionadas de otros evaluadores (por: otros) y conserva claves por registro', () => {
    const draft: DraftEval = {
      unidad_id: 's1',
      evaluador_id: 'e1',
      fecha: '2026-09-27',
      comentario_general: '',
      puntuacion: null,
      respuestas: {
        [claveRespuesta('itemA')]: { valor: { selected: ['x'] } },
        [claveRespuesta('itemB', 'ins1')]: { valor: { selected: ['y'] }, por: 'yo' },
        [claveRespuesta('itemC', 'ins1')]: { valor: { selected: ['z'] }, por: 'otros' }
      },
      instancias: {},
      updated_at: 0
    }
    expect(respuestasConInstancia(draft)).toEqual([
      { item_id: 'itemA', instancia_id: null, valor: { selected: ['x'] } },
      { item_id: 'itemB', instancia_id: 'ins1', valor: { selected: ['y'] } }
    ])
  })
})

describe('normalizarCache', () => {
  it('rellena con listas vacías los campos que falten, como en la caché de otra versión', () => {
    const vieja = normalizarCache({ modulos: [], items: [], updated_at: 1700000000000 })
    expect(vieja.sucursales).toEqual([])
    expect(vieja.asignaciones).toEqual([])
    expect(vieja.asignacionesModulos).toEqual([])
    expect(vieja.sucursalModulos).toEqual([])
    expect(vieja.sucursalItems).toEqual([])
    expect(vieja.sucursalOpciones).toEqual([])
    expect(vieja.updated_at).toBe(1700000000000)
  })

  it('conserva los datos que sí vienen y descarta los que no son listas', () => {
    const c = normalizarCache({ sucursales: [{ id: 's1', nombre: 'Centro' }], modulos: 'no-es-una-lista', updated_at: 'ayer' })
    expect(c.sucursales).toHaveLength(1)
    expect(c.sucursales[0].id).toBe('s1')
    expect(c.modulos).toEqual([])
    expect(c.updated_at).toBe(0)
  })

  it('no lanza con un registro corrupto', () => {
    expect(normalizarCache(null).sucursales).toEqual([])
    expect(normalizarCache('corrupto').items).toEqual([])
    expect(normalizarCache(undefined).updated_at).toBe(0)
  })
})

describe('getCache', () => {
  it('devuelve una caché completa aunque el registro guardado venga incompleto', async () => {
    const db = await getDB()
    // Registro como el que podía dejar una versión vieja de la app: sin sucursales.
    await db.put('cache', { modulos: [], items: [], updated_at: 123 } as unknown as CacheData, 'data')
    const c = await getCache()
    expect(c?.sucursales).toEqual([])
    expect(c?.asignaciones).toEqual([])
    expect(c?.updated_at).toBe(123)
  })
})
