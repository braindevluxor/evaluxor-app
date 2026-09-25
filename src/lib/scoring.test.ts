import { describe, it, expect } from 'vitest'
import { calcularPuntaje, valorBinario, proporcionChecklist, proporcionItem, pesoItem, conciliacionPorcentaje, conciliacionTotal, incumplimientosPorResponsable, agregarPuntaje, redondear3, valorPorResponsable } from './scoring'

describe('valorBinario', () => {
  it('cumple/no cumple', () => {
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true })).toBe(true)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false })).toBe(false)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, null)).toBe(null)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: null })).toBe(null)
  })
  it('checklist cumple solo si todas las opciones estan marcadas', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(valorBinario(item, { selected: ['a', 'b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], evidencias: { b: { photoIds: ['x'] } } })).toBe(true)
    expect(valorBinario(item, { selected: ['a'] })).toBe(false)
    expect(valorBinario(item, null)).toBe(null)
    expect(valorBinario(item, { selected: [] })).toBe(null)
  })
  it('tipos no puntuables no puntuan', () => {
    expect(valorBinario({ tipo: 'OTRO' }, 'texto')).toBe(null)
    expect(valorBinario({ tipo: 'OTRO' }, { photoIds: ['x'] })).toBe(null)
    expect(valorBinario({ tipo: 'OTRO' }, 5)).toBe(null)
  })
  it('informativo no descuenta puntos', () => {
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'A', teorica: 10, fisica: 9 }], informativo: true })).toBe(null)
  })
  it('checklist excluye opciones informativas', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(valorBinario(item, { selected: ['a'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a'], informativos: ['a'] })).toBe(false)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['a', 'b'] })).toBe(null)
    expect(valorBinario(item, { selected: [], informativos: ['b'] })).toBe(null)
  })
  it('informativo no descuenta puntos', () => {
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'A', teorica: 10, fisica: 9 }], informativo: true })).toBe(null)
  })
  it('checklist excluye opciones informativas', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(valorBinario(item, { selected: ['a'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a'], informativos: ['a'] })).toBe(false)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['a', 'b'] })).toBe(null)
    expect(valorBinario(item, { selected: [], informativos: ['b'] })).toBe(null)
  })
  it('conciliacion cumple cuando fisica coincide con teorica en todos los productos', () => {
    const ok = { sku: 'A', teorica: 10, fisica: 10 }
    const mal = { sku: 'B', teorica: 10, fisica: 9 }
    const incompleto = { sku: 'C', teorica: null, fisica: 9 }
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [ok] })).toBe(true)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [ok, mal] })).toBe(false)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [incompleto] })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [] })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, null)).toBe(null)
  })
  it('listado de colaboradores cumple cuando todos los que aplican tienen su checklist completo', () => {
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }, { id: 'b' }] }
    const col = (selected: string[], aplica = true) => ({ dni: 1, name: 'A', lastname: 'B', active: true, aplica, selected })
    expect(valorBinario(item, { colaboradores: [col(['a', 'b']), col(['a', 'b'])] })).toBe(true)
    expect(valorBinario(item, { colaboradores: [col(['a', 'b']), col(['a'])] })).toBe(false)
    expect(valorBinario(item, { colaboradores: [col(['a', 'b']), col([], false)] })).toBe(true)
    expect(valorBinario(item, { colaboradores: [] })).toBe(null)
    expect(valorBinario(item, null)).toBe(null)
    expect(valorBinario(item, { colaboradores: [col(['a', 'b'])], informativo: true })).toBe(null)
  })
  it('unidad checklist cumple cuando todas las unidades tienen su checklist completo', () => {
    const item = { tipo: 'UNIDAD_CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    const unidad = (selected: string[]) => ({ codigo: `U-${selected.join('')}`, selected })
    expect(valorBinario(item, { unidades: [unidad(['a', 'b']), unidad(['a', 'b'])] })).toBe(true)
    expect(valorBinario(item, { unidades: [unidad(['a', 'b']), unidad(['a'])] })).toBe(false)
    expect(valorBinario(item, { unidades: [] })).toBe(null)
    expect(valorBinario(item, null)).toBe(null)
    expect(valorBinario(item, { unidades: [unidad(['a', 'b'])], informativo: true })).toBe(null)
  })
it('conciliacion porcentaje: si pasa de 100 se resta el excedente, si no queda como esta', () => {
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 10 })).toBe(100)
    expect(conciliacionPorcentaje({ teorica: 48, fisica: 39 })).toBe(81.25)
    expect(conciliacionPorcentaje({ teorica: 150, fisica: 160 })).toBe(93.75)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 5 })).toBe(50)
    expect(conciliacionPorcentaje({ teorica: 0, fisica: 5 })).toBe(null)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: null })).toBe(null)
    expect(conciliacionPorcentaje(null)).toBe(null)
  })

  it('conciliacion total es la tasa de productos sin coincidir sobre los escaneados', () => {
    // A coincide (10/10) y B no (10/5) → 1 de 2 sin coincidir = 50
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: 10 }, { sku: 'B', nombre: null, teorica: 10, fisica: 5 }] })).toBe(50)
    // Ninguno coincide → 100
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 150, fisica: 160 }, { sku: 'B', nombre: null, teorica: 48, fisica: 39 }] })).toBe(100)
    // Todos coinciden (incluido stock 0/0) → 0
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: 10 }, { sku: 'B', nombre: null, teorica: 0, fisica: 0 }] })).toBe(0)
    // Solo cuentan los escaneados con ambas cantidades cargadas
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: null }] })).toBe(null)
    expect(conciliacionTotal({ productos: [] })).toBe(null)
    expect(conciliacionTotal(null)).toBe(null)
  })
})

