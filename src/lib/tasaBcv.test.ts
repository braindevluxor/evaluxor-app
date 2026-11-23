// @vitest-environment jsdom
/**
 * La tasa del tabulador: BCV en vivo y la alternativa manual.
 *
 * `obtenerTasaBcv` se prueba con `fetch` mockeado —nada de red en los
 * tests— y sólo pide la tasa OFICIAL (la del BCV), nunca la paralela. La
 * manual vive en `localStorage`, que sólo existe en jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarTasaManual, leerTasaManual, obtenerTasaBcv } from './tasaBcv'

const RESPUESTA = [
  { fuente: 'oficial', promedio: 918.7662, fechaActualizacion: '2026-11-20T00:00:00-04:00' },
  { fuente: 'paralelo', promedio: 1086.862734, fechaActualizacion: '2026-11-22T21:02:02.954Z' }
]

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('obtenerTasaBcv', () => {
  it('devuelve la tasa OFICIAL —la del BCV—, con su fecha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => RESPUESTA })
    )
    await expect(obtenerTasaBcv()).resolves.toEqual({
      valor: 918.7662,
      fecha: '2026-11-20T00:00:00-04:00'
    })
    // La petición va al endpoint público…
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://ve.dolarapi.com/v1/dolares',
      expect.anything()
    )
  })

  it('sin red, con error HTTP o sin el oficial: null —el respaldo es la pantalla', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')))
    await expect(obtenerTasaBcv()).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await expect(obtenerTasaBcv()).resolves.toBeNull()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ fuente: 'paralelo', promedio: 1 }] })
    )
    await expect(obtenerTasaBcv()).resolves.toBeNull()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => 'no es una lista' })
    )
    await expect(obtenerTasaBcv()).resolves.toBeNull()
  })
})

describe('la tasa manual (localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('guarda, lee y borra; sólo números positivos', () => {
    expect(leerTasaManual()).toBeNull()

    guardarTasaManual(950.5)
    expect(leerTasaManual()).toBe(950.5)

    guardarTasaManual(null)
    expect(leerTasaManual()).toBeNull()

    // Basura no se guarda (y lo que ya estuviera corrupto se ignora).
    guardarTasaManual(Number.NaN)
    expect(leerTasaManual()).toBeNull()
    window.localStorage.setItem('luxor_tabulador_tasa_manual', 'abc')
    expect(leerTasaManual()).toBeNull()
  })
})
