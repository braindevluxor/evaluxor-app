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

  it('detecta el ítem borrado como "item_borrado", no como rechazo de RLS', () => {
    // El texto de Postgres dice "violates", así que el patrón de RLS lo agarraba
    // primero y terminaba culpando a la conexión y al Líder.
    expect(
      causaSubida({
        code: '23503',
        message: 'insert or update on table "respuestas" violates foreign key constraint "respuestas_item_id_fkey"',
        details: ''
      })
    ).toBe('item_borrado')
    expect(causaSubida(new Error('foreign key violation: respuestas_instancia_id_fkey'))).toBe('item_borrado')
  })

  it('no manda un 23503 a "rechazada" aunque el texto diga violates', () => {
    expect(causaSubida({ code: '23503', message: 'violates foreign key constraint' })).not.toBe('rechazada')
  })

  it('cae en desconocida para lo que no reconoce', () => {
    expect(causaSubida({ code: 'PGRST116', message: 'JSON object requested, multiple rows returned' })).toBe('desconocida')
    expect(causaSubida(null)).toBe('desconocida')
  })

  it('respeta la causa que ya viene en un ErrorSubida', () => {
    const err = errorSubida({ code: '503', message: 'x' }, 'guardar el avance')
    expect(causaSubida(err)).toBe('servidor')
  })

  it('respeta evaluacion_cerrada, que se decide mirando el estado, no el error', () => {
    // El error crudo sigue siendo 42501: lo que cambia es que ya se consultó la
    // evaluación y se sabe por qué la rechazan. Sin esto el mensaje la adivina.
    const err = errorSubida({ code: '42501', message: 'rls' }, 'guardar el avance')
    err.causa = 'evaluacion_cerrada'
    expect(causaSubida(err)).toBe('evaluacion_cerrada')
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

  it('el ítem borrado no promete reintentos ni culpa a internet', () => {
    const m = mensajeSubida('item_borrado')
    expect(m.reintentar).toBe(false)
    expect(m.cadaMs).toBe(0)
    expect(m.ayuda).not.toMatch(/internet|conexión/i)
    expect(m.ayuda).toMatch(/borrad/i)
  })

  it('respeta la causa item_borrado que ya viene en un ErrorSubida', () => {
    const err = errorSubida({ code: '23503', message: 'violates foreign key constraint "respuestas_item_id_fkey"' }, 'guardar el avance')
    expect(err.causa).toBe('item_borrado')
  })

  it('la evaluación cerrada se nombra, no se adivina entre cuatro causas', () => {
    const m = mensajeSubida('evaluacion_cerrada')
    expect(m.titulo).toMatch(/ya no acepta respuestas/i)
    // Dice qué hacer (que el Líder la abra) y no culpa a internet ni al ítem.
    expect(m.ayuda).toMatch(/Líder/i)
    expect(m.ayuda).toMatch(/vuelvan a abrir/i)
    expect(m.ayuda).not.toMatch(/el ítem puede estar desactivado/i)
  })

  it('con la evaluación abierta, el rechazo sí menciona lo que puede ser', () => {
    // Ahora que se descarta "evaluación cerrada", quedan las otras tres y hay que
    // nombrarlas: decir solo "te rechazan por permisos" no le sirve a nadie.
    expect(mensajeSubida('rechazada').ayuda).toMatch(/ítem se haya desactivado|dado de baja el módulo/i)
  })

  it('la evaluación cerrada reintenta más lejos que un rechazo normal', () => {
    // Reintenta, porque el Líder puede reabrirla; pero cada 5 min, no cada 2.
    expect(mensajeSubida('evaluacion_cerrada').reintentar).toBe(true)
    expect(mensajeSubida('evaluacion_cerrada').cadaMs).toBeGreaterThan(mensajeSubida('rechazada').cadaMs)
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
