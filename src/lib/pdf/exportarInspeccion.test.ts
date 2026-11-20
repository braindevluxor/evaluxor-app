import { describe, expect, it, vi } from 'vitest'
import type { Item, Opcion } from '../types'

/**
 * `filasParaPdf`: el checklist de una INSPECCIÓN DE VEHÍCULO (y de la
 * Revisión Pre-Entrega, que comparte el mismo builder) a las filas de la
 * tabla del PDF.
 *
 * Lo que cubre: los COMENTARIOS por punto van en SU fila, en la columna
 * Observación —antes se juntaban todos en una sola fila «· Nota» con todos
 * adentro, ilegible y despegado de su punto.
 *
 * Se mockean los tres módulos que tocan red o IndexedDB: `filasParaPdf` es
 * puro, pero vive en un archivo que también exporta la máquina entera.
 */
vi.mock('../offline/db', () => ({ getPhotos: vi.fn(), putPreEntrega: vi.fn() }))
vi.mock('../offline/syncPreEntrega', () => ({ subirRevisionPreEntrega: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: {} }))

const { filasParaPdf } = await import('./exportarInspeccion')

const OPCIONES: Opcion[] = [
  { id: 'o1', etiqueta: 'SOAT vigente' },
  { id: 'o2', etiqueta: 'Revisión vigente' }
]

function itemChecklist(texto: string): Item {
  return {
    id: 'i1',
    modulo_id: 'm1',
    tipo: 'CHECKLIST',
    texto,
    opciones: OPCIONES,
    orden: 0,
    requerido: false,
    activo: true,
    created_at: ''
  }
}

describe('filasParaPdf · los comentarios de los puntos', () => {
  it('cada punto lleva SU observación en SU fila, sin fila «· Nota»', () => {
    const filas = filasParaPdf([itemChecklist('Documentación')], {
      i1: { selected: ['o1'], comentarios: { o2: 'Vence en diciembre' } }
    })

    // Tres puntos, tres filas: la observación del punto va EN su fila y no
    // en una nota aparte que junta todas.
    expect(filas.map((f) => f.etiqueta)).toEqual([
      'Documentación · SOAT vigente',
      'Documentación · Revisión vigente'
    ])
    expect(filas[0].observacion).toBeNull()
    expect(filas[1].observacion).toBe('Vence en diciembre')

    // Las filas de estado siguen intactas y en el mismo orden.
    expect(filas[0].valor).toBe('Cumple')
    expect(filas[1].valor).toBe('No cumple')
  })

  it('sin comentarios no hay observación en ninguna fila', () => {
    // Una columna de guiones en todas las filas es ruido en el papel, pero
    // la columna existe: lo que no puede haber es un comentario inventado.
    const filas = filasParaPdf([itemChecklist('Documentación')], { i1: { selected: ['o1'] } })
    expect(filas.every((f) => f.observacion == null)).toBe(true)
  })

  it('el dictamen CUMPLE_NO_CUMPLE pone su comentario en SU fila', () => {
    const item: Item = {
      id: 'i2',
      modulo_id: 'm1',
      tipo: 'CUMPLE_NO_CUMPLE',
      texto: '¿Se entrega?',
      opciones: null,
      orden: 1,
      requerido: false,
      activo: true,
      created_at: ''
    }
    const filas = filasParaPdf([item], {
      i2: { value: false, evidencias: [{ photoIds: [], comentario: 'Falta SOAT' }] }
    })
    const fila = filas.find((f) => f.etiqueta === '¿Se entrega? · Estado')
    expect(fila?.valor).toBe('No cumple')
    expect(fila?.observacion).toBe('Falta SOAT')
    expect(filas.some((f) => f.etiqueta.endsWith('· Nota'))).toBe(false)
  })

  it('la fila queda dentro de la sección del ítem', () => {
    const filas = filasParaPdf([itemChecklist('Documentación')], {
      i1: { selected: [], comentarios: { o1: 'Sin novedades' } }
    })
    expect(filas.every((f) => f.grupo === 'Dictamen')).toBe(true)
  })
})
