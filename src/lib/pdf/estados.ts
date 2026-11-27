/**
 * Cómo se llama, en el papel, el estado de un punto.
 *
 * Van PALABRAS, no glifos: «APROBADO» en verde y «NO APROBADO» en rojo se
 * leen a un metro de distancia; una palomita dibujada a mano o una equis
 * suelta no contestaban la pregunta de siempre, que es la primera que se hace
 * con el informe en la mano: ¿esto está aprobado o no?
 *
 * Las dos salidas (informe general y reporte por cargos) usan las MISMAS
 * palabras: un mismo punto no puede llamarse de dos formas distintas según
 * el PDF en el que caiga.
 *
 * `SIN VALIDAR` es el estado propio del doble check: el punto está en la
 * tienda pero todavía no lo validó nadie, así que no puntúa y no es lo mismo
 * que un incumplimiento. Va corto a propósito: una celda estrecha parte el
 * texto al ajustar la fila y en el papel quedaba ilegible.
 */
export const ESTADO_APROBADO = 'APROBADO'
export const ESTADO_NO_APROBADO = 'NO APROBADO'
export const ESTADO_SIN_VALIDAR = 'SIN VALIDAR'
