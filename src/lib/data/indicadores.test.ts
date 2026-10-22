import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Item, Modulo, Opcion, Respuesta, Sucursal, SucursalModulo, VistaEvaluacion } from '../types'
import { medidoresPorModulo, puntajePorSucursalModulo, puntajePorUnidadModulo, resumenItemsModulo, barrasModulo, itemsDelModulo, sucursalesConModuloEvaluado, renglonesDrilldown, detalleDeEvaluacion, puntajeEnCurso, puntajeModuloDeRespuestas, resumirEvaluacion, conPuntajesRecalculados, unidadDe, seguimientoResponsables, rankingResponsables, hallazgosDeCargo, resumirFallasPorItem, type ConjuntoDatos } from './indicadores'

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
  departamento_id: null,
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

/** Evaluación de un departamento centralizado: sin sucursal, con el nombre de la unidad. */
function mkDepartamento(id: string, departamentoId: string, fecha: string, puntuacion: number | null): VistaEvaluacion {
  return {
    id,
    offline_uuid: id,
    sucursal_id: null,
    departamento_id: departamentoId,
    aperturada_por: 'user-test',
    fecha,
    estado: 'CERRADA',
    puntuacion,
    comentario_general: null,
    abierta_en: null,
    cerrada_en: null,
    created_at: '',
    sucursal: null,
    departamento: { id: departamentoId, nombre: 'Contabilidad' },
    aperturador: null
  }
}

