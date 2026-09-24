import { Gauge, FolderOpen, History, LogOut, Menu, Settings, Store, Users, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { puedeConfigurar } from '../../lib/roles'
import { SyncBanner } from './MobileLayout'
import { cn } from '../ui'

interface EnlaceMenu {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
}

const enlaces: { seccion: string; items: EnlaceMenu[] }[] = [
  { seccion: 'Resultados', items: [
    { to: '/dashboard', label: 'Indicadores', end: true, icon: <Gauge className="h-5 w-5" /> },
    { to: '/dashboard/historial', label: 'Historial', icon: <History className="h-5 w-5" /> }
  ]}
]

export function ConsoleLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)

  const config: { seccion: string; items: EnlaceMenu[] }[] = puedeConfigurar(profile?.rol ?? 'SIN_ROL') && profile ? [
    {
      seccion: 'Gestión',
      items: [
        { to: '/config/sucursales', label: 'Sucursales', icon: <Store className="h-5 w-5" /> },
        { to: '/config/modulos', label: 'Módulos', icon: <FolderOpen className="h-5 w-5" /> },
        { to: '/config/usuarios', label: 'Usuarios', icon: <Users className="h-5 w-5" /> }
      ]
    }
  ] : []

  const secciones = [...enlaces, ...config]

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-slate-200 bg-white text-slate-800 transition-transform lg:translate-x-0', abierto ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center justify-between px-5 py-5">
          <div>
            <h1 className="text-xl font-extrabold text-primary">EvaLuxor</h1>
            <p className="text-xs text-slate-500">Indicadores de gestión</p>
          </div>
          <button onClick={() => setAbierto(false)} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 lg:hidden"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
          {secciones.length ? secciones.map((s) => (
            <div key={s.seccion}>
              <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{s.seccion}</p>
              <ul className="space-y-1">
                {s.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      onClick={() => setAbierto(false)}
                      className={({ isActive }) =>
                        cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                          isActive ? 'bg-primary text-white' : 'text-slate-700 hover:bg-primary-50')
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className={cn('shrink-0', isActive ? 'text-white' : 'text-primary')}>{i.icon}</span>
                          {i.label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )) : null}
        </nav>
        <div className="border-t border-slate-200 px-5 py-4">
          <p className="truncate text-sm font-semibold">{profile?.nombre || profile?.email}</p>
          <NavLink to="/perfil" className="mt-2 flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-700">
            <Settings className="h-4 w-4" /> Mi perfil / contraseña
          </NavLink>
          <button
            onClick={() => void signOut()}
            title="Cerrar sesión"
            className="mt-2 grid h-8 w-8 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {abierto ? <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setAbierto(false)} /> : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <button onClick={() => setAbierto(true)} className="grid h-10 w-10 place-items-center rounded-full text-primary hover:bg-primary-50 lg:hidden">
            <Menu className="h-6 w-6" />
          </button>
          <div className="text-primary font-extrabold lg:hidden">EvaLuxor</div>
          <button
            onClick={() => {
              const target = profile?.rol === 'EVALUADOR' || profile?.rol === 'LIDER' ? '/evaluar' : '#'
              if (target !== '#') navigate(target)
            }}
            className="ml-auto hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 lg:block"
          >
            Ir a evaluaciones
          </button>
        </header>
        <SyncBanner />
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}