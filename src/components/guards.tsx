import { Navigate, useLocation } from 'react-router-dom'
import { useAuth, tieneRol } from '../context/AuthContext'
import { homePorRol } from '../lib/roles'
import type { Rol } from '../lib/types'
import { SkeletonPantalla } from './ui'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, totpPendiente } = useAuth()
  const location = useLocation()

  if (loading) {
    return <SkeletonPantalla completa />
  }
  if (totpPendiente || !session) return <Navigate to="/login" state={{ from: location }} replace />
  if (profile?.rol === 'SIN_ROL') return <Navigate to="/pendiente" replace />
  return <>{children}</>
}

export function RequireRol({ roles, children }: { roles: Rol[]; children: React.ReactNode }) {
  const { profile } = useAuth()
  if (!profile || !tieneRol(profile, roles)) {
    return <Navigate to={profile ? homePorRol(profile.rol) : '/login'} replace />
  }
  return <>{children}</>
}

export function RequireSesion({ children }: { children: React.ReactNode }) {
  const { session, totpPendiente } = useAuth()
  if (totpPendiente || !session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function SoloLider({ children }: { children: React.ReactNode }) {
  return <RequireRol roles={['LIDER']}>{children}</RequireRol>
}