import { describe, expect, it } from 'vitest'
import { resolverPregunta, opcionCumplida } from './preguntasRevision'
import type { Item, Opcion } from '../types'

function item(parcial: Partial<Item> & Pick<Item, 'tipo' | 'texto'>): Item {
  return {
    id: 'i1',
    modulo_id: 'm1',
    opciones: null,
    orden: 0,
    requerido: false,
    activo: true,
    created_at: '',
    ...parcial
  }
}

const opciones: Opcion[] = [
  { id: 'o1', etiqueta: 'SOAT vigente' },
  { id: 'o2', etiqueta: 'Revisión vigente' },
  { id: 'o3', etiqueta: 'Presión de llantas', tipo_respuesta: 'RANGO', minimo: 30, unidad: 'psi' }
]

describe('resolverPregunta · CHECKLIST', () => {
  it('marca Cumple y No cumple según lo seleccionado', () => {
    const r = resolverPregunta(
      item({ tipo: 'CHECKLIST', texto: 'Documentación', opciones }),
      { selected: ['o1'] }
    )
    expect(r.filas).toEqual([
      { etiqueta: 'SOAT vigente', valor: 'Cumple' },
      { etiqueta: 'Revisión vigente', valor: 'No cumple' },
      { etiqueta: 'Presión de llantas', valor: 'No cumple' }
    ])
  })

  it('sin respuesta deja todo como No cumple (no inventa un "cumple")', () => {
    const r = resolverPregunta(item({ tipo: 'CHECKLIST', texto: 'X', opciones }), undefined)
    expect(r.filas.every((f) => f.valor === 'No cumple')).toBe(true)
  })

  it('los puntos informativos no cuentan como falla', () => {
    const r = resolverPregunta(
      item({ tipo: 'CHECKLIST', texto: 'X', opciones }),
      { selected: ['o1'], informativos: ['o2'] }
    )
    expect(r.filas[1]).toEqual({ etiqueta: 'Revisión vigente', valor: 'Informativo' })
  })

  it('un RANGO cumple al alcanzar el mínimo y muestra el valor medido', () => {
    const cumple = resolverPregunta(
      item({ tipo: 'CHECKLIST', texto: 'X', opciones }),
      { selected: [], valores: { o3: 32 } }
    )
    expect(cumple.filas[2]).toEqual({ etiqueta: 'Presión de llantas', valor: 'Cumple (32 psi)' })

    const noCumple = resolverPregunta(
      item({ tipo: 'CHECKLIST', texto: 'X', opciones }),
      { selected: [], valores: { o3: 28 } }
    )
    expect(noCumple.filas[2].valor).toBe('No cumple (28 psi)')
  })
})

describe('opcionCumplida', () => {
  it('sin mínimo configurado cualquier valor del rango cumple', () => {
    expect(opcionCumplida({ id: 'r', etiqueta: 'r', tipo_respuesta: 'RANGO' }, { selected: [], valores: { r: 1 } })).toBe(true)
  })
})

describe('resolverPregunta · CUMPLE_NO_CUMPLE', () => {
  it('traduce el dictamen y adjunta los comentarios de evidencia', () => {
    const r = resolverPregunta(
      item({ tipo: 'CUMPLE_NO_CUMPLE', texto: '¿Se entrega?' }),
      { value: false, evidencias: [{ photoIds: [], comentario: 'Falta SOAT' }, { photoIds: [], comentario: ' ' }] }
    )
    expect(r.filas).toEqual([{ etiqueta: 'Estado', valor: 'No cumple' }])
    expect(r.veredicto).toBe('Falta SOAT')
  })

  it('sin responder deja el estado vacío', () => {
    const r = resolverPregunta(item({ tipo: 'CUMPLE_NO_CUMPLE', texto: 'X' }), null)
    expect(r.filas[0].valor).toBe('—')
  })
})

describe('resolverPregunta · tipos ajenos a la herramienta', () => {
  it('no pierde la pregunta: la lista como "No aplica"', () => {
    const r = resolverPregunta(item({ tipo: 'CONCILIACION', texto: 'Conteo' }), undefined)
    expect(r.filas).toEqual([{ etiqueta: 'Detalle', valor: 'No aplica a esta herramienta' }])
  })
})
