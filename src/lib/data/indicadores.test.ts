import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Item, Modulo, Opcion, Respuesta, Sucursal, SucursalModulo, VistaEvaluacion } from '../types'
import { medidoresPorModulo, puntajePorSucursalModulo, resumenItemsModulo, barrasModulo, itemsDelModulo, sucursalesConModuloEvaluado, renglonesDrilldown, detalleDeEvaluacion, puntajeEnCurso, type ConjuntoDatos } from './indicadores'

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
    expect(lista.promedio).toBe(0.5)
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
    expect(detalle[0].peso).toBe(100)
    expect(detalle[1].cumple).toBe(false)
    expect(detalle[1].resumen).toBe('No cumple')
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