import type { Rol } from './types'

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