import { describe, it, expect } from 'vitest'
import { calcularPuntaje, valorBinario, conciliacionPorcentaje, conciliacionTotal } from './scoring'

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
  it('conciliacion porcentaje redondea a maximo 100', () => {
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 10 })).toBe(100)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 5 })).toBe(50)
    expect(conciliacionPorcentaje({ teorica: 0, fisica: 5 })).toBe(null)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: null })).toBe(null)
    expect(conciliacionPorcentaje(null)).toBe(null)
  })
  it('conciliacion total pondera por cantidades', () => {
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: 10 }, { sku: 'B', nombre: null, teorica: 10, fisica: 5 }] })).toBe(75)
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