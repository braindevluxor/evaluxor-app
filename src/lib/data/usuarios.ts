import { supabase, crearClienteAislado } from '../supabase'
import type { Profile, Asignacion, AsignacionModulo, Rol } from '../types'

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
  const { error } = await supabase.from('profiles').update(cambios).eq('id', id)
  // Con error se avisa: un cambio de rol o un congelado que no llegó a la
  // base tiene que verse en pantalla, no quedarse en silencio.
  if (error) throw new Error(error.message)
}

/** Lo que la pantalla muestra al terminar: las credenciales para compartirlas. */
export interface CredencialesCreadas {
  usuario: string
  email: string
  password: string
  /**
   * Supabase pidió confirmar el correo antes de dejar entrar: la cuenta
   * existe pero todavía no se puede usar (proyecto con «Confirm email»).
   */
  confirmacionPendiente: boolean
}

/**
 * Crea la cuenta DIRECTAMENTE: el Líder llena el formulario, recibe las
 * credenciales y se las manda a la persona —sin que nadie abra un enlace de
 * registro—. Ésta es la persona la que cambia su clave después, desde
 * Configuración → Cambiar contraseña.
 *
 * Por qué dos pasos:
 *
 *  1. Se crea una `invitacion` con el correo/usuario/rol/sucursal: es la
 *     AUTORIZACIÓN que exige el trigger `validar_registro` (sin ella,
 *     `auth.users` no deja insertar) y es de donde `handle_new_user` toma
 *     el rol, la sucursal y el usuario de acceso para el perfil. Se consume
 *     sola en ese mismo alta.
 *  2. La cuenta se llama por el MISMO GoTrue del registro por invitación,
 *     pero desde `crearClienteAislado`: `signUp` genera sesión para la cuenta
 *     nueva y ésa no puede pisar la del Líder que está creando.
 */
export async function crearUsuario(input: {
  email: string
  usuario: string
  password: string
  nombre?: string
  rol: Exclude<Rol, 'SIN_ROL'>
  sucursal_id: string | null
}): Promise<CredencialesCreadas> {
  const email = input.email.trim().toLowerCase()
  const usuario = input.usuario.trim()
  const password = input.password
  if (!email) throw new Error('Escribí el correo del nuevo usuario.')
  if (!usuario) throw new Error('Escribí el usuario de acceso.')
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.')

  // 1) La autorización (y los datos que el trigger va a leer).
  const { data: invitacion, error: errInv } = await supabase
    .from('invitaciones')
    .insert({ email, usuario, rol: input.rol, sucursal_id: input.sucursal_id })
    .select('id')
    .single()
  if (errInv) throw new Error(`No se pudo autorizar el alta: ${errInv.message}`)

  // 2) La cuenta, en el cliente aislado.
  const aislado = crearClienteAislado()
  const { data, error } = await aislado.auth.signUp({ email, password })
  if (error) {
    // El alta no ocurrió: la autorización sobra y se retira.
    await supabase.from('invitaciones').delete().eq('id', invitacion.id)
    const m = error.message.toLowerCase()
    if (m.includes('already registered') || m.includes('already been registered')) {
      throw new Error('Ya existe una cuenta con ese correo.')
    }
    if (m.includes('password')) throw new Error('La contraseña no es válida para Supabase.')
    throw new Error(`No se pudo crear la cuenta: ${error.message}`)
  }

  const uid = data.user?.id
  if (!uid) throw new Error('La cuenta no se devolvió creada. Probá de nuevo.')

  // La sesión que nació acá no sirve para nada: se cierra en el acto.
  if (data.session) await aislado.auth.signOut().catch(() => undefined)

  // El nombre (si lo trajeron) se pone después: el trigger lo deja vacío.
  const nombre = input.nombre?.trim()
  if (nombre) await supabase.from('profiles').update({ nombre }).eq('id', uid)

  return {
    usuario,
    email,
    password,
    confirmacionPendiente: !data.session
  }
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

/**
 * Reinicia la contraseña de UN usuario desde Config → Usuarios.
 *
 * Va por `desbloquear_usuario`, la función que ya existía para el bloqueo:
 * pisa `auth.users.encrypted_password` con la clave nueva —se aplica al
 * instante, sin esperar correo— y, de paso, limpia `bloqueado` e
 * `intentos_fallidos` del perfil: reiniciar y desbloquear son el mismo
 * gesto, porque la clave vieja deja de servir de cualquier manera.
 *
 * El CUERPO de la función exige LÍDER activo: un rol distinto recibe el
 * error de la base, no un guard de la pantalla. Y no hay cambio forzoso:
 * el usuario entra con la clave nueva y la cambia cuando quiera desde su
 * perfil (Perfil → Cambiar contraseña).
 */
export async function reiniciarContrasena(id: string, passwordNueva: string): Promise<void> {
  const { error } = await supabase.rpc('desbloquear_usuario', { p_usuario_id: id, p_password_provisional: passwordNueva })
  if (error) throw new Error(error.message)
}

export async function listarAsignacionasAdmin(): Promise<Asignacion[]> {
  const { data } = await supabase.from('asignaciones').select('*')
  return (data ?? []) as Asignacion[]
}

export async function asignarEvaluador(evaluadorId: string, sucursalId: string): Promise<void> {
  // El `await` de un builder no rechaza: el error viene DENTRO de la
  // respuesta. Descartarlo era el modo en que la pantalla pintaba «Asignada»
  // una fila que la base rechazó — y que por eso nunca llegó a la bitácora.
  const { error } = await supabase
    .from('asignaciones')
    .upsert({ evaluador_id: evaluadorId, sucursal_id: sucursalId, activa: true }, { onConflict: 'evaluador_id,sucursal_id' })
  if (error) throw new Error(error.message || 'No se pudo asignar la sucursal al evaluador.')
}

export async function desasignarEvaluador(evaluadorId: string, sucursalId: string): Promise<void> {
  const { error } = await supabase
    .from('asignaciones')
    .update({ activa: false })
    .eq('evaluador_id', evaluadorId)
    .eq('sucursal_id', sucursalId)
  if (error) throw new Error(error.message || 'No se pudo quitar la sucursal del evaluador.')
}

export async function listarAsignacionesModulosAdmin(): Promise<AsignacionModulo[]> {
  const { data } = await supabase.from('asignaciones_modulos').select('*')
  return (data ?? []) as AsignacionModulo[]
}

export async function asignarModulo(evaluadorId: string, moduloId: string): Promise<void> {
  // El error se propaga con su mensaje original a propósito: el trigger
  // `validar_unico_evaluador_modulo` explica ahí por qué no se pudo («el
  // módulo no está compartido…») y taparlo con un «no se pudo guardar»
  // perdería la única pista de qué hacer.
  const { error } = await supabase
    .from('asignaciones_modulos')
    .upsert({ evaluador_id: evaluadorId, modulo_id: moduloId, activa: true }, { onConflict: 'evaluador_id,modulo_id' })
  if (error) throw new Error(error.message || 'No se pudo asignar el módulo al evaluador.')
}

export async function desasignarModulo(evaluadorId: string, moduloId: string): Promise<void> {
  const { error } = await supabase
    .from('asignaciones_modulos')
    .update({ activa: false })
    .eq('evaluador_id', evaluadorId)
    .eq('modulo_id', moduloId)
  if (error) throw new Error(error.message || 'No se pudo quitar el módulo del evaluador.')
}