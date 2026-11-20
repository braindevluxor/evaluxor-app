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
      { etiqueta: 'SOAT vigente', valor: 'Cumple', observacion: null },
      { etiqueta: 'Revisión vigente', valor: 'No cumple', observacion: null },
      { etiqueta: 'Presión de llantas', valor: 'No cumple', observacion: null }
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
    expect(r.filas[1]).toEqual({ etiqueta: 'Revisión vigente', valor: 'Informativo', observacion: null })
  })

  it('un RANGO cumple al alcanzar el mínimo y muestra el valor medido', () => {
    const cumple = resolverPregunta(
      item({ tipo: 'CHECKLIST', texto: 'X', opciones }),
      { selected: [], valores: { o3: 32 } }
    )
    expect(cumple.filas[2]).toEqual({
      etiqueta: 'Presión de llantas',
      valor: 'Cumple (32 psi)',
      observacion: null
    })

    const noCumple = resolverPregunta(
      item({ tipo: 'CHECKLIST', texto: 'X', opciones }),
      { selected: [], valores: { o3: 28 } }
    )
    expect(noCumple.filas[2].valor).toBe('No cumple (28 psi)')
  })

  it('los COMENTARIOS de cada punto van en SU fila, en la columna Observación', () => {
    // El evaluador los escribe en la fila del punto y quedan en
    // `valor.comentarios`; antes todos se juntaban en una sola fila «· Nota»
    // con todos adentro (el bug de «los comentarios en una sola fila»).
    const r = resolverPregunta(
      item({ tipo: 'CHECKLIST', texto: 'Documentación', opciones }),
      {
        selected: ['o1'],
        comentarios: { o3: 'Falta la delantera', o2: 'Vence en diciembre' }
      }
    )
    // Cada punto con el SUYO, en la fila que le corresponde…
    expect(r.filas[0].observacion).toBeNull()
    expect(r.filas[1].observacion).toBe('Vence en diciembre')
    expect(r.filas[2].observacion).toBe('Falta la delantera')
    // …y SIN la fila de nota aparte: tres puntos, tres filas.
    expect(r.filas).toHaveLength(3)
  })

  it('sin comentarios las observaciones quedan vacías: no se inventa una nota', () => {
    const r = resolverPregunta(item({ tipo: 'CHECKLIST', texto: 'X', opciones }), { selected: ['o1'] })
    expect(r.filas.every((f) => f.observacion == null)).toBe(true)
    expect(
      resolverPregunta(item({ tipo: 'CHECKLIST', texto: 'X', opciones }), {
        selected: ['o1'],
        comentarios: { o1: '   ' }
      }).filas[0].observacion
    ).toBeNull()
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
    expect(r.filas).toEqual([
      { etiqueta: 'Estado', valor: 'No cumple', observacion: 'Falta SOAT' }
    ])
  })

  it('sin responder deja el estado vacío', () => {
    const r = resolverPregunta(item({ tipo: 'CUMPLE_NO_CUMPLE', texto: 'X' }), null)
    expect(r.filas[0].valor).toBe('—')
  })
})

describe('resolverPregunta · tipos ajenos a la herramienta', () => {
  it('no pierde la pregunta: la lista como "No aplica"', () => {
    const r = resolverPregunta(item({ tipo: 'CONCILIACION', texto: 'Conteo' }), undefined)
    expect(r.filas).toEqual([
      { etiqueta: 'Detalle', valor: 'No aplica a esta herramienta', observacion: null }
    ])
  })
})
