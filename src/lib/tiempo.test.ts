import { describe, expect, it } from 'vitest'
import {
  antiguedadMs,
  COLOR_ESTADO_SYNC,
  desdeAhora,
  estadoSync,
  formatearFechaHora,
  TEXTO_ESTADO_SYNC
} from './tiempo'

const AHORA = new Date('2026-09-29T18:00:00Z').getTime()
const hace = (ms: number) => new Date(AHORA - ms).toISOString()

describe('última sincronización · formato', () => {
  it('antiguedadMs tolera ausente, inválida y futura', () => {
    expect(antiguedadMs(null)).toBe(null)
    expect(antiguedadMs(undefined)).toBe(null)
    expect(antiguedadMs('no-es-fecha')).toBe(null)
    expect(antiguedadMs(hace(5 * 60_000), AHORA)).toBe(5 * 60_000)
    // Una marca del futuro (reloj desfasado) no da antiguedad negativa.
    expect(antiguedadMs(new Date(AHORA + 60_000).toISOString(), AHORA)).toBe(0)
  })

  it('desdeAhora usa la escala correcta', () => {
    expect(desdeAhora(null, AHORA)).toBe('Sin datos')
    expect(desdeAhora(hace(20_000), AHORA)).toBe('recién')
    expect(desdeAhora(hace(5 * 60_000), AHORA)).toBe('hace 5 min')
    expect(desdeAhora(hace(3 * 3_600_000), AHORA)).toBe('hace 3 h')
    expect(desdeAhora(hace(23 * 3_600_000), AHORA)).toBe('hace 23 h')
    expect(desdeAhora(hace(26 * 3_600_000), AHORA)).toBe('ayer')
    expect(desdeAhora(hace(3 * 86_400_000), AHORA)).toBe('hace 3 días')
  })

  it('formatearFechaHora muestra día/mes y hora con dos dígitos', () => {
    expect(formatearFechaHora(null)).toBe('Sin datos')
    expect(formatearFechaHora('basura')).toBe('Sin datos')
    expect(formatearFechaHora('2026-09-29T18:40:00')).toBe('29/09 18:40')
    expect(formatearFechaHora('2026-01-05T06:07:00')).toBe('05/01 06:07')
  })
})

describe('última sincronización · semáforo', () => {
  it('clasifica por antigüedad de la última subida', () => {
    expect(estadoSync(null, AHORA)).toBe('nunca')
    expect(estadoSync(hace(10 * 60_000), AHORA)).toBe('reciente')
    expect(estadoSync(hace(29 * 60_000), AHORA)).toBe('reciente')
    expect(estadoSync(hace(45 * 60_000), AHORA)).toBe('medio')
    expect(estadoSync(hace(23 * 3_600_000), AHORA)).toBe('medio')
    expect(estadoSync(hace(25 * 3_600_000), AHORA)).toBe('viejo')
  })

  it('cada estado tiene texto y color propios', () => {
    for (const e of ['nunca', 'reciente', 'medio', 'viejo'] as const) {
      expect(TEXTO_ESTADO_SYNC[e]).toBeTruthy()
      expect(COLOR_ESTADO_SYNC[e]).toMatch(/^bg-/)
    }
  })
})
