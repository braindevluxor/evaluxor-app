/**
 * Comentario por punto de una lista (check list, unidad check list y listado
 * de trabajadores).
 *
 * El comentario es parte del punto: se escribe con él y se lee con él, así que
 * vive **dentro del valor** de la respuesta (columna `jsonb`), no en una tabla
 * aparte. No hace falta SQL ni migración para esto.
 *
 * La forma es un diccionario `id de la opción → texto`. Un diccionario y no un
 * arreglo porque el id de la opción es la clave natural del punto: el mismo
 * check en dos unidades distintas es el mismo check, y cada unidad (o cada
 * trabajador) tiene su propio diccionario.
 */

/** Comentarios de los puntos de una lista: id de la opción → texto. */
export type ComentariosPunto = Record<string, string>

/** Un comentario con el nombre del punto al que pertenece. */
export interface LineaComentario {
  /** Id de la opción (el punto). */
  id: string
  /** Etiqueta del punto, tal como la ve el evaluador. */
  punto: string
  /** Texto del comentario. */
  texto: string
}

/** El comentario de un punto, o cadena vacía si no tiene. */
export function leerComentario(comentarios: ComentariosPunto | undefined | null, opcionId: string): string {
  const texto = comentarios?.[opcionId]
  return typeof texto === 'string' ? texto : ''
}

/** Si hay algún comentario con texto. */
export function tieneComentarios(comentarios: ComentariosPunto | undefined | null): boolean {
  if (!comentarios) return false
  return Object.values(comentarios).some((texto) => typeof texto === 'string' && texto.trim() !== '')
}

/**
 * Escribe el comentario de un punto.
 *
 * Si el texto queda en blanco se **borra la clave**: un comentario vacío
 * guardado es ruido que después sale en los informes como si el evaluador
 * hubiera anotado algo.
 *
 * El texto se guarda tal cual (sin recortar): el campo es editable y quitarle
 * los espacios mientras se escribe haría que no se pueda escribir "punto " con
 * el espacio final. El recorte va en la lectura (`leerComentario` y
 * `lineasDeComentario`), que es donde se muestra.
 */
export function escribirComentario(
  comentarios: ComentariosPunto | undefined | null,
  opcionId: string,
  texto: string
): ComentariosPunto {
  const base = comentarios ?? {}
  if (!texto.trim()) {
    if (!(opcionId in base)) return base
    const out = { ...base }
    delete out[opcionId]
    return out
  }
  return { ...base, [opcionId]: texto }
}

/**
 * Los comentarios de los puntos, en el orden en que los muestra el ítem.
 *
 * Se arman desde las **opciones** y no desde las claves del diccionario: así el
 * orden es el del checklist (no el de escritura) y el comentario de un punto
 * que ya no existe (se borró del ítem) no sale en ningún informe.
 *
 * `excluir` son los ids que no se muestran: los puntos marcados «no aplica»,
 * que no entran al puntaje y por lo tanto tampoco tienen comentario que
 * informar.
 */
export function lineasDeComentario(
  comentarios: ComentariosPunto | undefined | null,
  opciones: { id: string; etiqueta: string }[],
  excluir?: string[]
): LineaComentario[] {
  if (!comentarios) return []
  const fuera = new Set(excluir ?? [])
  const lineas: LineaComentario[] = []
  for (const opcion of opciones) {
    if (fuera.has(opcion.id)) continue
    const texto = leerComentario(comentarios, opcion.id).trim()
    if (!texto) continue
    lineas.push({ id: opcion.id, punto: opcion.etiqueta, texto })
  }
  return lineas
}

/** Los comentarios en una línea de texto: «Punto: texto · Otro punto: texto». */
export function textoDeComentarios(lineas: LineaComentario[]): string {
  return lineas.map((linea) => `${linea.punto}: ${linea.texto}`).join(' · ')
}
