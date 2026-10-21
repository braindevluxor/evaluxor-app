/**
 * En dónde cortar el canvas largo de una hoja para que quepa en páginas A4.
 *
 * El PDF sale de `html2canvas`: una sola imagen de toda la hoja. Pegarla entera
 * en una página A4 no la multiplica, la **recorta** —era el síntoma: «sólo sale
 * una página y está incompleta»—, así que el canvas se parte en porciones y
 * cada porción va a su página.
 *
 * Los cortes se pegan a los `limitesPx` (el borde de una fila de la tabla, de
 * una foto o de un bloque) que queden dentro de la ventana de la página, para
 * que ninguna quede partida en dos hojas. Si la ventana no contiene ningún
 * límite, se corta en la ventana misma.
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

/**
 * Fin de cada página, en píxeles del canvas (el último elemento es el fin del
 * contenido). Siempre creciente y terminado: el dibujo avanza aunque la ventana
 * sea más chica que un píxel o los límites estén pegados.
 */
export function cortesDePagina(
  altoTotalPx: number,
  pxPorMm: number,
  limitesPx: number[],
  primera: VentanaPagina,
  resto: VentanaPagina
): number[] {
  const limites = [...new Set(limitesPx)]
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)

  const cortes: number[] = []
  let y = 0
  let pagina = 0

  while (y < altoTotalPx) {
    const ventana = pagina === 0 ? primera : resto
    const techo = y + Math.max(ventana.altoMm, 0) * pxPorMm

    // El último límite que todavía cabe en esta página: el corte más abajo
    // posible sin partir el elemento siguiente.
    let fin = 0
    for (const limite of limites) {
      if (limite > techo) break
      if (limite > y) fin = limite
    }
    if (!fin) fin = Math.min(altoTotalPx, techo)
    // Progreso garantizado: nunca un corte que no avance.
    if (fin <= y) fin = Math.min(altoTotalPx, y + 1)
    fin = Math.min(fin, altoTotalPx)

    cortes.push(fin)
    y = fin
    pagina++
  }

  return cortes
}
