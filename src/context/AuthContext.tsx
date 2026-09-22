import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { emailPorUsuario } from '../lib/data/usuarios'
import type { Profile, Rol } from '../lib/types'

const PROFILE_KEY = 'evaluxor.profile'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (usuario: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string) => Promise<{ error?: string; pending?: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateNombre: (nombre: string) => Promise<void>
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

  async function cargarPerfil(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error || !data) return null
    const p = data as Profile
    setProfile(p)
    guardarPerfil(p)
    return p
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s?.user) void cargarPerfil(s.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s?.user?.id) void cargarPerfil(s.user.id)
      else {
        setProfile(null)
        guardarPerfil(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      async signIn(usuario, password) {
        const email = await emailPorUsuario(usuario)
        if (!email) return { error: 'Usuario no encontrado o inactivo.' }
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? { error: mensajeError(error.message) } : {}
      },
      async signUp(email, password) {
        const { error } = await supabase.auth.signUp({ email, password })
        return error
          ? { error: mensajeError(error.message) }
          : { pending: true }
      },
      async signOut() {
        await supabase.auth.signOut()
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
      }
    }),
    [session, profile, loading]
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