describe('calcularPuntaje', () => {
  it('porcentaje de cumplimiento', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: false } },
      { item: { tipo: 'OTRO' }, valor: 'zona de frescos' }
    ]
    expect(calcularPuntaje(resps)).toBe(66.67)
  })
  it('informativo excluido del total de calcularPuntaje', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: false, informativo: true } }
    ]
    expect(calcularPuntaje(resps)).toBe(100)
  })
  it('null sin binarios', () => {
    expect(calcularPuntaje([{ item: { tipo: 'OTRO' }, valor: 'x' }])).toBe(null)
    expect(calcularPuntaje([])).toBe(null)
  })
  it('pondera por los puntos asignados a cada ítem', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 30 }, valor: { value: false } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20 }, valor: { value: false } }
    ]
    expect(calcularPuntaje(resps)).toBe(50)
    expect(calcularPuntaje([...resps, { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: true } }])).toBe(66.67)
  })
  it('resta los puntos de ítems informativos aunque tengan puntaje', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: false, informativo: true } }
    ]
    expect(calcularPuntaje(resps)).toBe(100)
  })
  it('sin puntos asignados reparte de forma igualitaria', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: false } }
    ]
    expect(calcularPuntaje(resps)).toBe(50)
  })
})

describe('incumplimientosPorResponsable', () => {
  it('checklist acumula cada punto sin marcar a su responsable', () => {
    const item = {
      tipo: 'CHECKLIST',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' },
        { id: 'c', etiqueta: 'C' }
      ]
    }
    expect(incumplimientosPorResponsable(item, { selected: ['a'] })).toEqual([{ responsable: 'Chofer', puntos: 1 }])
    expect(incumplimientosPorResponsable(item, { selected: [] })).toEqual([])
    expect(incumplimientosPorResponsable(item, null)).toEqual([])
  })
  it('checklist no acumula puntos informativos ni los ya marcados', () => {
    const item = {
      tipo: 'CHECKLIST',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' }
      ]
    }
    expect(incumplimientosPorResponsable(item, { selected: ['a'], informativos: ['b'] })).toEqual([])
    expect(incumplimientosPorResponsable(item, { selected: ['a', 'b'], informativos: [] })).toEqual([])
  })
  it('unidad checklist suma el punto faltante por cada unidad', () => {
    const item = {
      tipo: 'UNIDAD_CHECKLIST',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' }
      ]
    }
    const v = { unidades: [{ codigo: 'U1', selected: ['a'] }, { codigo: 'U2', selected: ['a'] }] }
    expect(incumplimientosPorResponsable(item, v)).toEqual([{ responsable: 'Chofer', puntos: 2 }])
  })
  it('lista de colaboradores ignora a los que no aplican', () => {
    const item = {
      tipo: 'LISTA_COLABORADORES',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' }
      ]
    }
    const col = (aplica: boolean, selected: string[]) => ({ dni: 1, name: 'A', lastname: 'B', active: true, aplica, selected })
    const v = { colaboradores: [col(true, ['a']), col(false, [])] }
    expect(incumplimientosPorResponsable(item, v)).toEqual([{ responsable: 'Chofer', puntos: 1 }])
  })
  it('tipos sin puntos con responsable no acumulan', () => {
    expect(incumplimientosPorResponsable({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false })).toEqual([])
    expect(incumplimientosPorResponsable({ tipo: 'CONCILIACION', opciones: [{ id: 'a', responsable: 'X' }] }, { productos: [{ sku: 'A', teorica: 2, fisica: 1 }] })).toEqual([])
  })
})

