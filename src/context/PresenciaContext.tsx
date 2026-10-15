import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useAuth } from './AuthContext'
import { useCatalog } from './CatalogContext'
import { supabase } from '../lib/supabase'
import { APP_VERSION, BUILD_ID } from '../lib/version'
import {
  etiquetaDispositivo,
  etiquetaPantalla,
  idDispositivo,
  perfilesConectados,
  type EstadoCanal,
  type PresenciaUsuario
} from '../lib/presencia'

/** Un solo canal para toda la app: anuncia en qué pantalla está cada usuario. */
const CANAL = 'presencia-evaluxor'

export type Conectado = PresenciaUsuario & { dispositivos: number }

interface PresenciaContextValue {
  /** Personas conectadas ahora, por id de perfil (incluye el propio usuario). */
  conectados: Record<string, Conectado>
  /** false si el canal no pudo suscribirse: la UI avisa y se apoya en la última sincronización. */
  disponible: boolean
  /** Pantalla del usuario actual (la misma que se anuncia a los demás). */
  miPantalla: string
}

const PresenciaContext = createContext<PresenciaContextValue | null>(null)

export function PresenciaProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const { sucursales, departamentos, modulos } = useCatalog()

  const [estado, setEstado] = useState<EstadoCanal>({})
  const [disponible, setDisponible] = useState(false)

  const perfilId = profile?.id ?? null
  const canalRef = useRef<RealtimeChannel | null>(null)
  // Último anuncio pagado: el callback de suscripción lo usa para no publicar un
  // payload viejo si el usuario todavía no se había unido.
  const anuncioRef = useRef<PresenciaUsuario | null>(null)

  const miPantalla = useMemo(
    () => etiquetaPantalla(pathname, { sucursales, departamentos, modulos }),
    [pathname, sucursales, departamentos, modulos]
  )

  // Último anuncio: se publica en el canal, no se usa para pintar (por eso va en un
  // ref y no en estado).
  const miAnuncio = useMemo<PresenciaUsuario | null>(
    () =>
      profile
        ? {
            id: profile.id,
            nombre: profile.nombre || profile.email,
            usuario: profile.usuario,
            rol: profile.rol,
            ruta: pathname,
            pantalla: miPantalla,
            dispositivo: etiquetaDispositivo(),
            // Con qué build corre el dispositivo: el líder ve así quién quedó
            // atrás y por eso le sigue fallando.
            version: APP_VERSION,
            build_id: BUILD_ID,
            sucursal_id: profile.sucursal_id,
            visto: Date.now()
          }
        : null,
    [profile, pathname, miPantalla]
  )

  const anunciar = useCallback((canal: RealtimeChannel | null) => {
    if (!canal || !anuncioRef.current) return
    if (canal.state !== 'joined') return // todavía no se unió: se anuncia al suscribirse
    void canal.track(anuncioRef.current)
  }, [])

  // Cambió de pantalla: se vuelve a anunciar para que el líder vea dónde está.
  useEffect(() => {
    anuncioRef.current = miAnuncio
    anunciar(canalRef.current)
  }, [miAnuncio, anunciar])

  // Canal: se abre una vez por sesión y se cierra al salir o cambiar de usuario.
  useEffect(() => {
    if (!perfilId) return
    const canal = supabase
      .channel(CANAL, { config: { presence: { key: `${perfilId}:${idDispositivo()}` } } })
      .on('presence', { event: 'sync' }, () => setEstado(canal.presenceState() as EstadoCanal))
      .on('presence', { event: 'join' }, () => setEstado(canal.presenceState() as EstadoCanal))
      .on('presence', { event: 'leave' }, () => setEstado(canal.presenceState() as EstadoCanal))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setDisponible(true)
          anunciar(canal)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Presence bloqueado en el proyecto: se degrada sin romper la app.
          setDisponible(false)
        }
      })
    canalRef.current = canal
    return () => {
      canalRef.current = null
      void supabase.removeChannel(canal)
    }
  }, [perfilId, anunciar])

  // Si se cae la señal, se avisa al instante (si no, el otro tarda ~30 s en
  // desaparecer del panel del líder). Al volver, se anuncia de nuevo.
  useEffect(() => {
    if (!perfilId) return
    const salir = () => {
      const canal = canalRef.current
      if (canal?.state === 'joined') void canal.untrack()
    }
    const volver = () => anunciar(canalRef.current)
    window.addEventListener('offline', salir)
    window.addEventListener('online', volver)
    return () => {
      window.removeEventListener('offline', salir)
      window.removeEventListener('online', volver)
    }
  }, [perfilId, anunciar])

  const conectados = useMemo(() => perfilesConectados(estado), [estado])

  const value = useMemo<PresenciaContextValue>(
    () => ({ conectados, disponible, miPantalla }),
    [conectados, disponible, miPantalla]
  )

  return <PresenciaContext.Provider value={value}>{children}</PresenciaContext.Provider>
}

export function usePresencia(): PresenciaContextValue {
  return useContext(PresenciaContext) ?? { conectados: {}, disponible: false, miPantalla: '' }
}
