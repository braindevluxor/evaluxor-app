/**
 * Qué se imprime en el informe.
 *
 * El PDF sale entero por omisión —que es como se llevaba y como lo espera quien
 * lo recibe—, pero no todas las descargas son iguales: a veces se manda solo la
 * hoja de compromiso y a veces el detalle de un módulo suelto. Por eso existe el
 * selector.
 *
 * DOS COSAS QUE NO SE TOCAN, Y SON A PROPÓSITO:
 *
 * · Los puntajes. Desmarcar un módulo saca su detalle del informe, no del
 *   cálculo: el número impreso tiene que ser el mismo que muestra el tablero, o
 *   el papel termina contradiciendo a la pantalla. Por eso `OpcionesPdf` no
 *   lleva ni los ítems ni las respuestas: solo qué pintar.
 *
 * Y UNA QUE SÍ SE TOCA:
 *
 * · La portada (datos de la tienda, puntuación general, personal evaluador y el
 *   gráfico por módulo) sale únicamente si van todos los módulos. Es un resumen
 *   de la evaluación entera: si falta la mitad del detalle, el gráfico de
 *   puntajes y el total cancelación la mitad de lo que el papel muestra.
 */

export type BloquePdf = 'cargosSucursal' | 'cargosCentral' | 'incidencias' | 'compromiso'

export interface OpcionesPdf {
  /** `id` de los módulos cuyo detalle se imprime. Vacío = ninguno. */
  modulos: string[]
  bloques: Record<BloquePdf, boolean>
}

/**
 * Los bloques del final, en el orden en que salen. El `id` es el que viaja en
 * `OpcionesPdf`; la etiqueta es la que se lee, y está junto al `id` para que
 * cambiar uno obligue a cambiar el otro.
 */
export const BLOQUES_PDF: { id: BloquePdf; etiqueta: string; ayuda: string }[] = [
  {
    id: 'cargosSucursal',
    etiqueta: 'Cargos de la sucursal',
    ayuda: 'Puntaje de cada cargo que trabaja en la tienda.'
  },
  {
    id: 'cargosCentral',
    etiqueta: 'Cargos de central',
    ayuda: 'Puntaje de cada cargo que responde desde la central.'
  },
  {
    id: 'incidencias',
    etiqueta: 'Incidencias registradas',
    ayuda: 'Las incidencias que se reportaron durante la visita, con su responsable.'
  },
  {
    id: 'compromiso',
    etiqueta: 'Hoja de compromiso',
    ayuda: 'La constancia de recibido, con los datos de recepción y firma de gerencia.'
  }
]

export const TODOS_LOS_BLOQUES: Record<BloquePdf, boolean> = {
  cargosSucursal: true,
  cargosCentral: true,
  incidencias: true,
  compromiso: true
}

/** El informe completo: lo que se descargaba antes de que existiera el selector. */
export function opcionesPorDefecto(moduloIds: string[]): OpcionesPdf {
  return { modulos: [...moduloIds], bloques: { ...TODOS_LOS_BLOQUES } }
}

/**
 * `opciones` en `undefined` significa el informe entero. Es lo que hace que
 * `buildPdfDocument` siga sirviendo tal cual a quien la llame sin selector: no
 * hay que pasar un "todo" explícito en cada llamada.
 */
export function imprimeModulo(opciones: OpcionesPdf | undefined, moduloId: string): boolean {
  return !opciones || opciones.modulos.includes(moduloId)
}

export function imprimeBloque(opciones: OpcionesPdf | undefined, bloque: BloquePdf): boolean {
  return !opciones || opciones.bloques[bloque]
}

/**
 * Si va la portada.
 *
 * Va con todos los módulos o no va: la portada es un resumen de la evaluación
 * entera, y un informe al que le faltan módulos no puede abrirse con un total y
 * un gráfico de barras que los dan por todos. Se compara módulo por módulo y no
 * por cantidad, porque una selección puede traer un id que ya no existe en el
 * detalle (módulo dado de baja) y quedarse igual con un módulo de menos.
 */
export function imprimePortada(opciones: OpcionesPdf | undefined, moduloIds: readonly string[]): boolean {
  if (!opciones) return true
  return moduloIds.every((id) => opciones.modulos.includes(id))
}

/**
 * Si va a imprimirse algún bloque de cargos. Los dos catálogos se piden juntos
 * porque hace falta el de la sucursal para clasificar: sin él, un cargo de la
 * tienda aparecería en la lista de central.
 */
export function imprimeCargos(opciones: OpcionesPdf | undefined): boolean {
  return imprimeBloque(opciones, 'cargosSucursal') || imprimeBloque(opciones, 'cargosCentral')
}

/** "6 de 8 módulos · 3 de 4 bloques", para el botón que abre el selector. */
export function resumenDeOpciones(opciones: OpcionesPdf, totalModulos: number): string {
  const modulos = `${opciones.modulos.length} de ${totalModulos} módulo${totalModulos === 1 ? '' : 's'}`
  const bloques = BLOQUES_PDF.filter(({ id }) => opciones.bloques[id]).length
  return `${modulos} · ${bloques} de ${BLOQUES_PDF.length} bloques`
}