describe('proporcionChecklist', () => {
  const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a', puntos: 3 }, { id: 'b', puntos: 1 }, { id: 'c', puntos: 2 }] }

  it('reparte la proporcion segun los puntos de las opciones marcadas', () => {
    expect(proporcionChecklist(item, { selected: ['a', 'b', 'c'] })).toBe(1)
    expect(proporcionChecklist(item, { selected: ['a'] })).toBe(0.5) // 3/6
    expect(proporcionChecklist(item, { selected: ['c'] })).toBe(1 / 3) // 2/6
    expect(proporcionChecklist(item, { selected: ['b'] })).toBe(1 / 6) // 1/6
    expect(proporcionChecklist(item, { selected: ['a', 'b'] })).toBe(2 / 3) // 4/6
  })

  it('sin respuesta o sin opciones relevantes no es puntuable', () => {
    expect(proporcionChecklist(item, null)).toBe(null)
    expect(proporcionChecklist(item, { selected: [] })).toBe(null)
    expect(proporcionChecklist({ tipo: 'CHECKLIST', opciones: [] }, { selected: ['a'] })).toBe(null)
  })

  it('excluye las opciones informativas del calculo', () => {
    expect(proporcionChecklist(item, { selected: ['a'], informativos: ['b', 'c'] })).toBe(1)
    expect(proporcionChecklist(item, { selected: [], informativos: ['a', 'b', 'c'] })).toBe(null)
  })

  it('no es proporcional si alguna opcion no tiene puntos (todo o nada)', () => {
    expect(proporcionChecklist({ tipo: 'CHECKLIST', opciones: [{ id: 'a', puntos: 3 }, { id: 'b' }] }, { selected: ['a'] })).toBe(null)
    expect(proporcionChecklist({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }, { selected: ['a', 'b'] })).toBe(null)
  })
})

describe('checklist con opciones de rango', () => {
  type OpcionRango = { id: string; tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number; puntos?: number }
  const item: { tipo: 'CHECKLIST'; opciones: OpcionRango[] } = {
    tipo: 'CHECKLIST',
    opciones: [
      { id: 'a', tipo_respuesta: 'RANGO', minimo: 30, puntos: 4 },
      { id: 'b', puntos: 2 }
    ]
  }

  it('valorBinario: el rango solo cumple si el valor alcanza el minimo', () => {
    expect(valorBinario(item, { selected: ['a', 'b'], valores: { a: 40 } })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], valores: { a: 30 } })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], valores: { a: 25 } })).toBe(false)
    expect(valorBinario(item, { selected: ['a', 'b'] })).toBe(false)
    expect(valorBinario(item, { selected: ['b'], valores: { a: 40 } })).toBe(false)
  })

  it('proporcionChecklist: el rango cumplido suma sus puntos y el no cumplido no', () => {
    expect(proporcionChecklist(item, { selected: ['a', 'b'], valores: { a: 40 } })).toBe(1)
    expect(proporcionChecklist(item, { selected: ['a', 'b'], valores: { a: 10 } })).toBe(2 / 6) // solo b
    expect(proporcionChecklist(item, { selected: ['a'], valores: { a: 40 } })).toBe(4 / 6) // solo a
  })

  it('sin minimo configurado el rango no cumple aunque tenga valor', () => {
    const sinMinimo: { tipo: 'CHECKLIST'; opciones: OpcionRango[] } = { tipo: 'CHECKLIST', opciones: [{ id: 'a', tipo_respuesta: 'RANGO', puntos: 4 }] }
    expect(valorBinario(sinMinimo, { selected: ['a'], valores: { a: 50 } })).toBe(false)
  })
})