function mkEvaluacion(id: string, sucursalId: string, fecha: string, puntuacion: number | null): VistaEvaluacion {
  return {
    id,
    offline_uuid: id,
    sucursal_id: sucursalId,
    departamento_id: null,
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

describe('puntajePorUnidadModulo', () => {
  it('arma la matriz por departamento sin mezclarla con las sucursales', () => {
    const datos: ConjuntoDatos = {
      evaluaciones: [evaluaciones[0], mkDepartamento('evDep', 'dep1', '2026-09-03', 100)],
      // La sucursal falla i1 y el departamento la cumple: cada respuesta queda en su fila.
      respuestas: [respuesta('ev1', 'i1', false), respuesta('evDep', 'i1', true)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    }

    const matriz = puntajePorUnidadModulo(datos, [
      { id: 's1', nombre: 'Sucursal Norte' },
      { id: 'dep1', nombre: 'Contabilidad' }
    ])

    expect(matriz.modulos.map((modulo) => modulo.nombre)).toEqual(['Módulo 1', 'Módulo 2', 'Módulo 3'])
    expect(matriz.unidades.map((u) => u.nombre)).toEqual(['Sucursal Norte', 'Contabilidad'])
    expect(matriz.unidades[0].unidad_id).toBe('s1')
    expect(matriz.unidades[0].porModulo['Módulo 1']).toBe(0)
    expect(matriz.unidades[1].unidad_id).toBe('dep1')
    expect(matriz.unidades[1].porModulo['Módulo 1']).toBe(100)
    // Los módulos sin respuesta de esa unidad quedan en null, como en sucursales.
    expect(matriz.unidades[1].porModulo['Módulo 2']).toBeNull()
  })
})

describe('sucursalesConModuloEvaluado', () => {
  it('cuenta solo sucursales con el módulo habilitado y evaluación con respuestas del módulo', () => {
    const sucModulos: SucursalModulo[] = [
      { id: 'sm1', sucursal_id: 's1', modulo_id: 'm1', activa: true, created_at: '' },
      { id: 'sm2', sucursal_id: 's1', modulo_id: 'm2', activa: true, created_at: '' },
      { id: 'sm3', sucursal_id: 's2', modulo_id: 'm2', activa: true, created_at: '' }
    ]
    const evs = [
      mkEvaluacion('ev1', 's1', '2026-09-01', null),
      mkEvaluacion('ev2', 's2', '2026-09-02', null),
      mkEvaluacion('ev3', 's3', '2026-09-03', null)
    ]
    const datos: ConjuntoDatos = {
      evaluaciones: evs,
      // m1 habilitado en s1 (respuesta) ; s2 tiene m2 (respuesta de i2, no de m1: no cuenta para m1)
      respuestas: [respuesta('ev1', 'i1', true), respuesta('ev2', 'i2', true)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    }
    // m1: s1 habilitado + respuesta => 1 ; s2 habilitado m2 pero sin respuestas de m1 => no cuenta.
    expect(sucursalesConModuloEvaluado(datos, 'm1', sucModulos)).toBe(1)
    // m2: s1 y s2 habilitados; con respuestas solo s2 (i2 es de m2) => 1.
    expect(sucursalesConModuloEvaluado(datos, 'm2', sucModulos)).toBe(1)
  })

  it('sin config sucursal_modulos aplican todos los módulos y cuenta si hay respuestas', () => {
    const datos: ConjuntoDatos = {
      evaluaciones: [mkEvaluacion('ev1', 's1', '2026-09-01', null)],
      respuestas: [respuesta('ev1', 'i1', true)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    }
    expect(sucursalesConModuloEvaluado(datos, 'm1', [])).toBe(1)
    expect(sucursalesConModuloEvaluado(datos, 'm2', [])).toBe(0)
  })

  it('sucursal con respuestas del módulo pero módulo deshabilitado no cuenta', () => {
    const sucModulos: SucursalModulo[] = [
      { id: 'sm1', sucursal_id: 's1', modulo_id: 'm2', activa: true, created_at: '' } // m1 no habilitado en s1
    ]
    const datos: ConjuntoDatos = {
      evaluaciones: [mkEvaluacion('ev1', 's1', '2026-09-01', null)],
      respuestas: [respuesta('ev1', 'i1', true)], // i1 es de m1, pero m1 no está habilitado en s1
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    }
    expect(sucursalesConModuloEvaluado(datos, 'm1', sucModulos)).toBe(0)
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

  // Flota Vehicular: un módulo que sólo se evalúa por departamento. Antes el
  // reloj quedaba en blanco aunque tuviera evaluaciones encima, porque la
  // función miraba únicamente `sucursal_id`.
  const departamento = (id: string, depId: string, fecha: string, puntaje: number | null): VistaEvaluacion => ({
    ...mkEvaluacion(id, '', fecha, puntaje),
    sucursal_id: null,
    departamento_id: depId
  })

  it('un módulo evaluado sólo por departamento deja de quedar en blanco', () => {
    const datos = {
      evaluaciones: [departamento('evD', 'd1', '2026-09-15', 80)],
      respuestas: [respuesta('evD', 'i1', true)], // i1 → módulo 1
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = medidoresPorModulo(
      datos,
      [{ id: 'm1', nombre: 'Módulo 1' }],
      sucursales,
      [], // ninguna sucursal tiene el módulo configurado
      [{ id: 'd1' }]
    )

    expect(resultado[0].promedio).toBe(100)
    expect(resultado[0].departamentos).toBe(1)
    expect(resultado[0].sucursales).toBe(0)
  })

  it('entra aunque SÍ haya configuración de sucursales para el módulo', () => {
    // Éste era el caso que se colaba: si una sucursal tenía el módulo activo,
    // `miembros` no quedaba vacío y el fallback no corría, así que el
    // departamento seguía afuera.
    const sucModulos: SucursalModulo[] = [
      { id: 'sm1', sucursal_id: 's1', modulo_id: 'm1', activa: true, created_at: '' }
    ]
    const datos = {
      evaluaciones: [departamento('evD', 'd1', '2026-09-15', 60)],
      respuestas: [respuesta('evD', 'i1', true)], // i1 → módulo 1
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = medidoresPorModulo(
      datos,
      [{ id: 'm1', nombre: 'Módulo 1' }],
      sucursales,
      sucModulos,
      [{ id: 'd1' }]
    )

    // s1 está configurada pero no evaluó: cuenta como sin datos. El
    // departamento sí entró al promedio.
    expect(resultado[0].promedio).toBe(100)
    expect(resultado[0].departamentos).toBe(1)
    expect(resultado[0].sucursales).toBe(0)
    expect(resultado[0].sinDatos).toBe(1)
  })

  it('promedia sucursales y departamentos juntos, pero los cuenta aparte', () => {
    const datos = {
      evaluaciones: [
        mkEvaluacion('evS', 's1', '2026-09-10', 85),
        departamento('evD', 'd1', '2026-09-15', 80)
      ],
      respuestas: [respuesta('evS', 'i1', true), respuesta('evD', 'i1', false)], // 100 y 0
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = medidoresPorModulo(
      datos,
      [{ id: 'm1', nombre: 'Módulo 1' }],
      sucursales,
      [],
      [{ id: 'd1' }]
    )

    expect(resultado[0].promedio).toBe(50)
    expect(resultado[0].sucursales).toBe(1)
    expect(resultado[0].departamentos).toBe(1)
    expect(resultado[0].sinDatos).toBe(0)
  })

  it('un departamento fuera del filtro sigue sin entrar', () => {
    const datos = {
      evaluaciones: [departamento('evD', 'd1', '2026-09-15', 80)],
      respuestas: [respuesta('evD', 'i1', true)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = medidoresPorModulo(
      datos,
      [{ id: 'm1', nombre: 'Módulo 1' }],
      sucursales,
      [],
      [] // sin departamentos visibles
    )

    expect(resultado[0].promedio).toBeNull()
    expect(resultado[0].departamentos).toBe(0)
  })

  it('una evaluación sin unidad no cuenta para nada', () => {
    const huerfana = { ...departamento('evX', '', '2026-09-15', 80), departamento_id: null }
    const datos = {
      evaluaciones: [huerfana],
      respuestas: [respuesta('evX', 'i1', true)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const resultado = medidoresPorModulo(
      datos,
      [{ id: 'm1', nombre: 'Módulo 1' }],
      sucursales,
      [],
      [{ id: 'd1' }]
    )

    expect(resultado[0].promedio).toBeNull()
  })
})

const MOD_RESUMEN = 'mres'
const evResumen = [
  mkEvaluacion('r1', 's1', '2026-09-10', null),
  mkEvaluacion('r2', 's2', '2026-09-11', null)
]

function itemResumen(id: string, orden: number, tipo: Item['tipo'], opciones: Opcion[] = [], padre?: string, activo = true, puntaje = 100): Item {
  return {
    id,
    modulo_id: MOD_RESUMEN,
    tipo,
    texto: `Ítem ${id}`,
    opciones,
    orden,
    requerido: false,
    activo,
    puntaje,
    padre_id: padre ?? null,
    created_at: ''
  }
}

function datosResumen(items: Item[], respuestas: Respuesta[]): ConjuntoDatos {
  return { evaluaciones: evResumen, respuestas, items, modulos: [], fotos: [], sucursalOpciones: [], instancias: [] }
}

describe('resumenItemsModulo', () => {
  it('agrega ítems cumple/no cumple, checklists binarios y checklists proporcionales con su desglose por opción', () => {
    const items = [
      itemResumen('ibin', 0, 'CUMPLE_NO_CUMPLE'),
      itemResumen('ibinact', 1, 'CUMPLE_NO_CUMPLE', [], undefined, false), // inactivo: se excluye
      itemResumen('ichk-bin', 2, 'CHECKLIST', [
        { id: 'o1', etiqueta: 'A' },
        { id: 'o2', etiqueta: 'B' }
      ]),
      itemResumen('ichk-prop', 3, 'CHECKLIST', [
        { id: 'p1', etiqueta: 'X', puntos: 50 },
        { id: 'p2', etiqueta: 'Y', puntos: 50 }
      ])
    ]
    const respuestas: Respuesta[] = [
      { id: 'a', evaluacion_id: 'r1', item_id: 'ibin', instancia_id: null, valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'b', evaluacion_id: 'r2', item_id: 'ibin', instancia_id: null, valor: { value: false }, respondido_por: null, created_at: '' },
      { id: 'c', evaluacion_id: 'r1', item_id: 'ichk-bin', instancia_id: null, valor: { selected: ['o1'] }, respondido_por: null, created_at: '' },
      { id: 'd', evaluacion_id: 'r2', item_id: 'ichk-bin', instancia_id: null, valor: { selected: ['o1', 'o2'] }, respondido_por: null, created_at: '' },
      { id: 'e', evaluacion_id: 'r1', item_id: 'ichk-prop', instancia_id: null, valor: { selected: ['p1'] }, respondido_por: null, created_at: '' },
      { id: 'f', evaluacion_id: 'r2', item_id: 'ichk-prop', instancia_id: null, valor: { selected: ['p1', 'p2'] }, respondido_por: null, created_at: '' }
    ]

    const resumen = resumenItemsModulo(datosResumen(items, respuestas), MOD_RESUMEN)

    expect(resumen.map((r) => r.item.id)).toEqual(['ibin', 'ichk-bin', 'ichk-prop'])

    const bin = resumen[0]
    expect(bin.muestras).toBe(2)
    expect(bin.ok).toBe(1)
    expect(bin.promedio).toBe(0.5)

    const chkBin = resumen[1]
    expect(chkBin.muestras).toBe(2)
    expect(chkBin.ok).toBe(1)
    expect(chkBin.promedio).toBe(0.5)
    expect(chkBin.opciones).toEqual([
      { id: 'o1', etiqueta: 'A', tipo_respuesta: null, minimo: null, unidad: null, veces: 2, cumplida: 2 },
      { id: 'o2', etiqueta: 'B', tipo_respuesta: null, minimo: null, unidad: null, veces: 2, cumplida: 1 }
    ])

    const chkProp = resumen[2]
    expect(chkProp.muestras).toBe(2)
    expect(chkProp.ok).toBe(1.5)
    expect(chkProp.promedio).toBe(0.75)
    expect(chkProp.opciones?.[0]).toMatchObject({ id: 'p1', veces: 2, cumplida: 2 })
    expect(chkProp.opciones?.[1]).toMatchObject({ id: 'p2', veces: 2, cumplida: 1 })
  })

  it('desglosa la conciliación en productos escaneados, conciliados y tasa de descuadre', () => {
    const items = [itemResumen('icon', 0, 'CONCILIACION')]
    const respuestas: Respuesta[] = [
      {
        id: 'a',
        evaluacion_id: 'r1',
        item_id: 'icon',
        instancia_id: null,
        valor: {
          productos: [
            { sku: '1', nombre: null, teorica: 10, fisica: 10 },
            { sku: '2', nombre: null, teorica: 5, fisica: 3 }
          ]
        },
        respondido_por: null,
        created_at: ''
      },
      {
        id: 'b',
        evaluacion_id: 'r2',
        item_id: 'icon',
        instancia_id: null,
        valor: { productos: [{ sku: '3', nombre: null, teorica: 7, fisica: 7 }] },
        respondido_por: null,
        created_at: ''
      }
    ]

    const [conc] = resumenItemsModulo(datosResumen(items, respuestas), MOD_RESUMEN)

    expect(conc.muestras).toBe(2)
    expect(conc.ok).toBe(1)
    expect(conc.promedio).toBe(0.5)
    expect(conc.conciliacion).toEqual({ total: 3, conciliados: 2, tasaDescuadre: 33.33 })
  })

  it('cuenta trabajadores y unidades evaluadas (de los que aplican) y cuántos cumplen', () => {
    const items = [
      itemResumen('ilis', 0, 'LISTA_COLABORADORES', [{ id: 'c1', etiqueta: 'Check 1' }, { id: 'c2', etiqueta: 'Check 2' }]),
      itemResumen('iuni', 1, 'UNIDAD_CHECKLIST', [{ id: 'un1', etiqueta: 'Uno' }, { id: 'un2', etiqueta: 'Dos' }])
    ]
    const colab = (selected: string[]) => ({
      dni: 1,
      name: 'N',
      lastname: 'L',
      active: true,
      aplica: true,
      selected
    })
    const respuestas: Respuesta[] = [
      {
        id: 'a',
        evaluacion_id: 'r1',
        item_id: 'ilis',
        instancia_id: null,
        valor: { colaboradores: [colab(['c1', 'c2']), colab(['c1'])] },
        respondido_por: null,
        created_at: ''
      },
      {
        id: 'b',
        evaluacion_id: 'r2',
        item_id: 'ilis',
        instancia_id: null,
        valor: { colaboradores: [colab(['c1', 'c2'])] },
        respondido_por: null,
        created_at: ''
      },
      {
        id: 'c',
        evaluacion_id: 'r1',
        item_id: 'iuni',
        instancia_id: null,
        valor: { unidades: [{ codigo: 'U1', selected: ['un1', 'un2'] }] },
        respondido_por: null,
        created_at: ''
      },
      {
        id: 'd',
        evaluacion_id: 'r2',
        item_id: 'iuni',
        instancia_id: null,
        valor: { unidades: [{ codigo: 'U1', selected: ['un1'] }] },
        respondido_por: null,
        created_at: ''
      }
    ]

    const resumen = resumenItemsModulo(datosResumen(items, respuestas), MOD_RESUMEN)

    const lista = resumen[0]
    expect(lista.muestras).toBe(2)
    // El promedio del módulo es el promedio de las proporciones POR TRABAJADOR:
    // la primera evaluación tiene 1 de 2 completos (0.5) y la segunda 1 de 1 (1),
    // así que 0.75. Con el todo-o-nada anterior la primera valía 0 y daba 0.5.
    expect(lista.promedio).toBe(0.75)
    expect(lista.colaboradores).toEqual({ total: 3, ok: 2 })

    const uni = resumen[1]
    expect(uni.muestras).toBe(2)
    expect(uni.promedio).toBe(0.5)
    expect(uni.unidades).toEqual({ total: 2, ok: 1 })
  })

  it('excluye las secciones CONTENEDOR pero agrega sus hijos como ítems propios', () => {
    const items = [
      itemResumen('icont', 0, 'CONTENEDOR', [], undefined, true, 40),
      itemResumen('ih1', 1, 'CUMPLE_NO_CUMPLE', [], 'icont', true, 50),
      itemResumen('ih2', 2, 'CUMPLE_NO_CUMPLE', [], 'icont', true, 50)
    ]
    const respuestas: Respuesta[] = [
      { id: 'a', evaluacion_id: 'r1', item_id: 'ih1', instancia_id: null, valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'b', evaluacion_id: 'r2', item_id: 'ih2', instancia_id: null, valor: { value: false }, respondido_por: null, created_at: '' }
    ]

    const resumen = resumenItemsModulo(datosResumen(items, respuestas), MOD_RESUMEN)

    expect(resumen.map((r) => r.item.id)).toEqual(['ih1', 'ih2'])
    expect(resumen[0].ok).toBe(1)
    expect(resumen[1].ok).toBe(0)
  })

  it('usa el catálogo para mostrar ítems sin respuestas (promedio nulo) y respeta el orden', () => {
    const itemsVacio: Item[] = [itemResumen('i3', 3, 'CUMPLE_NO_CUMPLE'), itemResumen('i1', 1, 'CUMPLE_NO_CUMPLE'), itemResumen('i2', 2, 'CUMPLE_NO_CUMPLE')]
    const resumen = resumenItemsModulo(datosResumen([], []), MOD_RESUMEN, itemsVacio)

    expect(resumen.map((r) => r.item.id)).toEqual(['i1', 'i2', 'i3'])
    expect(resumen.every((r) => r.muestras === 0 && r.promedio === null)).toBe(true)
  })
})

const MOD_BARRA = 'mbar'

function itemBarra(id: string, orden: number, tipo: Item['tipo'], opciones: Opcion[] = [], padre?: string, puntaje = 100, apiId?: string): Item {
  return {
    id,
    modulo_id: MOD_BARRA,
    tipo,
    texto: `Ítem ${id}`,
    opciones,
    orden,
    requerido: false,
    activo: true,
    puntaje,
    padre_id: padre ?? null,
    api_id: apiId ?? null,
    created_at: ''
  }
}

function datosBarra(items: Item[], respuestas: Respuesta[], instancias: ConjuntoDatos['instancias'] = []): ConjuntoDatos {
  return {
    evaluaciones: [
      mkEvaluacion('b1', 's1', '2026-09-10', null),
      mkEvaluacion('b2', 's2', '2026-09-11', null)
    ],
    respuestas,
    items,
    modulos: [],
    fotos: [],
    sucursalOpciones: [],
    instancias
  }
}

const barrasSucursales = [
  { id: 's1', nombre: 'Sucursal Norte' },
  { id: 's2', nombre: 'Sucursal Sur' },
  { id: 's3', nombre: 'Sucursal Este' }
]

describe('barrasModulo', () => {
  it('agrupa el promedio ponderado del módulo por sucursal y deja sin datos las que no respondieron', () => {
    const items = [
      itemBarra('iA', 0, 'CUMPLE_NO_CUMPLE', [], undefined, 70),
      itemBarra('iB', 1, 'CUMPLE_NO_CUMPLE', [], undefined, 30)
    ]
    const respuestas: Respuesta[] = [
      { id: 'a', evaluacion_id: 'b1', item_id: 'iA', instancia_id: null, valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'b', evaluacion_id: 'b1', item_id: 'iB', instancia_id: null, valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'c', evaluacion_id: 'b2', item_id: 'iA', instancia_id: null, valor: { value: false }, respondido_por: null, created_at: '' },
      { id: 'd', evaluacion_id: 'b2', item_id: 'iB', instancia_id: null, valor: { value: true }, respondido_por: null, created_at: '' }
    ]

    const r = barrasModulo(datosBarra(items, respuestas), MOD_BARRA, barrasSucursales, false)

    expect(r.grupo).toBe('sucursal')
    expect(r.barras).toHaveLength(3)
    expect(r.barras[0]).toEqual({ clave: 's1', etiqueta: 'Sucursal Norte', puntaje: 100, muestras: 1 })
    expect(r.barras[1]).toEqual({ clave: 's2', etiqueta: 'Sucursal Sur', puntaje: 30, muestras: 1 })
    expect(r.barras[2]).toEqual({ clave: 's3', etiqueta: 'Sucursal Este', puntaje: null, muestras: 0 })
  })

  it('en módulos de vehículos agrupa el promedio por placa (instancia) en lugar de por sucursal', () => {
    const items = [
      itemBarra('icont', 0, 'CONTENEDOR', [], undefined, 40, 'vehiculos'),
      itemBarra('ih1', 1, 'CUMPLE_NO_CUMPLE', [], 'icont', 60),
      itemBarra('ih2', 2, 'CUMPLE_NO_CUMPLE', [], 'icont', 40)
    ]
    const instancias: ConjuntoDatos['instancias'] = [
      { id: 'v1', evaluacion_id: 'b1', item_id: 'icont', etiqueta: 'AAA111', orden: 1, api_id: 'vehiculos', datos: null, created_at: '' },
      { id: 'v2', evaluacion_id: 'b1', item_id: 'icont', etiqueta: 'BBB222', orden: 2, api_id: 'vehiculos', datos: null, created_at: '' },
      { id: 'v3', evaluacion_id: 'b2', item_id: 'icont', etiqueta: 'AAA111', orden: 1, api_id: 'vehiculos', datos: null, created_at: '' },
      { id: 'v4', evaluacion_id: 'b2', item_id: 'icont', etiqueta: 'CCC333', orden: 2, api_id: 'vehiculos', datos: null, created_at: '' }
    ]
    const respuestas: Respuesta[] = [
      { id: 'a', evaluacion_id: 'b1', item_id: 'ih1', instancia_id: 'v1', valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'b', evaluacion_id: 'b1', item_id: 'ih2', instancia_id: 'v1', valor: { value: false }, respondido_por: null, created_at: '' },
      { id: 'c', evaluacion_id: 'b1', item_id: 'ih1', instancia_id: 'v2', valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'd', evaluacion_id: 'b1', item_id: 'ih2', instancia_id: 'v2', valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'e', evaluacion_id: 'b2', item_id: 'ih1', instancia_id: 'v3', valor: { value: true }, respondido_por: null, created_at: '' },
      { id: 'f', evaluacion_id: 'b2', item_id: 'ih2', instancia_id: 'v3', valor: { value: true }, respondido_por: null, created_at: '' }
    ]

    const r = barrasModulo(datosBarra(items, respuestas, instancias), MOD_BARRA, barrasSucursales, true)

    expect(r.grupo).toBe('placa')
    expect(r.barras.map((b) => b.clave)).toEqual(['BBB222', 'AAA111', 'CCC333'])

    // AAA111: ih1 100%(b1,b2), ih2 0%(b1) y 100%(b2) → logra 80/100 del peso del módulo → 80%; 2 evaluaciones.
    const aaa = r.barras.find((b) => b.clave === 'AAA111')
    expect(aaa?.puntaje).toBe(80)
    expect(aaa?.muestras).toBe(2)

    const bbb = r.barras.find((b) => b.clave === 'BBB222')
    expect(bbb?.puntaje).toBe(100)
    expect(bbb?.muestras).toBe(1)

    // CCC333: instancia registrada sin respuestas → sin datos.
    expect(r.barras.find((b) => b.clave === 'CCC333')).toEqual({ clave: 'CCC333', etiqueta: 'CCC333', puntaje: null, muestras: 0 })
  })
})

describe('itemsDelModulo', () => {
  it('conserva los contenedores (grupos sin respuestas) junto a los ítems respondidos del módulo', () => {
    const todos: Item[] = [
      itemBarra('icont', 0, 'CONTENEDOR', [], undefined, 40, 'vehiculos'),
      itemBarra('ih1', 1, 'CUMPLE_NO_CUMPLE', [], 'icont', 60),
      itemBarra('ih2', 2, 'CUMPLE_NO_CUMPLE', [], 'icont', 40),
      itemBarra('de-otro', 0, 'CUMPLE_NO_CUMPLE', [], undefined, 100)
    ]
    const deOtro = todos[3]
    deOtro.modulo_id = 'otro-modulo'

    const r = itemsDelModulo(todos, MOD_BARRA)

    expect(r.map((i) => i.id)).toEqual(['icont', 'ih1', 'ih2'])
  })
})

describe('renglonesDrilldown', () => {
  const evs = [
    mkEvaluacion('d1', 's1', '2026-09-05', 90),
    mkEvaluacion('d2', 's2', '2026-08-20', 40)
  ]

  it('filtra por sucursal y muestra el nombre unido', () => {
    const datos = {
      evaluaciones: evs,
      respuestas: [],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const filas = renglonesDrilldown(datos, { sucursal_id: 's1' })
    expect(filas.map((f) => f.id)).toEqual(['d1'])
    expect(filas[0].sucursal).toBe('S')
  })

  it('filtra por departamento y nombra esa unidad', () => {
    const datos = {
      evaluaciones: [...evs, mkDepartamento('d3', 'dep1', '2026-09-10', 80)],
      respuestas: [],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const filas = renglonesDrilldown(datos, { departamento_id: 'dep1' })
    expect(filas.map((f) => f.id)).toEqual(['d3'])
    expect(filas[0].sucursal).toBe('Contabilidad')
    // Las de sucursal no entran, y un departamento sin evaluaciones queda vacío.
    expect(renglonesDrilldown(datos, { departamento_id: 'dep2' })).toEqual([])
  })

  it('con soloNoCumple incluye solo las evaluaciones donde el ítem no llegó al 100%', () => {
    const datos = {
      evaluaciones: evs,
      respuestas: [respuesta('d1', 'i1', true), respuesta('d2', 'i1', false)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const filas = renglonesDrilldown(datos, { item_id: 'i1', soloNoCumple: true })
    expect(filas.map((f) => f.id)).toEqual(['d2'])
    expect(filas[0].puntajeScope).toBe(0)
  })

  it('filtra por mes (clave YYYY-MM) y respeta el puntaje global', () => {
    const datos = {
      evaluaciones: evs,
      respuestas: [],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const filas = renglonesDrilldown(datos, { mes: '2026-09' })
    expect(filas.map((f) => f.id)).toEqual(['d1'])
    expect(filas[0].puntaje).toBe(90)
  })

  it('cuenta muestras puntuables del alcance y calcula el puntaje del módulo', () => {
    const datos = {
      evaluaciones: evs,
      respuestas: [respuesta('d1', 'i1', true), respuesta('d1', 'i2', false), respuesta('d2', 'i1', false)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const filas = renglonesDrilldown(datos, { modulo_id: 'm1' })
    // d1: solo i1 responde al módulo m1 → 1 muestra, cumple 100
    const d1 = filas.find((f) => f.id === 'd1')
    expect(d1?.muestras).toBe(1)
    expect(d1?.puntajeScope).toBe(100)
    // d2: i1 (false) → 1 muestra, 0%
    const d2 = filas.find((f) => f.id === 'd2')
    expect(d2?.muestras).toBe(1)
    expect(d2?.puntajeScope).toBe(0)
  })
})

describe('detalleDeEvaluacion', () => {
  it('resume el valor y el estado de cada respuesta puntuable, ordenado por módulo e ítem', () => {
    const datos = {
      evaluaciones,
      respuestas: [respuesta('ev1', 'i1', true), respuesta('ev1', 'i2', false)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const detalle = detalleDeEvaluacion(datos, 'ev1')
    expect(detalle).toHaveLength(2)
    expect(detalle[0].item_id).toBe('i1')
    expect(detalle[0].cumple).toBe(true)
    expect(detalle[0].resumen).toBe('Cumple')
    expect(detalle[0].modulo).toBe('Módulo 1')
    expect(detalle[0].modulo_id).toBe('m1')
    expect(detalle[0].peso).toBe(100)
    expect(detalle[0].veredicto).toBe('cumple')
    expect(detalle[0].comentarios).toBe('')
    expect(detalle[0].respondido_por).toBe(null)
    expect(detalle[1].cumple).toBe(false)
    expect(detalle[1].resumen).toBe('No cumple')
    expect(detalle[1].veredicto).toBe('no-cumple')
  })

  it('sube el veredicto, los comentarios de evidencia y quién respondió', () => {
    const datos = {
      evaluaciones,
      respuestas: [
        {
          ...respuesta('ev1', 'i1', true),
          respondido_por: 'user-7',
          valor: { value: true, evidencias: [{ photoIds: [], comentario: 'Vidrio roto en cámara 3' }] }
        },
        { ...respuesta('ev1', 'i2', true), valor: { value: true, informativo: true } }
      ],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const detalle = detalleDeEvaluacion(datos, 'ev1')
    expect(detalle[0].comentarios).toBe('Vidrio roto en cámara 3')
    expect(detalle[0].respondido_por).toBe('user-7')
    expect(detalle[0].veredicto).toBe('cumple')
    expect(detalle[1].veredicto).toBe('no-aplica')
    expect(detalle[1].proporcion).toBe(null)
  })

  it('ignora las evidencias que vienen como objeto por opción (checklist)', () => {
    const itemsChecklist: Item[] = [
      ...items,
      { id: 'i9', modulo_id: 'm1', tipo: 'CHECKLIST', texto: 'Checklist', opciones: [], orden: 5, requerido: false, activo: true, puntaje: 100, created_at: '' }
    ]
    const datos = {
      evaluaciones,
      respuestas: [
        {
          ...respuesta('ev1', 'i9', false),
          // En los CHECKLIST `evidencias` es un objeto por opción, sin
          // comentario: si alguien lo trata como arreglo, esto truena.
          valor: { selected: [], evidencias: { o1: { photoIds: ['p1'] } } }
        }
      ],
      items: itemsChecklist,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const detalle = detalleDeEvaluacion(datos, 'ev1')
    expect(detalle[0].comentarios).toBe('')
  })

  it('lleva el comentario de cada punto de las listas a la columna de comentarios', () => {
    // La nota que el evaluador dejó en un punto viaja con el nombre del punto:
    // "Góndola de panadería: falta la mercadería". En las unidades y en los
    // trabajadores se antepone la unidad o el nombre de la persona, porque ahí
    // el mismo check se repite en varios sitios.
    const itemsListas: Item[] = [
      ...items,
      {
        id: 'i9',
        modulo_id: 'm1',
        tipo: 'CHECKLIST',
        texto: 'Checklist',
        opciones: [
          { id: 'o1', etiqueta: 'Limpio' },
          { id: 'o2', etiqueta: 'Etiquetas puestas' }
        ],
        orden: 5,
        requerido: false,
        activo: true,
        puntaje: 100,
        created_at: ''
      },
      {
        id: 'i10',
        modulo_id: 'm1',
        tipo: 'UNIDAD_CHECKLIST',
        texto: 'Unidades',
        opciones: [{ id: 'o1', etiqueta: 'Requerimiento A' }],
        orden: 6,
        requerido: false,
        activo: true,
        puntaje: 100,
        created_at: ''
      },
      {
        id: 'i11',
        modulo_id: 'm1',
        tipo: 'LISTA_COLABORADORES',
        texto: 'Trabajadores',
        opciones: [{ id: 'o1', etiqueta: 'Contrato vigente' }],
        orden: 7,
        requerido: false,
        activo: true,
        puntaje: 100,
        created_at: ''
      }
    ]
    const datos = {
      evaluaciones,
      respuestas: [
        { ...respuesta('ev1', 'i9', false), valor: { selected: ['o1'], comentarios: { o2: 'faltan las etiquetas' } } },
        {
          ...respuesta('ev1', 'i10', false),
          valor: { unidades: [{ codigo: 'U1', selected: [], comentarios: { o1: 'sin etiqueta' } }] }
        },
        {
          ...respuesta('ev1', 'i11', false),
          valor: {
            colaboradores: [
              { dni: 1, name: 'Ana', lastname: 'Gómez', active: true, aplica: true, selected: [], comentarios: { o1: 'contrato en la carpeta' } }
            ]
          }
        }
      ],
      items: itemsListas,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const detalle = detalleDeEvaluacion(datos, 'ev1')
    const comentariosDe = (itemId: string): string => detalle.find((d) => d.item_id === itemId)!.comentarios
    expect(comentariosDe('i9')).toBe('Etiquetas puestas: faltan las etiquetas')
    expect(comentariosDe('i10')).toBe('U1: Requerimiento A: sin etiqueta')
    expect(comentariosDe('i11')).toBe('Gómez Ana: Contrato vigente: contrato en la carpeta')
  })

  it('anuncia los puntos con la presencia marcada que todavía no se validaron', () => {
    // Con doble check, un punto que sólo tiene el «existe» no puntúa; si el
    // resumen dijera sólo "0/1 unidades completas" parecería que nadie lo miró.
    const itemUnidad: Item = {
      id: 'i12',
      modulo_id: 'm1',
      tipo: 'UNIDAD_CHECKLIST',
      texto: 'Unidades',
      opciones: [{ id: 'o1', etiqueta: 'Uno' }, { id: 'o2', etiqueta: 'Dos' }],
      orden: 8,
      requerido: false,
      activo: true,
      puntaje: 100,
      doble_check: true,
      created_at: ''
    }
    const datos = {
      evaluaciones,
      respuestas: [
        {
          ...respuesta('ev1', 'i12', false),
          valor: { unidades: [{ codigo: 'U1', selected: ['o1'], existe: ['o1', 'o2'] }] }
        }
      ],
      items: [...items, itemUnidad],
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const detalle = detalleDeEvaluacion(datos, 'ev1')
    expect(detalle[0].resumen).toBe('0/1 unidades completas · 1 presente(s) sin validar')
  })

  it('acota el detalle al ítem clickeado', () => {
    const datos = {
      evaluaciones,
      respuestas: [respuesta('ev1', 'i1', true), respuesta('ev1', 'i3', true)],
      items,
      modulos,
      fotos: [],
      sucursalOpciones: [],
      instancias: []
    } satisfies ConjuntoDatos

    const detalle = detalleDeEvaluacion(datos, 'ev1', { item_id: 'i1' })
    expect(detalle.map((d) => d.item_id)).toEqual(['i1'])
  })
})

describe('puntajeEnCurso', () => {
  const activa: VistaEvaluacion = { ...evaluaciones[0], estado: 'ACTIVA', puntuacion: null }

  it('calcula el puntaje en vivo con los ítems respondidos (1 de 2 pesos = 50)', () => {
    const resps = [respuesta('ev1', 'i1', true), respuesta('ev1', 'i2', false), respuesta('ev2', 'i1', true)]
    const r = puntajeEnCurso(activa, resps, items)
    expect(r.puntaje).toBe(50)
    expect(r.respondidos).toBe(2)
  })

  it('solo considera las respuestas de la propia evaluación', () => {
    const resps = [respuesta('ev2', 'i1', true), respuesta('ev2', 'i2', true)]
    expect(puntajeEnCurso(activa, resps, items)).toEqual({ puntaje: null, respondidos: 0 })
  })

  it('sin respuestas devuelve puntaje null y 0 ítems respondidos', () => {
    expect(puntajeEnCurso(activa, [], items)).toEqual({ puntaje: null, respondidos: 0 })
  })

  it('con todos los ítems respondidos coincide con el puntaje final (cerrado)', () => {
    const resps = [respuesta('ev1', 'i1', true), respuesta('ev1', 'i2', false), respuesta('ev1', 'i3', true)]
    expect(puntajeEnCurso(activa, resps, items).puntaje).toBe(66.67)
  })

  // Una sección (CONTENEDOR) pesa como grupo: su puntaje pesa, no el de sus
  // hijos. Si el puntaje en curso no recibe la sección, cada hijo pesa por su
  // cuenta y el número cambia de golpe al cerrar.
  const seccion: Item = {
    id: 'sec1',
    modulo_id: 'm1',
    tipo: 'CONTENEDOR',
    texto: 'Sección',
    opciones: [],
    orden: 0,
    requerido: false,
    activo: true,
    puntaje: 100,
    padre_id: null,
    created_at: ''
  }
  const hijo = (id: string, orden: number, puntaje: number): Item => ({
    id,
    modulo_id: 'm1',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto: id,
    opciones: [],
    orden,
    requerido: false,
    activo: true,
    puntaje,
    padre_id: 'sec1',
    created_at: ''
  })
  const conSeccion = [seccion, hijo('h1', 1, 10), hijo('h2', 2, 10), { ...items[0], padre_id: null, id: 'suelto', puntaje: 100 }]
  const soloHijos = conSeccion.filter((i) => i.tipo !== 'CONTENEDOR')

  it('el puntaje en curso y el de cierre coinciden aunque la sección no tenga respuestas', () => {
    const resps = [respuesta('ev1', 'h1', true), respuesta('ev1', 'h2', false), respuesta('ev1', 'suelto', true)]

    // Con la sección: pesa 100 como grupo con 50% de cumplimiento, más el suelto.
    expect(puntajeEnCurso(activa, resps, conSeccion).puntaje).toBe(75)
    expect(puntajeModuloDeRespuestas(resps, conSeccion, 'm1', 's1')).toBe(75)
    // Sin la sección (lo que llegaba desde el historial): los hijos pesan 10 cada uno.
    expect(puntajeEnCurso(activa, resps, soloHijos).puntaje).toBe(91.67)
  })

  it('el historial trae los contenedores padre, como el detalle y el PDF', () => {
    // Regresión: `consultarEvaluaciones` filtraba `items` a solo los respondidos,
    // dejando afuera las secciones, y el puntaje en curso salía distinto al de
    // cierre. Las dos rutas de datos deben traer la misma estructura.
    const codigo = readFileSync(fileURLToPath(new URL('./indicadores.ts', import.meta.url)), 'utf8')
    const cuerpo = codigo.slice(codigo.indexOf('export async function consultarEvaluaciones'))
    // Sin filtros que dejen los contenedores padre afuera.
    expect(cuerpo).not.toMatch(/const items = todosItems\.filter/)
    expect(cuerpo).toContain('const items = todosItems')
    // Y el detalle los sigue trayendo: es la referencia de la regla.
    const detalle = codigo.slice(codigo.indexOf('export async function obtenerEvaluacion'), codigo.indexOf('export function itemsDelModulo'))
    expect(detalle).toContain('[...it, ...padres]')
  })
})

describe('conPuntajesRecalculados', () => {
  it('promedia los módulos por igual, aunque tengan distinta cantidad de ítems', () => {
    const evaluacion = mkEvaluacion('ev1', 's1', '2026-09-10', 66.67)
    const itemsEvaluacion = [
      { ...itemResumen('a', 0, 'CUMPLE_NO_CUMPLE'), modulo_id: 'm1' },
      { ...itemResumen('b', 1, 'CUMPLE_NO_CUMPLE'), modulo_id: 'm1' },
      { ...itemResumen('c', 2, 'CUMPLE_NO_CUMPLE'), modulo_id: 'm2' }
    ]
    const respuestas = [
      respuesta('ev1', 'a', true),
      respuesta('ev1', 'b', false),
      respuesta('ev1', 'c', true)
    ]

    const actualizada = conPuntajesRecalculados([evaluacion], respuestas, itemsEvaluacion)

    expect(actualizada[0].puntuacion).toBe(75)
    expect(puntajeModuloDeRespuestas(respuestas, itemsEvaluacion, 'm1', 's1')).toBe(50)
    expect(puntajeModuloDeRespuestas(respuestas, itemsEvaluacion, 'm2', 's1')).toBe(100)
  })

  it('reemplaza una puntuación histórica con el cálculo actual que usa el detalle', () => {
    const evaluacion = mkEvaluacion('ev1', 's1', '2026-09-10', 60.73)
    const respuestas = [respuesta('ev1', 'i1', true)]

    const actualizada = conPuntajesRecalculados([evaluacion], respuestas, items)

    expect(actualizada[0].puntuacion).toBe(100)
    expect(actualizada[0].puntuacion).toBe(
      resumirEvaluacion(evaluacion, respuestas, items).puntaje
    )
    expect(evaluacion.puntuacion).toBe(60.73)
  })
})

describe('unidadDe · una evaluación mide una sola unidad', () => {
  it('devuelve la sucursal cuando no es de departamento', () => {
    expect(unidadDe({ sucursal_id: 's1', departamento_id: null })).toBe('s1')
  })

  it('devuelve el departamento cuando lo es', () => {
    expect(unidadDe({ sucursal_id: null, departamento_id: 'd1' })).toBe('d1')
  })

  it('sin unidad no inventa una: devuelve vacío', () => {
    expect(unidadDe({ sucursal_id: null, departamento_id: null })).toBe('')
  })
})

/* --- Seguimiento por cargo ------------------------------------------------ */

/**
 * `responsables` es lo que hay que configurarle al ítem para que un check
 * CUMPIDO le acredite la nota a alguien: cuando la respuesta sale bien no hay
 * selección del evaluador que repartir, el punto se acredita al cargo que tiene
 * asignado el ítem. Las fallas, en cambio, van a quien eligió el evaluador.
 *
 * `puntaje` 0 = ítem sin peso: no entra en el denominador de nadie, aunque una
 * falla ahí igual se registre.
 */
function itemSeg(id: string, texto: string, responsables?: string[], puntaje = 100): Item {
  return {
    id,
    modulo_id: 'm-seg',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto,
    opciones: [],
    orden: 0,
    requerido: false,
    activo: true,
    puntaje,
    ...(responsables ? { responsables } : {}),
    created_at: ''
  }
}

function respuestaSeg(
  evaluacionId: string,
  itemId: string,
  cumple: boolean,
  responsables: string[]
): Respuesta {
  return {
    id: `${evaluacionId}-${itemId}`,
    evaluacion_id: evaluacionId,
    item_id: itemId,
    instancia_id: null,
    valor: { value: cumple, responsables },
    respondido_por: null,
    created_at: ''
  }
}

function evSeg(
  id: string,
  sucursalId: string | null,
  departamentoId: string | null,
  nombre: string,
  fecha: string
): VistaEvaluacion {
  return {
    id,
    offline_uuid: id,
    sucursal_id: sucursalId,
    departamento_id: departamentoId,
    aperturada_por: 'user-test',
    fecha,
    estado: 'CERRADA',
    puntuacion: null,
    comentario_general: null,
    abierta_en: null,
    cerrada_en: null,
    created_at: '',
    sucursal: sucursalId
      ? { id: sucursalId, nombre, shop_id: null, branch_id: null, direccion: null }
      : null,
    departamento: departamentoId ? { id: departamentoId, nombre } : null,
    aperturador: null
  }
}

/**
 * Norte falla el ítem 1 con «Encargado de turno» pero acierta el ítem 2, que
 * está configurado para «Depositaría»; Sur repite ese primer cargo escrito
 * distinto y suma a Depositaría, que ahí falla; y Contabilidad —departamento,
 * sin sucursal— falla con un cargo propio.
 *
 * Ese acierto de Norte es lo que hace que las notas no sean todas 0: Depositaría
 * queda en 50% (100 de 200) y cierra la lista, mientras que los que sólo
 * fallaron van primero.
 */
function conjuntoSeguimiento(): ConjuntoDatos {
  const modulos: Modulo[] = [
    {
      id: 'm-seg',
      nombre: 'Higiene y seguridad',
      descripcion: '',
      orden: 0,
      activo: true,
      created_at: ''
    }
  ]
  const items: Item[] = [
    itemSeg('i-seg-1', 'EPP completo', ['Encargado de turno']),
    itemSeg('i-seg-2', 'Piso limpio', ['Depositaría']),
    // Sin responsables configurados: para el test de «no inventa un cargo».
    itemSeg('i-seg-3', 'Producto en góndola')
  ]
  const evaluaciones: VistaEvaluacion[] = [
    evSeg('evN', 'sN', null, 'Sucursal Norte', '2026-09-01'),
    evSeg('evS', 'sS', null, 'Sucursal Sur', '2026-09-15'),
    evSeg('evD', null, 'dC', 'Contabilidad', '2026-09-20')
  ]
  const respuestas: Respuesta[] = [
    respuestaSeg('evN', 'i-seg-1', false, ['Encargado de turno']),
    respuestaSeg('evN', 'i-seg-2', true, ['Depositaría']),
    respuestaSeg('evS', 'i-seg-1', false, ['encargado de Turno']),
    respuestaSeg('evS', 'i-seg-2', false, ['Depositaría']),
    respuestaSeg('evD', 'i-seg-1', false, ['Líder TH'])
  ]
  return { evaluaciones, respuestas, items, modulos, fotos: [], sucursalOpciones: [], instancias: [] }
}

/**
 * Un checklist de tres puntos respondido dos veces (una por sucursal) con sólo
 * el primero tildado, y SIN selección de responsables: el formato legado, el
 * que más pesa porque es con el que están las evaluaciones viejas.
 *
 * Ahí está el nudo del detalle: `incumplimientosPorResponsable` sabe que al
 * cargo le fallaron dos cosas pero sólo cuenta «2», y el ítem entero se llama
 * «Puntos de limpieza». Los nombres concretos —«Góndolas sin polvo», «Zona de
 * atrás ordenada»— sólo los puede dar el criterio de atribución de checks.
 */
function conjuntoChecklist(): ConjuntoDatos {
  const modulos: Modulo[] = [
    {
      id: 'm-seg',
      nombre: 'Higiene y seguridad',
      descripcion: '',
      orden: 0,
      activo: true,
      created_at: ''
    }
  ]
  const items: Item[] = [
    {
      id: 'i-chk',
      modulo_id: 'm-seg',
      tipo: 'CHECKLIST',
      texto: 'Puntos de limpieza',
      opciones: [
        { id: 'op-1', etiqueta: 'Piso lavado', responsable: 'Encargado de turno' },
        { id: 'op-2', etiqueta: 'Góndolas sin polvo', responsable: 'Encargado de turno' },
        { id: 'op-3', etiqueta: 'Zona de atrás ordenada', responsable: 'Encargado de turno' }
      ],
      orden: 0,
      requerido: false,
      activo: true,
      puntaje: 90,
      created_at: ''
    }
  ]
  const evaluaciones: VistaEvaluacion[] = [
    evSeg('evC1', 'sN', null, 'Sucursal Norte', '2026-09-01'),
    evSeg('evC2', 'sS', null, 'Sucursal Sur', '2026-09-15')
  ]
  const respuesta = (evaluacionId: string): Respuesta => ({
    id: `${evaluacionId}-i-chk`,
    evaluacion_id: evaluacionId,
    item_id: 'i-chk',
    instancia_id: null,
    valor: { selected: ['op-1'] },
    respondido_por: null,
    created_at: ''
  })
  return {
    evaluaciones,
    respuestas: [respuesta('evC1'), respuesta('evC2')],
    items,
    modulos,
    fotos: [],
    sucursalOpciones: [],
    instancias: []
  }
}

describe('seguimientoResponsables', () => {
  it('agrupa por clave normalizada: el mismo cargo escrito distinto es UNA fila', () => {
    const s = seguimientoResponsables(conjuntoSeguimiento())

    // Lo peor primero: nota 0 con más puntos, luego nota 0 con menos, y el que
    // acertó en alguna sucursal cierra la lista.
    expect(s.filas.map((f) => f.cargo)).toEqual(['Encargado de turno', 'Líder TH', 'Depositaría'])

    const encargado = s.filas[0]
    expect(encargado.clave).toBe('encargadodeturno')
    expect(encargado.puntos).toBe(2)
    expect(encargado.nota).toBe(0)
    expect(encargado.evaluaciones).toBe(2)
    expect(encargado.unidades).toBe(2)
    expect(encargado.ultima).toBe('2026-09-15')
  })

  it('la nota de la fila se pondera con logrado y posible, no promediando celdas', () => {
    const s = seguimientoResponsables(conjuntoSeguimiento())
    const depositaria = s.filas.find((f) => f.clave === 'depositaria')

    // Acertó en Norte (100 de 100) y falló en Sur (0 de 100): 50%, que es
    // 100/200 y no el promedio de 100% y 0% disfrazado de lo mismo.
    expect(depositaria?.porUnidad.sN).toEqual({ logrado: 100, posible: 100 })
    expect(depositaria?.porUnidad.sS).toEqual({ logrado: 0, posible: 100 })
    expect(depositaria?.nota).toBe(50)
  })

  it('reparte la base de la nota por unidad y ordena las sucursales por lo peor', () => {
    const s = seguimientoResponsables(conjuntoSeguimiento())

    expect(s.filas[0].porUnidad).toEqual({
      sN: { logrado: 0, posible: 100 },
      sS: { logrado: 0, posible: 100 }
    })
    expect(s.unidades).toEqual([
      { id: 'sS', nombre: 'Sucursal Sur', puntos: 2 },
      { id: 'dC', nombre: 'Contabilidad', puntos: 1 },
      { id: 'sN', nombre: 'Sucursal Norte', puntos: 1 }
    ])
  })

  it('la nota global es ponderada y cierra con la matriz', () => {
    const s = seguimientoResponsables(conjuntoSeguimiento())

    expect(s.nota).toBe(20) // 100 logrados sobre 500 posibles
    expect(s.puntos).toBe(4)
  })

  it('la evaluación de departamento entra con su nombre, no como una sucursal sin nombre', () => {
    const s = seguimientoResponsables(conjuntoSeguimiento())

    expect(s.filas.find((f) => f.clave === 'liderth')?.porUnidad).toEqual({
      dC: { logrado: 0, posible: 100 }
    })
  })

  it('un cargo sin base medible queda sin nota y va al final de la lista', () => {
    const datos = conjuntoSeguimiento()
    datos.items.push(itemSeg('i-seg-9', 'Sin peso', [], 0))
    datos.respuestas.push(respuestaSeg('evD', 'i-seg-9', false, ['Jefe de depósito']))

    const s = seguimientoResponsables(datos)
    const ultima = s.filas[s.filas.length - 1]

    expect(ultima.cargo).toBe('Jefe de depósito')
    expect(ultima.nota).toBeNull()
    expect(ultima.puntos).toBe(1)
  })

  it('una respuesta cumplida le da nota al cargo configurado, no a la selección', () => {
    const datos = conjuntoSeguimiento()
    datos.respuestas.push(respuestaSeg('evN', 'i-seg-2', true, ['Limpieza']))

    expect(seguimientoResponsables(datos).filas.some((f) => f.clave === 'limpieza')).toBe(false)
  })

  it('una respuesta sin responsables no inventa un cargo', () => {
    const datos = conjuntoSeguimiento()
    datos.respuestas.push(respuestaSeg('evN', 'i-seg-3', false, []))

    expect(seguimientoResponsables(datos).filas.map((f) => f.clave)).toEqual([
      'encargadodeturno',
      'liderth',
      'depositaria'
    ])
  })
})

describe('rankingResponsables', () => {
  it('ordena por porcentaje de resultado, no por puntos no cumplidos', () => {
    const top = rankingResponsables(conjuntoSeguimiento(), 2)

    // Por puntos el segundo sería Depositaría (1 punto, 50%): acá la lista la
    // abre el resultado —Encargado 0% y Líder TH 0%—, no la cantidad de fallas.
    expect(top.map((f) => f.cargo)).toEqual(['Encargado de turno', 'Líder TH'])
    expect(top[0].nota).toBe(0)
    expect(top[1].nota).toBe(0)
  })

  it('es el mismo ranking que la página de seguimiento por cargo', () => {
    const datos = conjuntoSeguimiento()

    expect(rankingResponsables(datos, 20)).toEqual(seguimientoResponsables(datos).filas)
  })

  it('el límite corta al final: un cargo sin nota no pasa en el top', () => {
    const datos = conjuntoSeguimiento()
    datos.items.push(itemSeg('i-seg-9', 'Sin peso', ['Jefe de depósito'], 0))
    datos.respuestas.push(respuestaSeg('evD', 'i-seg-9', false, ['Jefe de depósito']))

    expect(rankingResponsables(datos, 3).map((f) => f.cargo)).toEqual([
      'Encargado de turno',
      'Líder TH',
      'Depositaría'
    ])
  })
})

describe('hallazgosDeCargo', () => {
  it('devuelve el detalle con evaluación, unidad, módulo e ítem', () => {
    const h = hallazgosDeCargo(conjuntoSeguimiento(), 'encargado de turno')

    expect(h).toHaveLength(2)
    expect(h[0]).toMatchObject({
      evaluacion_id: 'evS',
      unidad: 'Sucursal Sur',
      modulo: 'Higiene y seguridad',
      item_id: 'i-seg-1',
      item: 'EPP completo'
    })
    // Un CUMPLE_NO_CUMPLE no tiene nada más que el ítem entero: no hay checks
    // que nombrar, y decir «EPP completo» otra vez sería repetir el título.
    expect(h[0].checks).toEqual([])
    expect(h[1].evaluacion_id).toBe('evN')
  })

  it('acepta cualquier forma del cargo: usa la misma clave que la matriz', () => {
    expect(hallazgosDeCargo(conjuntoSeguimiento(), 'ENCARGADO DE TURNO')).toHaveLength(2)
  })

  it('filtra por unidad, como cuando se pulsa una celda de la matriz', () => {
    const h = hallazgosDeCargo(conjuntoSeguimiento(), 'Encargado de turno', 'sN')

    expect(h).toHaveLength(1)
    expect(h[0].unidad).toBe('Sucursal Norte')
  })

  it('nombra los checks concretos de un checklist, no sólo el ítem', () => {
    const h = hallazgosDeCargo(conjuntoChecklist(), 'Encargado de turno')

    expect(h).toHaveLength(2)
    expect(h[0].item).toBe('Puntos de limpieza')
    expect(h[0].checks).toEqual(['Góndolas sin polvo', 'Zona de atrás ordenada'])
  })
})

describe('resumirFallasPorItem', () => {
  it('agrupa por ítem y cuenta las veces de cada check y de cada unidad', () => {
    const filas = resumirFallasPorItem(hallazgosDeCargo(conjuntoChecklist(), 'Encargado de turno'))

    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({
      item: 'Puntos de limpieza',
      modulo: 'Higiene y seguridad',
      veces: 2,
      ultima: '2026-09-15'
    })
    // Los dos checks cayeron en las dos evaluaciones: con esto alcanza para
    // decir «se repite», sin listar seis renglones.
    expect(filas[0].checks).toEqual([
      { texto: 'Góndolas sin polvo', veces: 2 },
      { texto: 'Zona de atrás ordenada', veces: 2 }
    ])
    expect(filas[0].unidades).toEqual([
      { nombre: 'Sucursal Norte', veces: 1 },
      { nombre: 'Sucursal Sur', veces: 1 }
    ])
  })

  it('deja un solo renglón por ítem aunque caiga en varias evaluaciones', () => {
    const filas = resumirFallasPorItem(hallazgosDeCargo(conjuntoSeguimiento(), 'Encargado de turno'))

    // Norte y Sur escriben el cargo distinto pero es el mismo, y las dos
    // evaluaciones cayeron en el mismo ítem: un renglón, dos veces.
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ item_id: 'i-seg-1', item: 'EPP completo', veces: 2 })
    expect(filas[0].checks).toEqual([])
    expect(filas[0].unidades).toEqual([
      { nombre: 'Sucursal Norte', veces: 1 },
      { nombre: 'Sucursal Sur', veces: 1 }
    ])
  })
})