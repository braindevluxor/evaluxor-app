export type Rol = 'SIN_ROL' | 'LIDER' | 'EVALUADOR' | 'GERENTE_S' | 'GERENTE_C' | 'GERENTE_TH'

export type TipoItem =
  | 'CHECKLIST'
  | 'CUMPLE_NO_CUMPLE'
  | 'CONCILIACION'
  | 'LISTA_COLABORADORES'
  | 'UNIDAD_CHECKLIST'
  | 'CONTENEDOR'

export type FiltroColaboradores = 'ACTIVOS' | 'INACTIVOS' | 'TODOS'

export interface Sucursal {
  id: string
  nombre: string
  shop_id: string | null
  branch_id: string | null
  direccion: string | null
  gerente_id: string | null
  activa: boolean
  created_at: string
}

export interface Profile {
  id: string
  email: string
  usuario: string
  nombre: string
  rol: Rol
  sucursal_id: string | null
  activo: boolean
  intentos_fallidos?: number
  bloqueado?: boolean
  created_at: string
  updated_at: string
}

export interface Invitacion {
  id: string
  email: string
  usuario: string
  rol: Exclude<Rol, 'SIN_ROL'>
  sucursal_id: string | null
  token: string
  usado: boolean
  created_by: string | null
  created_at: string
}

export interface Asignacion {
  id: string
  evaluador_id: string
  sucursal_id: string
  activa: boolean
  created_by: string | null
  created_at: string
}

export interface AsignacionModulo {
  id: string
  evaluador_id: string
  modulo_id: string
  activa: boolean
  created_by: string | null
  created_at: string
}

export interface SucursalModulo {
  id: string
  sucursal_id: string
  modulo_id: string
  activa: boolean
  created_at: string
}

export interface SucursalItem {
  id: string
  sucursal_id: string
  item_id: string
  activa: boolean
  created_at: string
}

export interface SucursalOpcion {
  id: string
  sucursal_id: string
  item_id: string
  opcion_id: string
  activa: boolean
  created_at: string
}

export interface Modulo {
  id: string
  nombre: string
  descripcion: string
  orden: number
  activo: boolean
  created_at: string
}

export interface Opcion {
  id: string
  etiqueta: string
  responsable?: string
  /** Puntos propios de la opción (solo CHECKLIST). Si TODAS las opciones tienen puntos, la puntuación del ítem se reparte entre ellas. */
  puntos?: number
  /** Tipo de respuesta (solo CHECKLIST): 'CHECK' (casilla) o 'RANGO' (valor numérico con mínimo aceptable). */
  tipo_respuesta?: 'CHECK' | 'RANGO'
  /** Valor mínimo aceptable para considerar cumplida una opción de tipo RANGO. */
  minimo?: number
  /** Unidad opcional del valor del rango (ej: cm, litros). */
  unidad?: string
}

export interface Item {
  id: string
  modulo_id: string
  tipo: TipoItem
  texto: string
  opciones: Opcion[] | null
  colaboradores_filtro?: FiltroColaboradores | null
  responsables?: string[]
  orden: number
  requerido: boolean
  activo: boolean
  puntaje?: number
  /** Id del ítem CONTENEDOR (sección) que agrupa este ítem. Un solo nivel de anidación. */
  padre_id?: string | null
  created_at: string
}

export type EstadoEvaluacion = 'PROGRAMADA' | 'ACTIVA' | 'CERRADA'

export interface Evaluacion {
  id: string
  offline_uuid: string
  sucursal_id: string
  aperturada_por: string
  fecha: string
  estado: EstadoEvaluacion
  puntuacion: number | null
  comentario_general: string | null
  abierta_en: string | null
  cerrada_en: string | null
  created_at: string
}

export interface Respuesta {
  id: string
  evaluacion_id: string
  item_id: string
  valor: unknown
  respondido_por: string | null
  created_at: string
}

export interface Foto {
  id: string
  evaluacion_id: string
  item_id: string
  path: string
  created_at: string
}

export type VistaEvaluacion = Evaluacion & {
  sucursal?: Pick<Sucursal, 'id' | 'nombre' | 'shop_id' | 'branch_id' | 'direccion'> | null
  aperturador?: Pick<Profile, 'id' | 'nombre'> | null
}