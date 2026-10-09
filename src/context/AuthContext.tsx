import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { emailPorUsuario, intentoLogin } from '../lib/data/usuarios'
import { factorsTotpActivos } from '../lib/mfa'
import { guardarMfaCache, leerMfaCache, limpiarMfaCache } from '../lib/mfaEstado'
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

/**
 * Marca de que una consulta se pasó de tiempo. Es un objeto único para no
 * confundirse con una respuesta real.
 */
const VENCIDO = { vencido: true } as const

/**
 * Tope de espera para las consultas que bloquean el arranque.
 *
 * Se ha medido esta ruta de red devolviendo TTFB de 9 s y, en otro momento,
 * sin responder nunca (el proyecto entero, medido con /auth/v1/health). Sin tope,
 * un corte así deja la app en skeleton indefinidamente. Cuando vence se sigue
 * con el mismo criterio que ante un error: no se sabe y se continúa, que es lo
 * que ya hacía el `catch`.
 *
 * Acepta `PromiseLike` porque el cliente de PostgREST devuelve un builder
 * que se puede usar como promesa, no una promesa ya construida.
 */
function conTope<T>(p: PromiseLike<T>, ms: number): Promise<T | typeof VENCIDO> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<typeof VENCIDO>((r) => setTimeout(() => r(VENCIDO), ms))
  ])
}

/**
 * Type guard explícito: comparar con `===` no estrecha el tipo porque los
 * tipos de respuesta de supabase-js son lo bastante abiertos como para que
 * TypeScript no descarte la otra rama del union.
 */
function esVencido(x: unknown): x is typeof VENCIDO {
  return x === VENCIDO
}

