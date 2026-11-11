import type { EstadoEvaluacion, Rol } from './types'

export const ES_LIDER = 'LIDER'
export const ES_EVALUADOR = 'EVALUADOR'

export const ETIQUETAS_ROL: Record<Rol, string> = {
  SIN_ROL: 'Sin asignar',
  LIDER: 'Líder',
  EVALUADOR: 'Evaluador',
  GERENTE_S: 'Gerente de Sucursal',
  GERENTE_C: 'Gerente Corporativo',
  GERENTE_TH: 'Gerente de Talento Humano'
}

export const ROLES_EDITABLES: Exclude<Rol, 'SIN_ROL'>[] = [
  'LIDER',
  'EVALUADOR',
  'GERENTE_S',
  'GERENTE_C',
  'GERENTE_TH'
]

export function puedeEvaluar(rol: Rol): boolean {
  return rol === 'LIDER' || rol === 'EVALUADOR'
}

export function puedeConfigurar(rol: Rol): boolean {
  return rol === 'LIDER'
}

/**
 * ¿Se pueden corregir los productos escaneados de una conciliación?
 *
 * Mientras la evaluación está ACTIVA, cualquiera que pueda responder. Una vez
 * cerrada, solo el Líder —que es lo que permite el servidor: `puede_responder`
 * arranca con `select public.es_lider() or …`, sin tocar el estado. Y tiene
 * sentido: el borrón de inventario se corrige después de cerrar igual que
 * cualquier otro dato mal escaneado, y lo que se arregla es el balance de
 * conciliación, no el puntaje ya registrado.
 *
 * Existía porque el editor devolvía sin más en cuanto la evaluación no estaba
 * ACTIVA, mientras el lápiz del historial la abría igual: el Líder confirmaba el
 * borrado, la fila no se movía y el producto seguía en el detalle.
 */
export function puedeCorregirConciliacion(rol: Rol, estado: EstadoEvaluacion): boolean {
  return estado === 'ACTIVA' || rol === 'LIDER'
}

export function verTodo(rol: Rol): boolean {
  return rol === 'LIDER' || rol === 'GERENTE_C' || rol === 'GERENTE_TH'
}

export function homePorRol(rol: Rol): string {
  switch (rol) {
    case 'LIDER':
      return '/dashboard'
    case 'EVALUADOR':
      return '/evaluar'
    case 'GERENTE_S':
    case 'GERENTE_C':
    case 'GERENTE_TH':
      return '/dashboard'
    default:
      return '/pendiente'
  }
}