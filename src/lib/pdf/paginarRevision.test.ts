import { describe, expect, it } from 'vitest'
import { cortesDePagina, type LimitePx } from './paginarRevision'

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

  it('un bloque que CABE entero no se muda: la hoja se llena hasta el tope', () => {
    // Síntoma reportado: las Observaciones salían en una página aparte con la
    // hoja de arriba a medio llena, debajo del QR. El paginador sólo medía
    // bordes SUPERIORES, así que cortaba en el arranque del último bloque que
    // entraba en la ventana aunque cupiera entero. Con los dos bordes, nada
    // cruza el tope → el corte va al fin del contenido y sale UNA hoja.
    const limites: LimitePx[] = [
      { top: 90, bottom: 250 }, // ficha del vehículo
      { top: 300, bottom: 520 } // el bloque del QR
      // Observaciones es partible y por eso NO está: su borde no manda cortes.
    ]
    expect(cortesDePagina(690, 1, limites, { altoMm: 700, topMm: 0 }, paginaN)).toEqual([690])
  })

  it('si el tope cae en material partible, la hoja se llena hasta el tope', () => {
    // Lo mismo pero el contenido NO cabe en una hoja: el texto largo que cruza
    // el tope se parte en el tope (sigue en la siguiente) en vez de mudarse
    // entero y dejar un hueco.
    const limites: LimitePx[] = [{ top: 90, bottom: 250 }]
    expect(cortesDePagina(900, 1, limites, pagina1, paginaN)).toEqual([500, 900])
  })

  it('un bloque atómico que no cabe se muda ENTERO, sin partirse', () => {
    // Un QR (una imagen) no se corta por la mitad: cruza el tope de 500, así
    // que el corte va a su borde superior y el bloque entero pasa a la
    // página siguiente, donde sí cabe.
    const limites: LimitePx[] = [{ top: 400, bottom: 650 }]
    expect(cortesDePagina(650, 1, limites, pagina1, paginaN)).toEqual([400, 650])
  })

  it('las filas de la tabla no se parten: si no caben, se mudan enteras', () => {
    // Límite en 480 (una fila que termina justo antes del tope de 500) y otra
    // en 940, que cruza el tope de la segunda ventana (900): esa fila se muda
    // a su borde superior y la primera se queda.
    const limites: LimitePx[] = [
      { top: 400, bottom: 480 },
      { top: 900, bottom: 940 }
    ]
    expect(cortesDePagina(1000, 1, limites, pagina1, paginaN)).toEqual([500, 900, 1000])
  })

  it('avanza aunque la ventana sea más chica que un píxel', () => {
    // Ventana 0 y escala 0: sin este cuidado el while giraría para siempre.
    expect(cortesDePagina(5, 0, [], { altoMm: 0, topMm: 0 }, { altoMm: 0, topMm: 0 })).toEqual([
      1, 2, 3, 4, 5
    ])
  })

  it('ignora límites duplicados, no finitos ni fuera del contenido', () => {
    const limites: LimitePx[] = [
      { top: Number.NaN, bottom: Number.NaN },
      { top: -10, bottom: 50 },
      { top: 490, bottom: 500 },
      { top: 490, bottom: 500 },
      { top: 4999, bottom: 9999 }
    ]
    const cortes = cortesDePagina(
      500,
      1,
      limites,
      { altoMm: 400, topMm: 0 },
      { altoMm: 400, topMm: 0 }
    )
    // 490-500 cabe entero en la segunda ventana (800) y 9999 está más allá
    // del contenido: el corte va al fin del documento, no a un borde lejano.
    expect(cortes).toEqual([400, 500])
  })
})
