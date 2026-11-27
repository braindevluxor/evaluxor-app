import { describe, expect, it } from 'vitest'
import { trabajoProcesandoVencido } from './sync'

describe('trabajoProcesandoVencido', () => {
  const ahora = 1_800_000_000_000

  it('recupera trabajos processing heredados sin marca de inicio', () => {
    expect(trabajoProcesandoVencido({ status: 'processing' }, ahora)).toBe(true)
  })

  it('no interrumpe un intento reciente', () => {
    expect(trabajoProcesandoVencido({ status: 'processing', processing_at: ahora - 60_000 }, ahora)).toBe(false)
  })

  it('recupera un intento que lleva más de quince minutos', () => {
    expect(trabajoProcesandoVencido({ status: 'processing', processing_at: ahora - 15 * 60_000 }, ahora)).toBe(true)
  })

  it('no modifica un trabajo pendiente', () => {
    expect(trabajoProcesandoVencido({ status: 'pending' }, ahora)).toBe(false)
  })
})
