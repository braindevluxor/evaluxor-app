// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { guardarMfaCache, generacionMfa, leerMfaCache, limpiarMfaCache } from './mfaEstado'

/**
 * `mfaEstado`: la caché de «¿esta cuenta pide segundo factor?» y su
 * GENERACIÓN.
 *
 * La generación existe para descartar respuestas viejas: un `procesarSesion`
 * que arrancó antes de que se tire la caché termina con un veredicto de antes
 * de verificar el TOTP, y aplicarlo reabría el paso de dos factores con la
 * sesión ya verificada —el bucle /login ↔ RequireAuth que reventaba React
 * con «Maximum update depth exceeded».
 */
beforeEach(() => {
  localStorage.clear()
})

describe('mfaEstado · la caché', () => {
  it('guarda y devuelve el pendiente del MISMO usuario, nada más', () => {
    guardarMfaCache('u-1', true)
    expect(leerMfaCache('u-1')).toBe(true)

    guardarMfaCache('u-1', false)
    expect(leerMfaCache('u-1')).toBe(false)

    // De otro usuario o sin usuario no hay dato que prestar.
    expect(leerMfaCache('u-2')).toBeNull()
    expect(leerMfaCache(null)).toBeNull()
    expect(leerMfaCache(undefined)).toBeNull()
  })

  it('tirar la caché deja sin dato Y sube la generación', () => {
    guardarMfaCache('u-1', true)
    const antes = generacionMfa()

    limpiarMfaCache()

    expect(leerMfaCache('u-1')).toBeNull()
    // Es lo que le permite a `procesarSesion` detectar que su cálculo quedó
    // viejo: la generación con la que arrancó ya no es la actual.
    expect(generacionMfa()).toBe(antes + 1)
  })

  it('leer o guardar NO mueven la generación: sólo la invalidación', () => {
    const antes = generacionMfa()
    guardarMfaCache('u-1', true)
    leerMfaCache('u-1')
    expect(generacionMfa()).toBe(antes)
  })
})