describe('secciones CONTENEDOR', () => {
  const seccion = { id: 's1', tipo: 'CONTENEDOR', puntaje: 0 }

  it('no puntúan: valorBinario y proporcionItem devuelven null', () => {
    expect(valorBinario(seccion, null)).toBeNull()
    expect(proporcionItem(seccion, null)).toBeNull()
    expect(proporcionItem(seccion, { selected: ['a'] })).toBeNull()
  })

  it('pesoItem devuelve 0 aunque tengan puntaje residual', () => {
    expect(pesoItem(seccion)).toBe(0)
    expect(pesoItem({ puntaje: 50 })).toBe(50)
  })
})

describe('calcularPuntaje con checklist proporcional', () => {
  it('reparte el peso del item segun los puntos de las opciones marcadas', () => {
    const checklist = { tipo: 'CHECKLIST', puntaje: 10, opciones: [{ id: 'a', puntos: 3 }, { id: 'b', puntos: 1 }, { id: 'c', puntos: 2 }] }
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 10 }, valor: { value: true } }, // 10 pts
      { item: checklist, valor: { selected: ['a'] } } // 10 pts * (3/6) = 5
    ]
    expect(calcularPuntaje(resps)).toBe(75)
  })

  it('checklist sin puntos por opcion sigue siendo todo o nada', () => {
    const item = { tipo: 'CHECKLIST', puntaje: 10, opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(calcularPuntaje([{ item, valor: { selected: ['a', 'b'] } }])).toBe(100)
    expect(calcularPuntaje([{ item, valor: { selected: ['a'] } }])).toBe(0)
  })
})

describe('calcularPuntaje con registros (secciones repetibles)', () => {
  const item = { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 10 }

  it('promedia el mismo ítem entre sus registros', () => {
    expect(calcularPuntaje([
      { item, valor: { value: true } },
      { item, valor: { value: false } }
    ])).toBe(50)
  })

  it('un solo registro mantiene el puntaje normal', () => {
    expect(calcularPuntaje([{ item, valor: { value: true } }])).toBe(100)
    expect(calcularPuntaje([{ item, valor: { value: false } }])).toBe(0)
  })

  it('tres registros con dos en regla pesan ~2/3', () => {
    expect(calcularPuntaje([
      { item, valor: { value: true } },
      { item, valor: { value: true } },
      { item, valor: { value: false } }
    ])).toBe(66.67)
  })
})

