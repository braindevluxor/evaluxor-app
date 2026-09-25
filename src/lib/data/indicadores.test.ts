import { describe, expect, it } from 'vitest'
import type { Item, Modulo, Respuesta, Sucursal } from '../types'
import { puntajePorSucursalModulo, type ConjuntoDatos } from './indicadores'

const sucursales: Sucursal[] = [
  { id: 's1', nombre: 'Sucursal Norte', shop_id: null, branch_id: null, direccion: null, gerente_id: null, activa: true, created_at: '' },
  { id: 's2', nombre: 'Sucursal Sur', shop_id: null, branch_id: null, direccion: null, gerente_id: null, activa: true, created_at: '' }
]

const modulos: Modulo[] = ['m1', 'm2', 'm3'].map((id, orden) => ({
  id,
  nombre: `Módulo ${orden + 1}`,
  descripcion: '',
  orden,
  activo: true,
  created_at: ''
}))

const items: Item[] = modulos.map((modulo, orden) => ({
  id: `i${orden + 1}`,
  modulo_id: modulo.id,
  tipo: 'CUMPLE_NO_CUMPLE',
  texto: `Ítem ${orden + 1}`,
  opciones: [],
  orden,
  requerido: false,
  activo: true,
  puntaje: 100,
  created_at: ''
}))

const evaluaciones = sucursales.map((sucursal, orden) => ({
  id: `ev${orden + 1}`,
  offline_uuid: `offline-${orden + 1}`,
  sucursal_id: sucursal.id,
  aperturada_por: 'user-test',
  fecha: '2026-09-01',
  estado: 'CERRADA' as const,
  puntuacion: null,
  comentario_general: null,
  abierta_en: null,
  cerrada_en: null,
  created_at: '',
  sucursal: { id: sucursal.id, nombre: sucursal.nombre, shop_id: null, branch_id: null, direccion: null },
  aperturador: null
}))

function respuesta(evaluacionId: string, itemId: string, cumple: boolean): Respuesta {
  return {
    id: `${evaluacionId}-${itemId}`,
    evaluacion_id: evaluacionId,
    item_id: itemId,
    instancia_id: null,
    valor: { value: cumple },
    respondido_por: null,
    created_at: ''
  }
}

describe('puntajePorSucursalModulo', () => {
  it('calcula todos los módulos asignados y deja sin puntaje los no asignados', () => {
    const respuestas = [
      respuesta('ev1', 'i1', true),
      respuesta('ev1', 'i2', false),
      respuesta('ev1', 'i3', true),
      respuesta('ev2', 'i1', false),
      respuesta('ev2', 'i3', true)
    ]
    const datos = {
      evaluaciones,
      respuestas,
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = puntajePorSucursalModulo(datos, sucursales)

    expect(resultado.modulos.map((modulo) => modulo.nombre)).toEqual(['Módulo 1', 'Módulo 2', 'Módulo 3'])
    expect(resultado.sucursales[0].porModulo).toEqual({ 'Módulo 1': 100, 'Módulo 2': 0, 'Módulo 3': 100 })
    expect(resultado.sucursales[1].porModulo).toEqual({ 'Módulo 1': 0, 'Módulo 2': null, 'Módulo 3': 100 })
  })
})