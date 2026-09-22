import { describe, it, expect } from 'vitest'
import { calcularPuntaje, valorBinario, conciliacionPorcentaje, conciliacionTotal, conciliacionEnRango } from './scoring'

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
    expect(valorBinario(item, { selected: ['a'] })).toBe(false)
    expect(valorBinario(item, null)).toBe(null)
    expect(valorBinario(item, { selected: [] })).toBe(null)
  })
  it('tipos cualitativos no puntuan', () => {
    expect(valorBinario({ tipo: 'COMENTARIO' }, 'texto')).toBe(null)
    expect(valorBinario({ tipo: 'FOTO' }, { photoIds: ['x'] })).toBe(null)
    expect(valorBinario({ tipo: 'CANTIDAD' }, 5)).toBe(null)
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
  it('conciliacion usa la tolerancia configurada por departamento', () => {
    const dentro = { sku: 'A', teorica: 10, fisica: 10.4, tolerancia: 5 }
    const fuera = { sku: 'B', teorica: 10, fisica: 8, tolerancia: 5 }
    const sinTol = { sku: 'C', teorica: 10, fisica: 9, tolerancia: null }
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [dentro] })).toBe(true)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [fuera] })).toBe(false)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [sinTol] })).toBe(false)
  })
  it('conciliacionEnRango aplica un % de desviacion sobre el 100%', () => {
    expect(conciliacionEnRango({ teorica: 10, fisica: 10 }, 5)).toBe(true)
    expect(conciliacionEnRango({ teorica: 10, fisica: 10.4 }, 5)).toBe(true)
    expect(conciliacionEnRango({ teorica: 10, fisica: 10.6 }, 5)).toBe(false)
    expect(conciliacionEnRango({ teorica: 10, fisica: 9.6 }, 5)).toBe(true)
    expect(conciliacionEnRango({ teorica: 10, fisica: 9 }, 5)).toBe(false)
    expect(conciliacionEnRango({ teorica: 10, fisica: 12 }, null)).toBe(false)
    expect(conciliacionEnRango({ teorica: 0, fisica: 5 }, 5)).toBe(null)
  })
  it('conciliacion porcentaje puede superar el 100 (sobre-stock)', () => {
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 10 })).toBe(100)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 5 })).toBe(50)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 12 })).toBe(120)
    expect(conciliacionPorcentaje({ teorica: 0, fisica: 5 })).toBe(null)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: null })).toBe(null)
    expect(conciliacionPorcentaje(null)).toBe(null)
  })
  it('conciliacion total pondera por cantidades', () => {
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, departamento_id: null, departamento_nombre: null, tolerancia: null, teorica: 10, fisica: 10 }, { sku: 'B', nombre: null, departamento_id: null, departamento_nombre: null, tolerancia: null, teorica: 10, fisica: 5 }] })).toBe(75)
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
      { item: { tipo: 'COMENTARIO' }, valor: 'zona de frescos' }
    ]
    expect(calcularPuntaje(resps)).toBe(66.67)
  })
  it('null sin binarios', () => {
    expect(calcularPuntaje([{ item: { tipo: 'COMENTARIO' }, valor: 'x' }])).toBe(null)
    expect(calcularPuntaje([])).toBe(null)
  })
})