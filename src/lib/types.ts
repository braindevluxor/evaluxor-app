export type Rol = 'SIN_ROL' | 'LIDER' | 'EVALUADOR' | 'GERENTE_S' | 'GERENTE_C' | 'GERENTE_TH'

export type TipoItem =
  | 'CHECKLIST'
  | 'COMENTARIO'
  | 'FOTO'
  | 'CUMPLE_NO_CUMPLE'
  | 'DESCRIPCION'
  | 'CANTIDAD'
  | 'CONCILIACION'

export interface Sucursal {
  id: string
  nombre: string
  shop_id: string | null
  ciudad: string | null
  direccion: string | null
  activa: boolean
  created_at: string
}

export interface Departamento {
  id: string
  nombre: string
  codigo: string
  tolerancia: number | null
  activo: boolean
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
}

export interface Item {
  id: string
  modulo_id: string
  tipo: TipoItem
  texto: string
  opciones: Opcion[] | null
  orden: number
  requerido: boolean
  activo: boolean
  created_at: string
}

export interface Evaluacion {
  id: string
  offline_uuid: string
  sucursal_id: string
  evaluador_id: string
  fecha: string
  puntuacion: number | null
  comentario_general: string | null
  completed_at: string
}

export interface Respuesta {
  id: string
  evaluacion_id: string
  item_id: string
  valor: unknown
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
  sucursal?: Pick<Sucursal, 'id' | 'nombre' | 'shop_id' | 'ciudad' | 'direccion'> | null
  evaluador?: Pick<Profile, 'id' | 'nombre'> | null
}