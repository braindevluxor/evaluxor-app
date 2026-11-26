import { describe, expect, it } from 'vitest'
import {
  COLUMNAS_MONEDA,
  bonoCompensatorio,
  esConvertido,
  validarFila,
  valorParaVista,
  type FilaTabulador
} from './data/tabuladorPaquetes'

/**
 * Tabulador de paquetes: lo que decide CÓMO se ve una celda y QUÉ fila
 * puede guardarse.
 *
 * La conversión es pura y es el corazón de las tres vistas: declarar en la
 * moneda propia, convertir sólo al mirar. Todo lo demás (RLS, ruta, menú)
 * lo cubren `tabuladorPaquetes-sql.test.ts` y
 * `tabuladorPaquetes-integracion.test.ts`.
 */

const fila = (extra: Partial<FilaTabulador> = {}): FilaTabulador => ({
  id: 'test',
  codigo: '0037000',
  cargo: 'AUXILIAR DE PRECIOS',
  departamento: 'ALMACÉN',
  dependencia: 'PLANTA',
  plantilla: 26,
  salario_bs: 457.23,
  bono_traslado_bs: 100,
  bono_asistencia_usd: 50,
  cestatickets_usd: 30,
  paquete_aprobado_usd: 400,
  ...extra
})

describe('las vistas · declarar una vez, mirar de tres formas', () => {
  it('«según declaración» pinta cada cifra en SU moneda, sin convertir nada', () => {
    expect(esConvertido('BS', 'DECLARADO')).toBe(false)
    expect(esConvertido('USD', 'DECLARADO')).toBe(false)
    // La tasa ni se mira: sin tasa la vista declarada sigue completa.
    expect(valorParaVista(457.23, 'BS', 'DECLARADO', null)).toBe(457.23)
    expect(valorParaVista(50, 'USD', 'DECLARADO', null)).toBe(50)
  })

  it('«solo USD» convierte las BS dividiendo por la tasa y deja las USD tal cual', () => {
    expect(esConvertido('BS', 'USD')).toBe(true)
    expect(esConvertido('USD', 'USD')).toBe(false)
    // 3650 BS a tasa 36,50 = 100 USD
    expect(valorParaVista(3650, 'BS', 'USD', 36.5)).toBeCloseTo(100, 10)
    expect(valorParaVista(50, 'USD', 'USD', 36.5)).toBe(50)
  })

  it('«solo BS» convierte las USD multiplicando por la tasa y deja las BS tal cual', () => {
    expect(esConvertido('USD', 'BS')).toBe(true)
    expect(esConvertido('BS', 'BS')).toBe(false)
    // 100 USD a tasa 36,50 = 3650 BS
    expect(valorParaVista(100, 'USD', 'BS', 36.5)).toBeCloseTo(3650, 10)
    expect(valorParaVista(457.23, 'BS', 'BS', 36.5)).toBe(457.23)
  })

  it('sin tasa NO hay conversión: la celda no inventa cifras', () => {
    expect(valorParaVista(100, 'USD', 'BS', null)).toBeNull()
    expect(valorParaVista(3650, 'BS', 'USD', null)).toBeNull()
    // Ni con una tasa rota (cero o no numérica).
    expect(valorParaVista(100, 'USD', 'BS', 0)).toBeNull()
    expect(valorParaVista(100, 'USD', 'BS', Number.NaN)).toBeNull()
  })

  it('lo no declarado sigue sin declararse en CUALQUIER vista', () => {
    expect(valorParaVista(null, 'USD', 'BS', 36.5)).toBeNull()
    expect(valorParaVista(null, 'BS', 'USD', 36.5)).toBeNull()
    expect(valorParaVista(null, 'BS', 'DECLARADO', null)).toBeNull()
  })

  it('la tabla anuncia las cifras con su moneda: dos en BS y tres en USD', () => {
    const bs = COLUMNAS_MONEDA.filter((c) => c.moneda === 'BS').map((c) => c.campo)
    const usd = COLUMNAS_MONEDA.filter((c) => c.moneda === 'USD').map((c) => c.campo)
    expect(bs).toEqual(['salario_bs', 'bono_traslado_bs'])
    expect(usd).toEqual(['bono_asistencia_usd', 'cestatickets_usd', 'paquete_aprobado_usd'])
  })
})

describe('bonoCompensatorio · la columna que no se guarda', () => {
  it('es el paquete menos el resto, con los BS pasados a USD por la tasa', () => {
    // 400 − (457,23 + 100) / 40 − 50 − 30 = 400 − 13,93075 − 50 − 30
    expect(bonoCompensatorio(fila(), 40)).toBeCloseTo(306.06925, 5)
    // Más la tasa, menos BS que convertir: 400 − 10,5 − 50 − 30 = 309,5
    expect(bonoCompensatorio(fila(), 53.07)).toBeCloseTo(309.5, 1)
  })

  it('sin tasa no se puede restar BS a USD: no hay número', () => {
    expect(bonoCompensatorio(fila(), null)).toBeNull()
    expect(bonoCompensatorio(fila(), 0)).toBeNull()
    // Pero si no hay BS que convertir, la resta se hace igual: no hace falta tasa.
    expect(bonoCompensatorio(fila({ salario_bs: 0, bono_traslado_bs: null }), null)).toBeCloseTo(
      320,
      10
    )
  })

  it('sin paquete aprobado no hay de qué restar', () => {
    expect(bonoCompensatorio(fila({ paquete_aprobado_usd: null }), 40)).toBeNull()
  })

  it('lo no declarado no resta: cuenta como cero', () => {
    // 400 − 0 (sin salario ni traslado) − 50 − 30 = 320, sin tasa de por medio.
    expect(bonoCompensatorio(fila({ salario_bs: null, bono_traslado_bs: null }), 40)).toBeCloseTo(
      320,
      10
    )
  })
})

describe('validarFila · lo que no entra a la base', () => {
  it('una fila completa está bien', () => {
    expect(validarFila(fila())).toBeNull()
    // Y lo no declarado también: `null` es un valor válido.
    expect(validarFila(fila({ cestatickets_usd: null }))).toBeNull()
    expect(validarFila(fila({ plantilla: null }))).toBeNull()
  })

  it('el cargo es obligatorio y tiene que tener letras o números', () => {
    expect(validarFila(fila({ cargo: '   ' }))).toMatch(/cargo/i)
    expect(validarFila(fila({ cargo: '---' }))).toMatch(/letras o números/i)
  })

  it('ninguna cifra puede ser negativa', () => {
    expect(validarFila(fila({ salario_bs: -1 }))).toMatch(/Salario \(BS\)/i)
    expect(validarFila(fila({ bono_asistencia_usd: -0.01 }))).toMatch(/Bono asistencia \(USD\)/i)
    expect(validarFila(fila({ bono_traslado_bs: -5 }))).toMatch(/Bono traslado \(BS\)/i)
    expect(validarFila(fila({ cestatickets_usd: -1 }))).toMatch(/Cestatickets \(USD\)/i)
    expect(validarFila(fila({ paquete_aprobado_usd: -1 }))).toMatch(/Paquete aprobado \(USD\)/i)
  })

  it('la plantilla no admite plazas negativas', () => {
    expect(validarFila(fila({ plantilla: -3 }))).toMatch(/plantilla/i)
  })
})
