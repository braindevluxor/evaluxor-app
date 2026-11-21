/**
 * En dónde cortar el canvas largo de una hoja para que quepa en páginas A4.
 *
 * El PDF sale de `html2canvas`: una sola imagen de toda la hoja. Pegarla entera
 * en una página A4 no la multiplica, la **recorta** —era el síntoma: «sólo sale
 * una página y está incompleta»—, así que el canvas se parte en porciones y
 * cada porción va a su página.
 *
 * CÓMO SE ELIGE EL CORTE
 * ---------------------
 * Cada bloque atómico de la hoja (una fila de la tabla, una ficha, el QR) va
 * con SUS DOS bordes. La regla por página es:
 *
 *  1. Si algún bloque ATÓMICO cruza el tope de la ventana —empezó antes del
 *     tope y termina después—, el corte va en su borde superior: ese bloque
 *     entero se muda a la siguiente hoja. Nunca se parte un bloque atómico.
 *  2. Si nada cruza el tope y ya terminó todo el contenido, se corta en el
 *     fin del documento: una sola hoja, sin saltos de sobra.
 *  3. Si nada cruza el tope y el contenido sigue, lo que está en el tope es
 *     material PARTIBLE (texto largo o el hueco entre bloques): la hoja se
 *     llena hasta el tope.
 *
 * Ése era el síntoma que arregla: antes el corte se pegaba al borde SUPERIOR
 * del último bloque que arrancaba dentro de la ventana, así que un bloque que
 * CABÍA entero se mudaba igual y la hoja quedaba con un hueco grande debajo
 * del QR (las Observaciones aisladas en una página aparte).
 *
 * Lógica pura: recibe números y devuelve números, y por eso se prueba sola.
 */

/** Cuánto alto de página se usa, en mm, y desde dónde empieza el contenido. */
export interface VentanaPagina {
  /** Altura útil de la página en mm, ya descontados sus márgenes. */
  altoMm: number
  /** Dónde arranca el contenido dentro de la página, en mm (la 1 va en 0). */
  topMm: number
}

/** Los DOS bordes de un bloque atómico, en píxeles del canvas. */
export interface LimitePx {
  /** Borde superior: si el bloque no entra entero, el corte va acá. */
  top: number
  /** Borde inferior: con él se sabe si el bloque CABE en la ventana. */
  bottom: number
}

/**
 * Fin de cada página, en píxeles del canvas (el último elemento es el fin del
 * contenido). Siempre creciente y terminado: el dibujo avanza aunque la ventana
 * sea más chica que un píxel o los límites estén pegados.
 */
export function cortesDePagina(
  altoTotalPx: number,
  pxPorMm: number,
  limitesPx: LimitePx[],
  primera: VentanaPagina,
  resto: VentanaPagina
): number[] {
  const limites = limitesPx
    .filter(
      (l) =>
        Number.isFinite(l.top) &&
        Number.isFinite(l.bottom) &&
        l.top >= 0 &&
        l.bottom > l.top
    )
    .sort((a, b) => a.top - b.top)

  const cortes: number[] = []
  let y = 0
  let pagina = 0

  while (y < altoTotalPx) {
    const ventana = pagina === 0 ? primera : resto
    const techo = y + Math.max(ventana.altoMm, 0) * pxPorMm

    // El bloque atómico que CRUZA el tope: el de mayor arranque que empieza
    // antes del techo y termina después. Sólo uno manda el corte a su borde
    // superior; los que ya entraron enteros se quedan.
    let corte = -1
    for (const limite of limites) {
      if (limite.top > techo) break
      if (limite.bottom > techo && limite.top > corte) corte = limite.top
    }

    let fin: number
    if (corte > y) {
      // El que no cabe entero se muda entero, sin partirse.
      fin = corte
    } else if (altoTotalPx <= techo) {
      // Entra todo el contenido: se corta en el fin del documento y no se
      // abre una hoja de sobra con sólo el padding de abajo.
      fin = altoTotalPx
    } else {
      // Lo que está en el tope es material partible (texto largo, el hueco
      // entre bloques): la hoja se llena hasta el tope.
      fin = Math.min(altoTotalPx, techo)
    }
    // Progreso garantizado: nunca un corte que no avance.
    if (fin <= y) fin = Math.min(altoTotalPx, y + 1)

    cortes.push(fin)
    y = fin
    pagina++
  }

  return cortes
}
