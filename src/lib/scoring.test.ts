import { describe, it, expect } from 'vitest'
import { calcularPuntaje, valorBinario, conciliacionPorcentaje, conciliacionTotal, incumplimientosPorResponsable } from './scoring'

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

  it('conciliacion total es el promedio de las conciliaciones de cada SKU', () => {
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: 10 }, { sku: 'B', nombre: null, teorica: 10, fisica: 5 }] })).toBe(75)
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 150, fisica: 160 }, { sku: 'B', nombre: null, teorica: 48, fisica: 39 }] })).toBe(87.5)
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