import { describe, expect, it } from 'vitest'
import {
  AVANCE_FINAL,
  INICIO_INDETERMINADO,
  PASOS_CARGA,
  TECHO_INDETERMINADO,
  avanzar,
  avanceSiguiente,
  cambiarActivo,
  indicePaso,
  mensajeDe,
  terminar,
  type EstadoBarra
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

  it('el techo está por debajo del final, para que el 100 sea una señal', () => {
    // El 100 es la señal de "terminó". Si el automático lo alcanzara, dejaría
    // de ser una señal.
    expect(TECHO_INDETERMINADO).toBeLessThan(AVANCE_FINAL)
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

/**
 * La barra tiene que LLEGAR al 100%: el usuario complained de que se quedaba
 * clavada en 88. Estas pruebas fijan de qué lado está el límite entre el avance
 * automático y el final de verdad.
 */
describe('la barra · fases', () => {
  const inicial = (): EstadoBarra => ({ fase: 'inactiva', avance: INICIO_INDETERMINADO })

  it('mientras hay trabajo en vuelo, el automático NO puede llegar al 100', () => {
    // Si llegara, el usuario vería la barra completa con la lista sin aparecer.
    let e = cambiarActivo(inicial(), true, INICIO_INDETERMINADO)
    expect(e.fase).toBe('corriendo')
    for (let i = 0; i < 2000; i++) e = avanzar(e, TECHO_INDETERMINADO)
    expect(e.avance).toBeLessThan(AVANCE_FINAL)
    expect(e.avance).toBe(TECHO_INDETERMINADO)
  })

  it('el 100 aparece recién cuando el trabajo real terminó', () => {
    const corriendo = cambiarActivo(inicial(), true, INICIO_INDETERMINADO)
    const final = cambiarActivo(corriendo, false, INICIO_INDETERMINADO)
    expect(final.fase).toBe('terminando')
    expect(final.avance).toBe(AVANCE_FINAL)
  })

  it('la barra llena se queda un instante antes de dar lugar a la lista', () => {
    const llena = cambiarActivo(cambiarActivo(inicial(), true, INICIO_INDETERMINADO), false, INICIO_INDETERMINADO)
    expect(llena.avance).toBe(AVANCE_FINAL)
    expect(terminar(llena, INICIO_INDETERMINADO).fase).toBe('inactiva')
  })

  it('el reloj no toca la barra llena: si no, bajaría de 100 mientras espera', () => {
    const llena = cambiarActivo(cambiarActivo(inicial(), true, INICIO_INDETERMINADO), false, INICIO_INDETERMINADO)
    // Un `avanceSiguiente` suelto sobre 100 con techo 88 no lo movería, pero
    // conviene que la fase lo bloquee por si el techo cambiara.
    expect(avanzar(llena, TECHO_INDETERMINADO)).toBe(llena)
  })

  it('sin nada que esperar la barra no aparece nunca', () => {
    // Si `inactiva` pasara a `terminando`, se vería un 100% de golpe sin que
    // hubiera habido carga.
    const quieto = inicial()
    // Mismo objeto, no uno nuevo con los mismos valores: es lo que evita el
    // re-render de más cuando el efecto corre sin que nada haya cambiado.
    expect(cambiarActivo(quieto, false, INICIO_INDETERMINADO)).toBe(quieto)
    expect(terminar(quieto, INICIO_INDETERMINADO)).toBe(quieto)
    expect(quieto.avance).not.toBe(AVANCE_FINAL)
  })

  it('esperar de nuevo arranca de cero, no desde el final de la barra anterior', () => {
    // Si se volviera a pedir la lista mientras la barra llena todavía está a la
    // vista, seguir desde 100% haría que la espera arranque terminada.
    const llena = cambiarActivo(cambiarActivo(inicial(), true, INICIO_INDETERMINADO), false, INICIO_INDETERMINADO)
    const otra = cambiarActivo(llena, true, INICIO_INDETERMINADO)
    expect(otra.fase).toBe('corriendo')
    expect(otra.avance).toBe(INICIO_INDETERMINADO)
  })

  it('cambiar dos veces lo mismo no genera un estado nuevo', () => {
    // Si devolviera un objeto nuevo en cada efecto se re-renderiza para nada.
    const corriendo = cambiarActivo(inicial(), true, INICIO_INDETERMINADO)
    expect(cambiarActivo(corriendo, true, INICIO_INDETERMINADO)).toBe(corriendo)
    const lleno = cambiarActivo(corriendo, false, INICIO_INDETERMINADO)
    expect(cambiarActivo(lleno, false, INICIO_INDETERMINADO)).toBe(lleno)
    expect(avanzar(lleno, TECHO_INDETERMINADO)).toBe(lleno)
  })

  it('el recorrido completo termina en 100 sin quedarse trabado antes', () => {
    let e = cambiarActivo(inicial(), true, INICIO_INDETERMINADO)
    const vistos: number[] = []
    for (let i = 0; i < 400; i++) {
      const s = avanzar(e, TECHO_INDETERMINADO)
      if (s.avance !== e.avance) vistos.push(s.avance)
      e = s
    }
    e = cambiarActivo(e, false, INICIO_INDETERMINADO)
    e = terminar(e, INICIO_INDETERMINADO)
    // Subió, se posó en el techo, y terminó en 100 y se fue. La lista entra
    // recién después de ese 100.
    expect(vistos[0]).toBeGreaterThan(INICIO_INDETERMINADO)
    expect(vistos).toContain(TECHO_INDETERMINADO)
    expect(e.fase).toBe('inactiva')
    expect(terminar({ fase: 'terminando', avance: AVANCE_FINAL }, INICIO_INDETERMINADO).fase).toBe('inactiva')
  })
})