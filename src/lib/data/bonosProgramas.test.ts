import { describe, expect, it } from 'vitest'
import { notaDePrograma, pesoTotal } from './bonosProgramas'

/**
 * Programas de bonificación: lo que se puede decir sin tocar la red.
 *
 * El SQL cubre las reglas de forma desde el otro lado
 * (`bonosProgramas-sql.test.ts`); éste cubre el cálculo, que sólo vive en
 * el cliente: qué entra en el promedio, qué se ignora y cuándo no se puede
 * calcular todavía.
 */

const fuente = (id: string, peso: number) => ({ id, peso })

describe('pesoTotal', () => {
  it('suma los pesos de las fuentes', () => {
    expect(pesoTotal([])).toBe(0)
    expect(pesoTotal([fuente('a', 1), fuente('b', 2.5)])).toBe(3.5)
  })

  it('una fuente sin peso no aporta nada', () => {
    // La base lo impide (`peso > 0`), pero el cálculo no puede asumirlo:
    // dividir por cero dejaría la nota en `Infinity`.
    expect(pesoTotal([fuente('a', 0), fuente('b', 2)])).toBe(2)
  })
})

describe('notaDePrograma · el promedio ponderado', () => {
  it('promedia por peso, no en bruto', () => {
    // 90 con peso 3 y 60 con peso 1 → (90×3 + 60×1) / 4 = 82.5
    expect(notaDePrograma([fuente('a', 3), fuente('b', 1)], { a: 90, b: 60 })).toBe(82.5)
    // Mismo peso = promedio simple.
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], { a: 80, b: 100 })).toBe(90)
  })

  it('las fuentes SIN nota quedan fuera, no cuentan como cero', () => {
    // Es la trampa: un módulo cuya evaluación todavía no se hizo hundiría la
    // nota de todos si entrara como 0. Sólo la actividad cargada pesa.
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], { a: 80, b: null })).toBe(80)
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], { a: 80 })).toBe(80)
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], { a: 80, b: undefined })).toBe(80)
  })

  it('sin NI UNA nota no se calcula: null, que no es cero', () => {
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], {})).toBeNull()
    expect(notaDePrograma([fuente('a', 1)], { a: null })).toBeNull()
    expect(notaDePrograma([], { a: 80 })).toBeNull()
  })

  it('redondea a dos decimales: en plata no existe el tercer dígito', () => {
    // (70×1 + 80×1 + 90×1) / 3 = 80 sin ruido, pero 100/3 sí lo trae.
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1), fuente('c', 1)], { a: 33, b: 33, c: 34 })).toBe(33.33)
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], { a: 66.666, b: 66.666 })).toBe(66.67)
  })

  it('una nota fuera de rango no arruina el cálculo: se ignora', () => {
    // La base lo impide (0 a 100), pero un dato corrupto no debería poder
    // dejar el resultado en negativo ni en 500.
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], { a: 80, b: -10 })).toBe(80)
    expect(notaDePrograma([fuente('a', 1), fuente('b', 1)], { a: 80, b: 500 })).toBe(80)
    expect(notaDePrograma([fuente('a', 1)], { a: Number.NaN })).toBeNull()
  })
})
