import { describe, expect, it } from 'vitest'
import { esBuildDistinta, esPantallaDeTrabajo, versionCorta } from './version'

describe('versionCorta', () => {
  it('arma "versión · dd/mm hh:mm · commit"', () => {
    expect(versionCorta({ version: '0.1.0', buildId: '20260929-1912-a1b2c3', commit: 'a1b2c3' })).toBe('0.1.0 · 29/09 19:12 · a1b2c3')
  })

  it('omite lo que no está (build de prueba, sin commit)', () => {
    expect(versionCorta({ version: '0.0.0-dev', buildId: '0.0.0-dev', commit: '' })).toBe('0.0.0-dev')
  })
})

describe('esBuildDistinta', () => {
  const actual = { buildId: '20260929-1912-a1b2c3' }

  it('es falsa si no hay versión remota', () => {
    expect(esBuildDistinta(null, actual)).toBe(false)
    expect(esBuildDistinta({ buildId: '' }, actual)).toBe(false)
  })

  it('es verdadera si cambia el buildId', () => {
    expect(esBuildDistinta({ buildId: '20260930-0900-d4e5f6' }, actual)).toBe(true)
  })

  it('es falsa si es la misma build', () => {
    expect(esBuildDistinta({ buildId: '20260929-1912-a1b2c3' }, actual)).toBe(false)
  })
})

describe('esPantallaDeTrabajo', () => {
  it('marca las pantallas donde una recarga cortaría al evaluador', () => {
    expect(esPantallaDeTrabajo('/evaluar/abc-123')).toBe(true)
    expect(esPantallaDeTrabajo('/evaluar/abc-123/resumen')).toBe(true)
  })

  it('deja el resto de pantallas libres para actualizar solo', () => {
    expect(esPantallaDeTrabajo('/evaluar')).toBe(false)
    expect(esPantallaDeTrabajo('/evaluar/historial')).toBe(false)
    expect(esPantallaDeTrabajo('/dashboard')).toBe(false)
    expect(esPantallaDeTrabajo('/perfil')).toBe(false)
    expect(esPantallaDeTrabajo('/')).toBe(false)
  })
})