describe('secciones ponderadas', () => {
  const seccion = { id: 's1', tipo: 'CONTENEDOR', puntaje: 60 }
  const hijo = (id: string, puntaje: number) => ({ id, tipo: 'CUMPLE_NO_CUMPLE', puntaje, padre_id: 's1' })
  const entries = (cumplen: Record<string, boolean | number>) => [
    { item: seccion, cumple: null },
    ...Object.entries(cumplen).map(([id, c]) => ({ item: hijo(id, 20), cumple: c }))
  ]

  it('la sección ponderada pesa en el módulo y agrupa a sus hijos', () => {
    // Tres hijos de 20: dos cumplen → 2/3 de la sección (60) → 40 de 60.
    expect(agregarPuntaje(entries({ h1: true, h2: true, h3: false }))).toBe(66.67)
  })

  it('la sección no puede superar su peso: hijos que suman menos alzan el máximo', () => {
    // Hijos que suman menos que la sección: cumplimiento completo = 100% de lo que suman.
    const seccionP = { id: 'p1', tipo: 'CONTENEDOR', puntaje: 60 }
    const hijos = [
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 30, padre_id: 'p1' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 10, padre_id: 'p1' }, cumple: true },
      { item: seccionP, cumple: null }
    ]
    expect(agregarPuntaje(hijos)).toBe(100)
  })

  it('hijo incumplido resta solo su peso dentro del grupo', () => {
    const hijos = [
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'c', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: false },
      { item: seccion, cumple: null }
    ]
    expect(agregarPuntaje(hijos)).toBe(66.67)
  })

  it('sin la sección en la lista, los hijos se cuentan directos (respaldo)', () => {
    // Comportamiento previo para datos existentes: la sección no aparece en las respuestas.
    const hijos = [
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'c', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: false }
    ]
    expect(agregarPuntaje(hijos)).toBe(66.67)
  })

  it('sección sin puntaje no participa y sus hijos siguen directos', () => {
    const seccion0 = { id: 's0', tipo: 'CONTENEDOR', puntaje: 0 }
    const r = agregarPuntaje([
      { item: seccion0, cumple: null },
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's0' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's0' }, cumple: false }
    ])
    expect(r).toBe(50)
  })

  it('calcularPuntaje agrupa secciones dentro de una evaluación', () => {
    const seccionE = { id: 'sec1', tipo: 'CONTENEDOR', puntaje: 60 }
    const hijoE = (id: string, puntaje: number) => ({ id, tipo: 'CUMPLE_NO_CUMPLE', puntaje, padre_id: 'sec1' })
    const resps = [
      { item: hijoE('h1', 20), valor: { value: true } },
      { item: hijoE('h2', 20), valor: { value: true } },
      { item: hijoE('h3', 20), valor: { value: false } },
      { item: seccionE, valor: undefined }
    ]
    expect(calcularPuntaje(resps)).toBe(66.67)
  })

  it('sección con checklist proporcional entre sus hijos', () => {
    const seccionC = { id: 'sec2', tipo: 'CONTENEDOR', puntaje: 100 }
    const checklist = { id: 'ch1', tipo: 'CHECKLIST', puntaje: 100, padre_id: 'sec2', opciones: [{ id: 'a', puntos: 3 }, { id: 'b', puntos: 1 }, { id: 'c', puntos: 2 }] }
    const resps = [
      { item: checklist, valor: { selected: ['a'] } }, // 3/6
      { item: seccionC, valor: undefined }
    ]
    expect(calcularPuntaje(resps)).toBe(50)
  })

  it('redondear3 deja hasta 3 decimales y respeta 6/15 = 0.4', () => {
    expect(redondear3(6 / 15)).toBe(0.4)
    expect(redondear3(1 / 3)).toBe(0.333)
    expect(redondear3(0.0006)).toBe(0.001)
    expect(redondear3(2.34567)).toBe(2.346)
  })
})

