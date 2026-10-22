import { describe, it, expect } from 'vitest'
import { claveRespuesta, pasosDeModulo, raicesDeModulo } from './pasos'
import type { Item } from './types'

const sec = (id: string, texto: string, orden: number): Item => ({
  id, modulo_id: 'm1', tipo: 'CONTENEDOR', texto, opciones: null, orden, requerido: false, activo: true, created_at: ''
})
const itm = (id: string, texto: string, orden: number, padre_id?: string | null): Item => ({
  id, modulo_id: 'm1', tipo: 'CUMPLE_NO_CUMPLE', texto, opciones: null, orden, requerido: true, activo: true, padre_id, created_at: ''
})

const items: Item[] = [
  itm('raiz1', 'Ítem directo 1', 1),
  sec('sec1', 'Vehículos', 2),
  itm('h1', 'Luces', 1, 'sec1'),
  itm('h2', 'Frenos', 2, 'sec1'),
  itm('raiz2', 'Ítem directo 2', 3)
]

describe('pasosDeModulo (secciones repetibles)', () => {
  it('intercala hijos × registros después de su sección, en orden jerárquico', () => {
    const instancias = [
      { id: 'ins1', item_id: 'sec1', orden: 0 },
      { id: 'ins2', item_id: 'sec1', orden: 1 }
    ]
    const pasos = pasosDeModulo(items, instancias)
    expect(pasos.map((p) => `${p.item.id}${p.instancia_id ? `::${p.instancia_id}` : ''}`)).toEqual([
      'raiz1',
      'h1::ins1',
      'h2::ins1',
      'h1::ins2',
      'h2::ins2',
      'raiz2'
    ])
    expect(pasos[1].key).toBe(claveRespuesta('h1', 'ins1'))
    expect(pasos[1].seccion?.id).toBe('sec1')
    expect(pasos[0].instancia_id).toBeNull()
  })

  it('sin registros una sección no genera pasos', () => {
    expect(pasosDeModulo(items, []).map((p) => p.item.id)).toEqual(['raiz1', 'raiz2'])
  })
})

describe('raicesDeModulo / claveRespuesta', () => {
  it('las raíces conservan el orden jerárquico (secciones y ítems sueltos)', () => {
    expect(raicesDeModulo(items).map((i) => i.id)).toEqual(['raiz1', 'sec1', 'raiz2'])
  })

  it('claveRespuesta distingue ítem directo de registro', () => {
    expect(claveRespuesta('a')).toBe('a::')
    expect(claveRespuesta('a', 'ins1')).toBe('a::ins1')
    expect(claveRespuesta('a', null)).toBe('a::')
  })
})