const TOPE_MFA_MS = 6_000
const TOPE_PERFIL_MS = 8_000

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  /** Se está restaurando la sesión guardada (es local, no toca la red). */
  loading: boolean
  /**
   * Ya se sabe si hay que pedir TOTP y quién es el usuario: se puede pintar.
   * Separate de `loading` porque depende de la red y el arranque tiene que
   * poder salir del skeleton sin depender de ella.
   */
  perfilListo: boolean
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
  const [perfilListo, setPerfilListo] = useState(false)
  const [totpPendiente, setTotpPendiente] = useState(false)

  /**
   * ¿Este navegador ya tiene con qué pintar sin tocar la red?
   *
   * Hace falta el perfil (para el rol y la sucursal) y saber si la cuenta pide
   * TOTP (para no mostrar la app a medias). Los dos están cacheados en
   * localStorage, así que en una recarga normal se resuelven de forma síncrona y
   * la app abre al instante; la red queda sólo para refrescar en segundo plano.
   * En un navegador nuevo, sin nada cacheado, hay que esperar: no se puede
   * inventar el rol ni saltarse el TOTP.
   */
  const [perfilCacheado] = useState(() => {
    try {
      return !!localStorage.getItem(PROFILE_KEY)
    } catch {
      return false
    }
  })

  /**
   * ¿La sesión está en aal1 pero la cuenta exige aal2 (falta el TOTP)?
   *
   * `getAuthenticatorAssuranceLevel` hace un GET /auth/v1/user por dentro, que es
   * de los endpoints más lentos de Supabase. Como esto se repetía en cada carga,
   * el resultado se cachea (ver lib/mfaEstado): es una propiedad de la cuenta,
   * no de la sesión, y solo se invalida al enrolar/verificar/desactivar el TOTP.
   */
  const requiereNivel2 = useCallback(async (usuario: string): Promise<boolean> => {
    const cacheado = leerMfaCache(usuario)
    if (cacheado !== null) return cacheado
    try {
      const { data: { session } } = await supabase.auth.getSession()
      // Sin access_token no hay assurance level que mirar y `decodeJWT` reventaría
      // dentro de supabase-js: se trata como "no hace falta MFA", igual que un error.
      if (!session?.access_token) return false
      const authLevel = await conTope(
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(session.access_token),
        TOPE_MFA_MS
      )
      // Vencido: no se cachea nada, así la próxima carga vuelve a preguntarlo.
      if (esVencido(authLevel)) return false
      const pendiente = authLevel.data?.currentLevel !== 'aal2' && authLevel.data?.nextLevel === 'aal2'
      guardarMfaCache(usuario, pendiente)
      return pendiente
    } catch {
      // No se cachea el fallo: se reintenta en la próxima carga.
      return false
    }
  }, [])

  const cargarPerfil = useCallback(async (userId: string): Promise<Profile | null> => {
    const res = await conTope(
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      TOPE_PERFIL_MS
    )
    // Vencido: se conserva el perfil cacheado en lugar de dejarlo en null.
    if (esVencido(res)) return null
    const { data, error } = res
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
      setPerfilListo(false)
      setProfile(null)
      guardarPerfil(null)
      // El dato cacheado es de la cuenta que acaba de salir: no se hereda al
      // siguiente usuario que abra la app en este navegador.
      limpiarMfaCache()
      return
    }
    // Con perfil y MFA cacheados se puede pintar ya: el `profile` que hay en
    // estado viene del localStorage y el estado del TOTP también. Se suelta el
    // skeleton antes de tocar la red, y lo que viene del servidor sólo refresca
    // (rol actualizado, sucursal nueva) sin volver a bloquear.
    if (perfilCacheado && leerMfaCache(s.user.id) !== null) {
      setPerfilListo(true)
    }
    // MFA y perfil en paralelo. Antes iban en serie (`await requiereNivel2()` y
    // luego `await cargarPerfil()`), así que la pantalla de arranque pagaba las
    // dos esperas sumadas en vez de la más lenta.
    const [pend] = await Promise.all([requiereNivel2(s.user.id), cargarPerfil(s.user.id)])
    setTotpPendiente(pend)
    if (pend) {
      // Cuenta con MFA y sesión sin segundo factor: el perfil se borra para que
      // RequireAuth no llegue a pintar nada con la sesión a medias.
      setProfile(null)
      guardarPerfil(null)
    }
    // Si arriba se pintó desde caché, el perfil recién llegado ya está aplicado
    // por `cargarPerfil`; sólo queda confirmar que se puede volver a pintar.
    setPerfilListo(true)
  }, [requiereNivel2, cargarPerfil, perfilCacheado])

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
      void procesarSesion(sesionInicial).finally(() => {
        setPerfilListo(true)
        setLoading(false)
      })
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // INITIAL_SESSION llega con la misma sesión que el arranque de arriba ya
      // normalizó (refresh, "recordarme", sesión zombi). Procesarla otra vez
      // repetía el GET /auth/v1/user del MFA; con StrictMode en dev, dos veces
      // más. El resto de eventos sí interesan: SIGNED_IN, TOKEN_REFRESHED, etc.
      if (event === 'INITIAL_SESSION') return
      void procesarSesion(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [procesarSesion])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      perfilListo,
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
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) return { error: mensajeError(error.message) }
        localStorage.setItem(RECORDAR_KEY, recordar ? '1' : '0')
        // El id sale de la sesión que acaba de abrirse. Si viniera vacío, la
        // caché no aplica y la comprobación se hace contra el servidor.
        const pend = await requiereNivel2(data.session?.user.id ?? '')
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
        // La cuenta acaba de pasar a aal2: la caché decía "pendiente" y si se
        // deja, el próximo procesarSesion volvería a mandar a /login en bucle.
        limpiarMfaCache()
        setTotpPendiente(false)
        // El perfil pudo venir filtrado en el intento anterior, así que se recarga.
        if (session?.user?.id) await cargarPerfil(session.user.id)
        return {}
      }
    }),
    [session, profile, loading, perfilListo, totpPendiente, cargarPerfil, requiereNivel2]
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