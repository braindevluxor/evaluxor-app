import { describe, expect, it } from 'vitest'
import { cortesDePagina } from './paginarRevision'

/** Una página de 500 mm a 1 px/mm: ventanas fáciles de seguir a mano. */
const pagina1 = { altoMm: 500, topMm: 0 }
const paginaN = { altoMm: 400, topMm: 0 }

describe('cortesDePagina', () => {
  it('parte el contenido en tantas páginas como haga falta', () => {
    // 1000 px: 500 caben en la primera, 400 en la siguiente y los 100 restantes
    // cierran la tercera. Antes no había cortes: una sola hoja y el resto perdido.
    expect(cortesDePagina(1000, 1, [], pagina1, paginaN)).toEqual([500, 900, 1000])
  })

  it('una hoja corta sale en una sola página', () => {
    expect(cortesDePagina(300, 1, [], pagina1, paginaN)).toEqual([300])
    expect(cortesDePagina(0, 1, [], pagina1, paginaN)).toEqual([])
  })

  it('pega el corte a los bordes para no partir filas ni fotos', () => {
    // Límite en 480 (una fila que termina justo antes del tope de 500) y otro
    // en 940, que cae en la página siguiente: el corte va al borde, no al tope.
    const cortes = cortesDePagina(1000, 1, [0, 480, 940], pagina1, paginaN)
    expect(cortes).toEqual([480, 880, 940, 1000])
  })

  it('avanza aunque la ventana sea más chica que un píxel', () => {
    // Ventana 0 y escala 0: sin este cuidado el while giraría para siempre.
    expect(cortesDePagina(5, 0, [], { altoMm: 0, topMm: 0 }, { altoMm: 0, topMm: 0 })).toEqual([1, 2, 3, 4, 5])
  })

  it('ignora límites duplicados, no finitos ni fuera del contenido', () => {
    const cortes = cortesDePagina(
      500,
      1,
      [Number.NaN, -10, 500, 500, 9999],
      { altoMm: 400, topMm: 0 },
      { altoMm: 400, topMm: 0 }
    )
    // 500 no sirve como corte intermedio (queda justo al final) y 9999 es el
    // fin del contenido, no un borde: se corta en la ventana (400).
    expect(cortes).toEqual([400, 500])
  })
})