describe('valorPorResponsable', () => {
  const itemCon = (id: string, tipo: string, puntaje: number, participantes: string[]) => ({
    id,
    tipo,
    puntaje,
    opciones: participantes.map((p) => ({ id: `o-${id}-${p}`, responsable: p })),
    responsables: participantes
  })

  it('reparte cada ítem entre sus responsables y reconstruye los 100 puntos', () => {
    // Ejercicio: 4 ítems de 25 pts. ítem1 abarca 4 responsables, ítem2 abarca 3,
    // ítem3 e ítem4 abarcan 2. Reparto: 25/4, 25/3, 25/2, 25/2.
    const items = [
      itemCon('i1', 'CHECKLIST', 25, ['Ana', 'Beto', 'Caro', 'Dani']),
      itemCon('i2', 'CHECKLIST', 25, ['Ana', 'Beto', 'Caro']),
      itemCon('i3', 'CHECKLIST', 25, ['Ana', 'Beto']),
      itemCon('i4', 'CHECKLIST', 25, ['Ana', 'Beto'])
    ]
    const v = valorPorResponsable(items)
    const por = Object.fromEntries(v.map((x) => [x.responsable, x.posible]))
    expect(por['Ana']).toBeCloseTo(6.25 + 25 / 3 + 12.5 + 12.5, 2) // 39.583
    expect(por['Beto']).toBeCloseTo(6.25 + 25 / 3 + 12.5 + 12.5, 2)
    expect(por['Caro']).toBeCloseTo(6.25 + 25 / 3, 2) // 14.583 (solo ítems 1 y 2)
    expect(por['Dani']).toBeCloseTo(6.25, 2)
    expect(v.reduce((a, x) => a + x.posible, 0)).toBeCloseTo(100, 1)
    expect(v.reduce((a, x) => a + x.items, 0)).toBe(11)
  })

  it('con respuestas: el cumplimiento del ítem pondera la parte de cada responsable', () => {
    const items = [itemCon('i1', 'CUMPLE_NO_CUMPLE', 25, ['Ana', 'Beto', 'Caro', 'Dani'])]
    const ok = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: true } }])
    for (const x of ok) {
      expect(x.posible).toBeCloseTo(6.25, 2)
      expect(x.logrado).toBeCloseTo(6.25, 2)
      expect(x.porciento).toBe(100)
    }
    const no = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: false } }])
    for (const x of no) expect(x.logrado).toBe(0)
  })

  it('con puntaje parcial (checklist con puntos por opción) el responsable gana su parte proporcional', () => {
    const items = [{
      id: 'i1',
      tipo: 'CHECKLIST',
      puntaje: 60,
      opciones: [{ id: 'a', responsable: 'Ana', puntos: 3 }, { id: 'b', responsable: 'Ana', puntos: 1 }, { id: 'c', responsable: 'Beto', puntos: 2 }],
      responsables: ['Ana', 'Beto']
    }]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { selected: ['a'] } }])
    const ana = v.find((x) => x.responsable === 'Ana')!
    const beto = v.find((x) => x.responsable === 'Beto')!
    expect(ana.posible).toBeCloseTo(30, 2)
    expect(ana.logrado).toBeCloseTo(15, 2) // 3/6 de la proporción → 30 × 0.5
    expect(ana.porciento).toBe(50)
    expect(beto.porciento).toBe(50)
  })

  it('ítems sin responsables o sin puntaje no generan valor', () => {
    const v = valorPorResponsable([
      { id: 'a', tipo: 'CHECKLIST', puntaje: 25, opciones: [] },
      { id: 'b', tipo: 'CHECKLIST', puntaje: 0, opciones: [{ id: 'x', responsable: 'Ana' }] },
      { id: 'c', tipo: 'CONTENEDOR', puntaje: 60, responsables: ['Ana'] }
    ])
    expect(v).toEqual([])
  })

  it('si ningún check tiene responsable, usa la lista del ítem', () => {
    const v = valorPorResponsable([
      { id: 'a', tipo: 'CHECKLIST', puntaje: 10, opciones: [{ id: 'x' }], responsables: ['Ana', 'Beto'] }
    ])
    expect(v.map((x) => x.posible)).toEqual([5, 5])
  })

  it('Pablo: 52.4 logrado sobre 67.3 posible = 77.86%', () => {
    // Cada responsable cubre su participación al 100%: % = logrado ÷ posible.
    const items = [{
      id: 'i1',
      tipo: 'CHECKLIST',
      puntaje: 67.3,
      responsables: ['Pablo'],
      opciones: [
        { id: 'a', puntos: 14.9, responsable: 'Pablo' },
        { id: 'b', puntos: 52.4, responsable: 'Pablo' }
      ]
    }]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { selected: ['b'] } }])
    const pablo = v.find((x) => x.responsable === 'Pablo')!
    expect(pablo.posible).toBe(67.3)
    expect(pablo.logrado).toBeCloseTo(52.4, 2)
    expect(pablo.porciento).toBe(77.86)
  })
})