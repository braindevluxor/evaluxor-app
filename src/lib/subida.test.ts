import { describe, expect, it } from 'vitest'
import { causaSubida, detalleTecnico, errorSubida, esErrorSubida, mensajeSubida } from './subida'

describe('causaSubida', () => {
  it('detecta el rechazo de RLS como "rechazada" y no como problema de conexión', () => {
    expect(
      causaSubida({ code: '42501', message: 'new row violates row-level security policy for table "respuestas"', details: '' })
    ).toBe('rechazada')
  })

  it('detecta rechazos sin código 42501', () => {
    expect(causaSubida({ code: 'PGRST301', message: 'not authorized' })).toBe('rechazada')
    expect(causaSubida(new Error('permission denied for table instancias_grupo'))).toBe('rechazada')
  })

  it('detecta el corte de internet', () => {
    expect(causaSubida(new TypeError('fetch failed'))).toBe('sin_conexion')
    expect(causaSubida({ message: 'TypeError: Failed to fetch' })).toBe('sin_conexion')
    expect(causaSubida({ message: 'Load failed' })).toBe('sin_conexion')
  })

  it('detecta caída del servidor', () => {
    expect(causaSubida({ code: '503', message: 'Service Unavailable' })).toBe('servidor')
    expect(causaSubida({ code: 'PGRST502', message: 'Bad Gateway' })).toBe('servidor')
  })

  it('no confunde un rechazo con una caída', () => {
    // 42501 tiene que ganar siempre: si no, vuelve el mensaje mentiroso.
    expect(causaSubida({ code: '42501', message: 'fetch failed' })).toBe('rechazada')
  })

  it('cae en desconocida para lo que no reconoce', () => {
    expect(causaSubida({ code: 'PGRST116', message: 'JSON object requested, multiple rows returned' })).toBe('desconocida')
    expect(causaSubida(null)).toBe('desconocida')
  })

  it('respeta la causa que ya viene en un ErrorSubida', () => {
    const err = errorSubida({ code: '503', message: 'x' }, 'guardar el avance')
    expect(causaSubida(err)).toBe('servidor')
  })
})

describe('detalleTecnico', () => {
  it('muestra código y mensaje del servidor', () => {
    expect(detalleTecnico({ code: '42501', message: 'new row violates row-level security policy' })).toBe(
      '42501 · new row violates row-level security policy'
    )
  })

  it('usa el detalle ya armado de un ErrorSubida', () => {
    const err = errorSubida({ code: '42501', message: 'rls' }, 'guardar el avance')
    expect(err.detalle).toBe('guardar el avance · 42501 · rls')
    expect(detalleTecnico(err)).toBe(err.detalle)
  })

  it('nunca devuelve vacío', () => {
    expect(detalleTecnico(undefined)).toBe('Error desconocido')
  })
})

describe('mensajeSubida', () => {
  it('no culpa a la conexión cuando el servidor rechazó el guardado', () => {
    const m = mensajeSubida('rechazada')
    expect(m.titulo).not.toMatch(/conexión/i)
    expect(m.ayuda).toMatch(/no es un problema de internet/i)
  })

  it('reintenta lejos: 2 min para un rechazo, 12 s para un corte de internet', () => {
    expect(mensajeSubida('rechazada').cadaMs).toBe(120_000)
    expect(mensajeSubida('sin_conexion').cadaMs).toBe(12_000)
  })

  it('el corte de internet sí habla de conexión', () => {
    expect(mensajeSubida('sin_conexion').titulo).toMatch(/conexión/i)
  })
})

describe('errorSubida', () => {
  it('es un Error con causa y detalle', () => {
    const err = errorSubida({ code: '42501', message: 'rls' }, 'guardar el avance')
    expect(err).toBeInstanceOf(Error)
    expect(esErrorSubida(err)).toBe(true)
    expect(err.causa).toBe('rechazada')
  })
})
