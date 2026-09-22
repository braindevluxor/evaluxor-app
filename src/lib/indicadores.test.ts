import { describe, it, expect } from 'vitest'
import { puntajePorModulo, type ConjuntoDatos } from './data/indicadores'

const datos: ConjuntoDatos = {
  evaluaciones: [{
    id: 'e1', offline_uuid: 'x', sucursal_id: 's1', evaluador_id: 'u1',
    fecha: '2026-01-01', puntuacion: 90, comentario_general: null, completed_at: '2026-01-01T00:00:00'
  }],
  modulos: [
    { id: 'm1', nombre: 'Módulo 1', descripcion: '', orden: 1, activo: true, created_at: '' },
    { id: 'm2', nombre: 'Módulo 2', descripcion: '', orden: 2, activo: true, created_at: '' }
  ],
  items: [
    { id: 'i1', modulo_id: 'm1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'a', opciones: null, orden: 1, requerido: true, activo: true, created_at: '' },
    { id: 'i2', modulo_id: 'm1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'b', opciones: null, orden: 2, requerido: true, activo: true, created_at: '' },
    { id: 'i3', modulo_id: 'm2', tipo: 'CUMPLE_NO_CUMPLE', texto: 'c', opciones: null, orden: 1, requerido: true, activo: true, created_at: '' },
    { id: 'i4', modulo_id: 'm2', tipo: 'CUMPLE_NO_CUMPLE', texto: 'd', opciones: null, orden: 2, requerido: true, activo: true, created_at: '' }
  ],
  respuestas: [
    { id: 'r1', evaluacion_id: 'e1', item_id: 'i1', valor: { value: true }, created_at: '' },
    { id: 'r2', evaluacion_id: 'e1', item_id: 'i2', valor: { value: true }, created_at: '' },
    { id: 'r3', evaluacion_id: 'e1', item_id: 'i3', valor: { value: true }, created_at: '' },
    { id: 'r4', evaluacion_id: 'e1', item_id: 'i4', valor: { value: false }, created_at: '' }
  ],
  fotos: []
}

describe('puntajePorModulo', () => {
  it('calcula el cumplimiento por módulo y no el puntaje general', () => {
    const porModulo = puntajePorModulo(datos)
    const m1 = porModulo.find((m) => m.modulo_id === 'm1')
    const m2 = porModulo.find((m) => m.modulo_id === 'm2')
    expect(m1?.puntaje).toBe(100)
    expect(m2?.puntaje).toBe(50)
    expect(m1?.evaluaciones).toBe(1)
    expect(m2?.evaluaciones).toBe(1)
  })

  it('ignora índices no binarios en el módulo', () => {
    const conCualitativo: ConjuntoDatos = {
      ...datos,
      items: [
        ...datos.items,
        { id: 'i5', modulo_id: 'm2', tipo: 'COMENTARIO', texto: 'nota', opciones: null, orden: 3, requerido: false, activo: true, created_at: '' }
      ],
      respuestas: [
        ...datos.respuestas,
        { id: 'r5', evaluacion_id: 'e1', item_id: 'i5', valor: 'sin lleno', created_at: '' }
      ]
    }
    const porModulo = puntajePorModulo(conCualitativo)
    const m2 = porModulo.find((m) => m.modulo_id === 'm2')
    expect(m2?.puntaje).toBe(50)
  })
})