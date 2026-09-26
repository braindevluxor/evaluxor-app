import { describe, expect, it } from 'vitest'
import type { Item, Modulo, Respuesta, Sucursal, SucursalModulo, VistaEvaluacion } from '../types'
import { medidoresPorModulo, puntajePorSucursalModulo, type ConjuntoDatos } from './indicadores'

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

function mkEvaluacion(id: string, sucursalId: string, fecha: string, puntuacion: number | null): VistaEvaluacion {
  return {
    id,
    offline_uuid: id,
    sucursal_id: sucursalId,
    aperturada_por: 'user-test',
    fecha,
    estado: 'CERRADA',
    puntuacion,
    comentario_general: null,
    abierta_en: null,
    cerrada_en: null,
    created_at: '',
    sucursal: { id: sucursalId, nombre: 'S', shop_id: null, branch_id: null, direccion: null },
    aperturador: null
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

describe('medidoresPorModulo', () => {
  it('promedia la última evaluación puntuada de cada sucursal con el módulo activo', () => {
    const sucursalesVisibles: Sucursal[] = [
      ...sucursales,
      { id: 's3', nombre: 'Sucursal Este', shop_id: null, branch_id: null, direccion: null, gerente_id: null, activa: true, created_at: '' }
    ]
    const sucModulos: SucursalModulo[] = [
      { id: 'sm1', sucursal_id: 's1', modulo_id: 'm1', activa: true, created_at: '' },
      { id: 'sm2', sucursal_id: 's1', modulo_id: 'm2', activa: true, created_at: '' },
      { id: 'sm3', sucursal_id: 's2', modulo_id: 'm1', activa: true, created_at: '' },
      { id: 'sm4', sucursal_id: 's2', modulo_id: 'm2', activa: false, created_at: '' },
      { id: 'sm5', sucursal_id: 's3', modulo_id: 'm2', activa: true, created_at: '' }
    ]
    const evaluaciones = [
      mkEvaluacion('ev2', 's2', '2026-09-11', 70),
      mkEvaluacion('ev0', 's1', '2026-08-01', 60), // más vieja: no debe usarse
      mkEvaluacion('ev3', 's1', '2026-09-20', null), // sin puntaje: no debe usarse
      mkEvaluacion('ev1', 's1', '2026-09-10', 85)
    ]
    const respuestas = [
      respuesta('ev0', 'i1', false), // s1 · módulo 1 · evaluación vieja
      respuesta('ev1', 'i1', true), // s1 · módulo 1 → 100
      respuesta('ev1', 'i2', true), // s1 · módulo 2 → 100
      respuesta('ev2', 'i1', false), // s2 · módulo 1 → 0
      respuesta('ev3', 'i1', true) // s1 · evaluación sin puntaje (ignorada)
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

    const resultado = medidoresPorModulo(
      datos,
      modulos.map((m) => ({ id: m.id, nombre: m.nombre })),
      sucursalesVisibles,
      sucModulos
    )

    // Módulo 1: s1 (última = ev1 → 100) y s2 (ev2 → 0). Promedio 50.
    expect(resultado[0].nombre).toBe('Módulo 1')
    expect(resultado[0].promedio).toBe(50)
    expect(resultado[0].sucursales).toBe(2)
    expect(resultado[0].sinDatos).toBe(0)

    // Módulo 2: entra s1 (ev1 → 100); s2 tiene el módulo inactivo y s3 no tiene evaluación.
    expect(resultado[1].nombre).toBe('Módulo 2')
    expect(resultado[1].promedio).toBe(100)
    expect(resultado[1].sucursales).toBe(1)
    expect(resultado[1].sinDatos).toBe(1)

    // Módulo 3: ninguna sucursal con el módulo activo.
    expect(resultado[2].promedio).toBeNull()
    expect(resultado[2].sucursales).toBe(0)
    expect(resultado[2].sinDatos).toBe(0)
  })

  it('evita relojes en blanco: sin configuración usa las sucursales con datos del módulo', () => {
    const datos = {
      evaluaciones: [
        mkEvaluacion('ev1', 's1', '2026-09-10', 85),
        mkEvaluacion('ev2', 's2', '2026-09-11', 70)
      ],
      respuestas: [respuesta('ev1', 'i1', true), respuesta('ev2', 'i1', false)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = medidoresPorModulo(
      datos,
      modulos.map((m) => ({ id: m.id, nombre: m.nombre })),
      sucursales,
      [] // sin sucursal_modulos
    )

    expect(resultado[0].promedio).toBe(50) // (100 + 0) / 2
    expect(resultado[0].sucursales).toBe(2)
    expect(resultado[0].sinDatos).toBe(0)
  })

  it('toma la evaluación más reciente que sí midió el módulo', () => {
    const sucModulos: SucursalModulo[] = [
      { id: 'sm1', sucursal_id: 's1', modulo_id: 'm2', activa: true, created_at: '' }
    ]
    const datos = {
      evaluaciones: [
        mkEvaluacion('evB', 's1', '2026-09-20', 90), // más reciente pero sin ítems del módulo 2
        mkEvaluacion('evA', 's1', '2026-09-01', 80) // la única que mide el módulo 2
      ],
      respuestas: [respuesta('evB', 'i1', true), respuesta('evA', 'i2', true)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = medidoresPorModulo(
      datos,
      modulos.map((m) => ({ id: m.id, nombre: m.nombre })),
      sucursales,
      sucModulos
    )

    const m2 = resultado.find((r) => r.modulo_id === 'm2')
    expect(m2?.promedio).toBe(100) // puntaje de evA (evB no respondió el módulo 2)
    expect(m2?.sucursales).toBe(1)
    expect(m2?.sinDatos).toBe(0)
  })
})