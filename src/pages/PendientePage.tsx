import { Navigate } from 'react-router-dom'
import { Hourglass } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { homePorRol } from '../lib/roles'

export function HomeRedirect() {
  const { session, profile, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={homePorRol(profile.rol)} replace />
}

export function PendientePage() {
  const { profile, signOut } = useAuth()
  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-amber-100"><Hourglass className="h-7 w-7 text-amber-600" /></div>
        <h1 className="text-lg font-bold text-primary-900">Cuenta pendiente</h1>
        <p className="mt-2 text-sm text-slate-600">
          Tu cuenta <strong>{profile?.email}</strong> aún no tiene un rol asignado. Contacta al <strong>Líder</strong> para que te habilite el acceso.
        </p>
        <button
          onClick={() => void signOut()}
          className="mt-5 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}