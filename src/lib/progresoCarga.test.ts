import { describe, expect, it } from 'vitest'
import {
  INICIO_INDETERMINADO,
  PASOS_CARGA,
  TECHO_INDETERMINADO,
  avanceSiguiente,
  indicePaso,
  mensajeDe
} from './progresoCarga'

describe('avanceSiguiente · el avance automático', () => {
  it('nunca pasa del techo', () => {
    expect(avanceSiguiente(TECHO_INDETERMINADO)).toBe(TECHO_INDETERMINADO)
    expect(avanceSiguiente(TECHO_INDETERMINADO + 20)).toBe(TECHO_INDETERMINADO)
    // Ni por un tick, ni por muchos: el `min(..., falta)` es lo que impide el
    // desborde cuando el salto mínimo es más grande que lo que falta.
    let v = INICIO_INDETERMINADO
    for (let i = 0; i < 5000; i++) v = avanceSiguiente(v)
    expect(v).toBeLessThanOrEqual(TECHO_INDETERMINADO)
  })

  it('se posa en el techo, pero el techo está lejos de 100', () => {
    // Que se pose es lo correcto: ahí espera a que la consulta termine. Lo que
    // no puede pasar es que ese posesionamiento se lea como "listo".
    let v = INICIO_INDETERMINADO
    for (let i = 0; i < 5000; i++) v = avanceSiguiente(v)
    expect(v).toBe(TECHO_INDETERMINADO)
    expect(TECHO_INDETERMINADO).toBeLessThan(100)
  })

  it('arranca bajo: en 40% ya se lee como que algo pasó', () => {
    expect(INICIO_INDETERMINADO).toBeLessThan(20)
  })

  it('se frena al acercarse, sin que el salto llegue a crecer nunca', () => {
    // El salto es cada vez más chico y nunca vuelve a crecer. Con avance
    // lineal —o con un salto constante— se vería el frenazo de golpe al llegar
    // al final.
    let anterior = Infinity
    for (let v = 0; v < TECHO_INDETERMINADO; v += 0.5) {
      const salto = avanceSiguiente(v) - v
      expect(salto).toBeLessThanOrEqual(anterior)
      anterior = salto
    }
    // Y el contraste se nota: al principio mueve mucho más que al final.
    expect(avanceSiguiente(14) - 14).toBeGreaterThan((avanceSiguiente(87) - 87) * 4)
  })

  it('siempre avanza mientras quede algo, sin quedar clavado en el mismo número', () => {
    // Si el último tick no moviera nada, la barra se quedaría clavada en el
    // techo y la espera parecería colgada.
    let v = INICIO_INDETERMINADO
    const vistos = new Set<number>()
    for (let i = 0; i < 400; i++) {
      const siguiente = avanceSiguiente(v)
      expect(siguiente).toBeGreaterThanOrEqual(v)
      vistos.add(siguiente)
      v = siguiente
    }
    expect(vistos.size).toBeGreaterThan(5)
    expect(v).toBe(TECHO_INDETERMINADO)
  })

  it('respeta un techo propio', () => {
    expect(avanceSiguiente(39, 40)).toBeGreaterThan(39)
    expect(avanceSiguiente(39, 40)).toBeLessThanOrEqual(40)
    expect(avanceSiguiente(40, 40)).toBe(40)
  })
})

describe('indicePaso · qué mensaje va', () => {
  it('los tres mensajes se reparten el recorrido en orden', () => {
    expect(indicePaso(0)).toBe(0)
    expect(indicePaso(TECHO_INDETERMINADO * 0.33)).toBe(0)
    expect(indicePaso(TECHO_INDETERMINADO * 0.35)).toBe(1)
    expect(indicePaso(TECHO_INDETERMINADO * 0.71)).toBe(1)
    expect(indicePaso(TECHO_INDETERMINADO * 0.73)).toBe(2)
    expect(indicePaso(TECHO_INDETERMINADO)).toBe(2)
  })

  it('nunca se sale del arreglo de mensajes', () => {
    for (const v of [-50, 0, 14, 50, 87, 88, 100, 9999]) {
      expect(PASOS_CARGA[indicePaso(v)]).toBeTruthy()
    }
  })

  it('un techo en cero no divide por cero', () => {
    expect(indicePaso(10, 0)).toBe(0)
    expect(mensajeDe(10, 0)).toBe(PASOS_CARGA[0])
  })
})

describe('mensajeDe', () => {
  it('devuelve el mensaje del tramo', () => {
    expect(mensajeDe(0)).toBe('Creando la consulta…')
    expect(mensajeDe(TECHO_INDETERMINADO * 0.5)).toBe('Depurando los registros…')
    expect(mensajeDe(TECHO_INDETERMINADO)).toBe('Validando los ajustes finales…')
  })

  it('el recorrido completo pasa por los tres, sin quedarse en uno', () => {
    // Si el avance se quedara en un solo tramo, el mensaje sería fijo y no
    // marcaría progreso — que era el problema del texto único.
    const vistos = new Set<string>()
    for (let v = INICIO_INDETERMINADO; v <= TECHO_INDETERMINADO; v++) vistos.add(mensajeDe(v))
    expect(vistos.size).toBe(PASOS_CARGA.length)
  })
})