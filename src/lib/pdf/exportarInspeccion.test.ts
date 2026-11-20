import { describe, expect, it, vi } from 'vitest'
import type { Item, Opcion } from '../types'

/**
 * `filasParaPdf`: el checklist de una INSPECCIÓN DE VEHÍCULO (y de la
 * Revisión Pre-Entrega, que comparte el mismo builder) a las filas de la
 * tabla del PDF.
 *
 * El bug que cubre: los COMENTARIOS por punto se escriben en la misma fila
 * del punto y se guardan en `valor.comentarios`, pero el builder los
 * ignoraba en los CHECKLIST — el informe salía con los estados y sin una
 * sola nota.
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
  it('agrega la fila «· Nota» con el comentario de cada punto', () => {
    const filas = filasParaPdf([itemChecklist('Documentación')], {
      i1: { selected: ['o1'], comentarios: { o2: 'Vence en diciembre' } }
    })

    const nota = filas.find((f) => f.etiqueta === 'Documentación · Nota')
    expect(nota, 'falta la fila con el comentario').toBeDefined()
    expect(nota!.valor).toBe('Revisión vigente: Vence en diciembre')

    // Las filas de estado siguen intactas y en el mismo orden.
    expect(filas.map((f) => f.etiqueta)).toEqual([
      'Documentación · SOAT vigente',
      'Documentación · Revisión vigente',
      'Documentación · Nota'
    ])
    expect(filas[0].valor).toBe('Cumple')
    expect(filas[1].valor).toBe('No cumple')
  })

  it('sin comentarios no aparece la fila de nota', () => {
    // Una fila de «Nota» vacía es ruido en el papel.
    const filas = filasParaPdf([itemChecklist('Documentación')], { i1: { selected: ['o1'] } })
    expect(filas.some((f) => f.etiqueta.endsWith('· Nota'))).toBe(false)
  })

  it('el dictamen CUMPLE_NO_CUMPLE sigue llevando su veredicto', () => {
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
    expect(filas.find((f) => f.etiqueta === '¿Se entrega? · Nota')?.valor).toBe('Falta SOAT')
  })

  it('la fila de nota queda dentro de la sección del ítem', () => {
    const filas = filasParaPdf([itemChecklist('Documentación')], {
      i1: { selected: [], comentarios: { o1: 'Sin novedades' } }
    })
    expect(filas.every((f) => f.grupo === 'Dictamen')).toBe(true)
  })
})
