import { supabase } from '../supabase'
import type { Profile, Invitacion, Asignacion, AsignacionModulo, Rol } from '../types'

export type ProfileVista = Profile & {
  sucursal?: { id: string; nombre: string } | null
}

export async function listarUsuarios(): Promise<ProfileVista[]> {
  const { data } = await supabase
    .from('profiles')
    .select('*, sucursal:sucursales!profiles_sucursal_id_fkey(id, nombre)')
    .order('created_at', { ascending: false })
  return (data ?? []) as ProfileVista[]
}

export async function actualizarUsuario(
  id: string,
  cambios: { nombre?: string; usuario?: string; rol?: Rol; sucursal_id?: string | null; activo?: boolean }
): Promise<void> {
  await supabase.from('profiles').update(cambios).eq('id', id)
}

export async function crearInvitacion(input: {
  email: string
  usuario: string
  rol: Exclude<Rol, 'SIN_ROL'>
  sucursal_id: string | null
}): Promise<Invitacion | null> {
  const { data, error } = await supabase
    .from('invitaciones')
    .insert({ email: input.email, usuario: input.usuario, rol: input.rol, sucursal_id: input.sucursal_id })
    .select('*')
    .single()
  return error ? null : (data as Invitacion)
}

export async function emailPorUsuario(usuario: string): Promise<string | null> {
  const { data } = await supabase.rpc('email_por_usuario', { p_usuario: usuario })
  return (data as string | null) ?? null
}

export interface ResultadoIntento {
  ok: boolean
  bloqueado: boolean
  restantes: number
}

export async function intentoLogin(usuario: string, password: string): Promise<ResultadoIntento> {
  const { data, error } = await supabase.rpc('intento_login', { p_usuario: usuario, p_password: password })
  if (error) throw new Error(`La función de bloqueo no respondió: ${error.message}`)
  const r = (data ?? {}) as Partial<ResultadoIntento>
  return {
    ok: !!r.ok,
    bloqueado: !!r.bloqueado,
    restantes: typeof r.restantes === 'number' ? r.restantes : 5
  }
}

export async function desbloquearUsuario(id: string, passwordProvisional: string): Promise<void> {
  const { error } = await supabase.rpc('desbloquear_usuario', { p_usuario_id: id, p_password_provisional: passwordProvisional })
  if (error) throw new Error(error.message)
}

export async function listarInvitaciones(): Promise<Invitacion[]> {
  const { data } = await supabase.from('invitaciones').select('*').order('created_at', { ascending: false })
  return (data ?? []) as Invitacion[]
}

export async function listarAsignacionasAdmin(): Promise<Asignacion[]> {
  const { data } = await supabase.from('asignaciones').select('*')
  return (data ?? []) as Asignacion[]
}

export async function asignarEvaluador(evaluadorId: string, sucursalId: string): Promise<void> {
  await supabase
    .from('asignaciones')
    .upsert({ evaluador_id: evaluadorId, sucursal_id: sucursalId, activa: true }, { onConflict: 'evaluador_id,sucursal_id' })
}

export async function desasignarEvaluador(evaluadorId: string, sucursalId: string): Promise<void> {
  await supabase
    .from('asignaciones')
    .update({ activa: false })
    .eq('evaluador_id', evaluadorId)
    .eq('sucursal_id', sucursalId)
}

export async function listarAsignacionesModulosAdmin(): Promise<AsignacionModulo[]> {
  const { data } = await supabase.from('asignaciones_modulos').select('*')
  return (data ?? []) as AsignacionModulo[]
}

export async function asignarModulo(evaluadorId: string, moduloId: string): Promise<void> {
  await supabase
    .from('asignaciones_modulos')
    .upsert({ evaluador_id: evaluadorId, modulo_id: moduloId, activa: true }, { onConflict: 'evaluador_id,modulo_id' })
}

export async function desasignarModulo(evaluadorId: string, moduloId: string): Promise<void> {
  await supabase
    .from('asignaciones_modulos')
    .update({ activa: false })
    .eq('evaluador_id', evaluadorId)
    .eq('modulo_id', moduloId)
}