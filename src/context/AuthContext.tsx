import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { emailPorUsuario, intentoLogin } from '../lib/data/usuarios'
import { factorsTotpActivos } from '../lib/mfa'
import type { Profile, Rol } from '../lib/types'

const PROFILE_KEY = 'evaluxor.profile'
const RECORDAR_KEY = 'evaluxor.recordar'

/**
 * Mismo margen que supabase-js (EXPIRY_MARGIN_MS = 3 ticks x 30 s) a partir del
 * cual el cliente intenta renovar el access token. Se usa para verificar en el
 * arranque que la sesión guardada sigue siendo renovable.
 */
const MARGIN_REFRESCO_MS = 90_000

/** "Recordarme": la sesión se restaura tras volver a abrir la app solo si quedó marcado. */
function leerRecordar(): boolean {
  return localStorage.getItem(RECORDAR_KEY) !== '0'
}

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  totpPendiente: boolean
  signIn: (usuario: string, password: string, recordar?: boolean) => Promise<{ error?: string; totp?: boolean }>
  signUp: (email: string, password: string) => Promise<{ error?: string; pending?: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateNombre: (nombre: string) => Promise<void>
  cambiarPassword: (actual: string, nueva: string) => Promise<{ error?: string }>
  verificarTotp: (codigo: string) => Promise<{ error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function guardarPerfil(p: Profile | null) {
  if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  else localStorage.removeItem(PROFILE_KEY)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY)
      return raw ? (JSON.parse(raw) as Profile) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)
  const [totpPendiente, setTotpPendiente] = useState(false)

  const requiereNivel2 = useCallback(async (): Promise<boolean> => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const authLevel = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(session?.access_token)
      return authLevel.data?.currentLevel !== 'aal2' && authLevel.data?.nextLevel === 'aal2'
    } catch {
      return false
    }
  }, [])

  const cargarPerfil = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error || !data) return null
    const p = data as Profile
    setProfile(p)
    guardarPerfil(p)
    return p
  }, [])

  const procesarSesion = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!s) {
      setTotpPendiente(false)
      setProfile(null)
      guardarPerfil(null)
      return
    }
    const pend = await requiereNivel2()
    setTotpPendiente(pend)
    if (pend) {
      setProfile(null)
      guardarPerfil(null)
    } else {
      await cargarPerfil(s.user.id)
    }
  }, [requiereNivel2, cargarPerfil])

  useEffect(() => {
    void (async () => {
      let sesionInicial: Session | null = null
      try {
        const { data: { session: s }, error } = await supabase.auth.getSession()
        sesionInicial = s
        if (error) {
          // El arranque no pudo recuperar la sesión guardada: se limpia lo local.
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
          sesionInicial = null
        } else if (s && !leerRecordar()) {
          // El usuario pidió "no recordarme": al volver a abrir la app se cierra la sesión local.
          await supabase.auth.signOut().catch(() => {})
          sesionInicial = null
        } else if (s && (s.expires_at ?? Infinity) * 1000 - Date.now() < MARGIN_REFRESCO_MS) {
          // El access token está por vencer y la app debe renovarlo. Si el token de
          // refresco ya no es válido (400 invalid_grant, p. ej. tras rotar las claves
          // JWT en Supabase), la sesión queda "zombie": supabase-js la conserva y el
          // error se repetiría en cada carga hasta la expiración. Se cierra la sesión
          // local para arrancar limpio. Los errores de red NO cierran la sesión, así
          // la app sigue abriéndose normalmente sin conexión.
          try {
            const { data, error: refError } = await supabase.auth.refreshSession()
            if (refError && !isAuthRetryableFetchError(refError)) {
              await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
              sesionInicial = null
            } else if (data.session) {
              sesionInicial = data.session
            }
          } catch {
            // Red caída durante la verificación: se conserva la sesión guardada.
          }
        }
      } catch {
        // Cualquier fallo de arranque se resuelve como "sin sesión".
        sesionInicial = null
      }
      void procesarSesion(sesionInicial).finally(() => setLoading(false))
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      void procesarSesion(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [procesarSesion])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      totpPendiente,
      async signIn(usuario, password, recordar = true) {
        let intento: Awaited<ReturnType<typeof intentoLogin>>
        try {
          intento = await intentoLogin(usuario, password)
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'No se pudo iniciar sesión. Revisá la consola.' }
        }
        if (intento.bloqueado) {
          return { error: 'Tu usuario está bloqueado por demasiados intentos fallidos. El Líder debe desbloquearlo asignándole una contraseña provisional.' }
        }
        if (!intento.ok) {
          const email = await emailPorUsuario(usuario)
          if (!email) return { error: 'Usuario no encontrado o inactivo.' }
          const n = intento.restantes
          if (n <= 0) return { error: 'Usuario bloqueado por intentos fallidos. Solo el Líder puede desbloquearte con una contraseña provisional.' }
          return { error: `Contraseña incorrecta. Te quedan ${n} intento${n === 1 ? '' : 's'} antes de quedar bloqueado.` }
        }
        const email = await emailPorUsuario(usuario)
        if (!email) return { error: 'Usuario no encontrado o inactivo.' }
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) return { error: mensajeError(error.message) }
        localStorage.setItem(RECORDAR_KEY, recordar ? '1' : '0')
        const pend = await requiereNivel2()
        setTotpPendiente(pend)
        return pend ? { totp: true } : {}
      },
      async signUp(email, password) {
        const { error } = await supabase.auth.signUp({ email, password })
        return error
          ? { error: mensajeError(error.message) }
          : { pending: true }
      },
      async signOut() {
        await supabase.auth.signOut()
        setTotpPendiente(false)
        setProfile(null)
        guardarPerfil(null)
      },
      async refreshProfile() {
        if (session?.user?.id) await cargarPerfil(session.user.id)
      },
      async updateNombre(nombre) {
        if (!profile) return
        const { error } = await supabase
          .from('profiles')
          .update({ nombre })
          .eq('id', profile.id)
        if (!error) await cargarPerfil(profile.id)
      },
      async cambiarPassword(actual, nueva) {
        if (!session?.user?.email) return { error: 'No hay sesión activa.' }
        const ver = await supabase.auth.signInWithPassword({ email: session.user.email, password: actual })
        if (ver.error) return { error: 'La contraseña actual es incorrecta.' }
        const { error } = await supabase.auth.updateUser({ password: nueva })
        return error ? { error: mensajeError(error.message) } : {}
      },
      async verificarTotp(codigo) {
        const activos = await factorsTotpActivos()
        const factor = activos[0]
        if (!factor) return { error: 'No hay verificación en dos pasos activa en esta cuenta.' }
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo })
        if (error) return { error: 'El código no es válido o expiró. Intenta de nuevo.' }
        return {}
      }
    }),
    [session, profile, loading, totpPendiente, cargarPerfil, requiereNivel2]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

export function mensajeError(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (m.includes('no permitido') || m.includes('invitación') || m.includes('invitacion') || m.includes('solo el líder')) return 'Acceso solo por invitación: solicita tu enlace al Líder.'
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.'
  if (m.includes('already registered') || m.includes('already been registered')) return 'Ese correo ya está registrado. Solicita una invitación al Líder si olvidaste tu acceso.'
  if (m.includes('password')) return 'La contraseña debe tener al menos 6 caracteres.'
  if (m.includes('email')) return 'Revisa el formato del correo.'
  return msg
}

export function tieneRol(p: Profile | null, roles: Rol[]): boolean {
  return !!p && p.rol !== 'SIN_ROL' && roles.includes(p.rol)
}