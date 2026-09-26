import { Gauge, FolderOpen, History, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, SlidersHorizontal, Store, Users, X, ClipboardCheck } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { DashboardFiltersProvider, useDashboardFilters } from '../../context/DashboardFiltersContext'
import { puedeConfigurar } from '../../lib/roles'
import { SyncBanner } from './MobileLayout'
import { BarraKpis } from '../dashboard/BarraKpis'
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

const titulosVista: Record<string, { titulo: string; subtitulo: string }> = {
  '/dashboard': { titulo: 'Indicadores de gestión', subtitulo: 'Desempeño de las evaluaciones 360' },
  '/dashboard/historial': { titulo: 'Historial de evaluaciones', subtitulo: 'Programación, seguimiento y cierre de evaluaciones' },
  '/dashboard/comparativas': { titulo: 'Comparativas', subtitulo: 'Analiza el desempeño por evaluador, mes o sucursal' },
  '/config/sucursales': { titulo: 'Sucursales', subtitulo: 'Registro de supermercados a evaluar' },
  '/config/modulos': { titulo: 'Módulos', subtitulo: 'Áreas que se evalúan en cada visita' },
  '/config/items': { titulo: 'Ítems de evaluación', subtitulo: 'Preguntas y criterios de cada módulo' },
  '/config/usuarios': { titulo: 'Usuarios', subtitulo: 'Gestión de roles y accesos' }
}

export function ConsoleLayout() {
  return (
    <DashboardFiltersProvider>
      <ConsoleLayoutContenido />
    </DashboardFiltersProvider>
  )
}

function ConsoleLayoutContenido() {
  const { profile, signOut } = useAuth()
  const { abierto: filtrosAbiertos, alternar: alternarFiltros } = useDashboardFilters()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const tituloVista = titulosVista[pathname]
  const esDashboard = pathname.startsWith('/dashboard')
  const puedeEvaluar = profile?.rol === 'EVALUADOR' || profile?.rol === 'LIDER'
  const navRef = useRef<HTMLElement | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [colapsado, setColapsado] = useState<boolean>(() => localStorage.getItem('evaluxor:menu_lateral_cerrado') === '1')
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  const [barra, setBarra] = useState<{ top: number; height: number } | null>(null)

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

  useEffect(() => {
    function actualizar() {
      const nav = navRef.current
      const activo = nav?.querySelector<HTMLElement>('a[aria-current="page"]')
      setBarra(activo && !colapsado ? { top: activo.offsetTop, height: activo.offsetHeight } : null)
    }
    actualizar()
    window.addEventListener('resize', actualizar)
    return () => window.removeEventListener('resize', actualizar)
  }, [colapsado, pathname])

  function mostrarTip(label: string, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    setTip({ label, top: r.top + r.height / 2 })
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white text-slate-800 transition-[width,transform]',
          colapsado && 'lg:w-16',
          abierto ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0'
        )}
      >
        <div className={cn('flex items-center justify-between px-5 py-5', colapsado && 'lg:justify-center lg:px-1')}>
          <div className={cn(colapsado && 'lg:hidden')}>
            <h1 className="text-xl font-extrabold text-primary">EvaLuxor</h1>
            <p className="text-xs text-slate-500">Indicadores de gestión</p>
          </div>
          <div className={cn('hidden text-lg font-extrabold text-primary', colapsado && 'lg:block')}>E</div>
          <button onClick={() => setAbierto(false)} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 lg:hidden"><X className="h-5 w-5" /></button>
        </div>

        <nav ref={navRef} className={cn('relative flex-1 space-y-6 overflow-y-auto px-3 pb-6', colapsado && 'lg:px-0')}>
          {!colapsado && barra ? (
            <span
              aria-hidden
              className="absolute left-3 right-3 z-0 rounded-xl bg-amber-300/40 transition-all duration-300 ease-out"
              style={{ top: barra.top, height: barra.height }}
            />
          ) : null}
          <div className="space-y-6">
            {puedeEvaluar ? (
              <Link
                to="/evaluar"
                onClick={() => setAbierto(false)}
                className="flex items-center gap-3 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 lg:hidden"
              >
                <ClipboardCheck className="h-5 w-5 shrink-0" />
                Evaluaciones
              </Link>
            ) : null}
            {secciones.length ? secciones.map((s) => (
            <div key={s.seccion}>
              <p className={cn('px-3 pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400', colapsado && 'lg:hidden')}>{s.seccion}</p>
              <ul className="space-y-1">
                {s.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      onClick={() => setAbierto(false)}
                      onMouseEnter={(e) => mostrarTip(i.label, e.currentTarget)}
                      onMouseLeave={() => setTip(null)}
                      onFocus={(e) => mostrarTip(i.label, e.currentTarget)}
                      onBlur={() => setTip(null)}
                      className={({ isActive }) =>
                        cn('relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                          colapsado && 'lg:justify-center lg:px-0',
                          isActive ? 'text-slate-900' : 'text-slate-700 hover:bg-primary-50')
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className={cn(
                            'shrink-0 rounded-lg text-primary transition-transform duration-300 ease-out',
                            isActive ? 'scale-125' : 'scale-100',
                            isActive && colapsado ? 'bg-amber-300/40 p-1' : ''
                          )}>{i.icon}</span>
                          <span className={cn('truncate', colapsado && 'lg:hidden')}>{i.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )) : null}
          </div>
        </nav>

        <div className={cn('border-t border-slate-200 px-5 py-4', colapsado && 'lg:flex lg:flex-col lg:items-center lg:px-0')}>
          <p className={cn('truncate text-sm font-semibold', colapsado && 'lg:hidden')}>{profile?.nombre || profile?.email}</p>
          <NavLink
            to="/perfil"
            onMouseEnter={(e) => mostrarTip('Mi perfil / contraseña', e.currentTarget)}
            onMouseLeave={() => setTip(null)}
            onFocus={(e) => mostrarTip('Mi perfil / contraseña', e.currentTarget)}
            onBlur={() => setTip(null)}
            className={cn('mt-2 flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-700', colapsado && 'lg:justify-center lg:px-0')}
          >
            <Settings className="h-4 w-4" />
            <span className={cn(colapsado && 'lg:hidden')}>Mi perfil / contraseña</span>
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

      <span
        className={cn(
          'pointer-events-none fixed left-[4.5rem] z-[60] flex -translate-y-1/2 items-center',
          colapsado && tip ? 'opacity-100' : 'opacity-0'
        )}
        style={{ top: tip?.top ?? 0 }}
      >
        <span aria-hidden className="h-0 w-0 border-y-[5px] border-r-[6px] border-y-transparent border-r-primary" />
        <span className="whitespace-nowrap rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg">
          {tip?.label}
        </span>
      </span>

      <div className={cn('transition-[padding]', colapsado ? 'lg:pl-16' : 'lg:pl-64')}>
        <div className="sticky top-0 z-20 bg-white">
          <header className="flex min-h-16 items-center gap-1 border-b border-slate-200 bg-white px-4 py-2.5">
          <button
            onClick={() => {
              setColapsado((c) => {
                localStorage.setItem('evaluxor:menu_lateral_cerrado', c ? '0' : '1')
                return !c
              })
            }}
            title={colapsado ? 'Mostrar menú completo' : 'Compactar menú'}
            className="hidden h-10 w-10 place-items-center rounded-full text-primary hover:bg-primary-50 lg:grid"
          >
            {colapsado ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          <button onClick={() => setAbierto(true)} className="grid h-10 w-10 place-items-center rounded-full text-primary hover:bg-primary-50 lg:hidden">
            <Menu className="h-6 w-6" />
          </button>
          {tituloVista ? (
            <div className="min-w-0">
              <h1 className="truncate text-base font-extrabold leading-tight text-primary-900">{tituloVista.titulo}</h1>
              <p className="truncate text-xs leading-tight text-slate-500">{tituloVista.subtitulo}</p>
            </div>
          ) : <div className="text-primary font-extrabold lg:hidden">EvaLuxor</div>}
          {esDashboard ? (
            <button
              type="button"
              onClick={alternarFiltros}
              aria-expanded={filtrosAbiertos}
              aria-controls="dashboard-filters-panel"
              className={cn('ml-auto inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors', filtrosAbiertos ? 'border-primary bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary')}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
            </button>
          ) : null}
          <button
            onClick={() => {
              const target = profile?.rol === 'EVALUADOR' || profile?.rol === 'LIDER' ? '/evaluar' : '#'
              if (target !== '#') navigate(target)
            }}
            className={cn('hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 lg:block', !esDashboard && 'ml-auto', esDashboard && 'ml-2')}
          >
            Ir a evaluaciones
          </button>
        </header>
        {esDashboard ? (
          <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', filtrosAbiertos ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
            <div className="min-h-0 overflow-hidden border-b border-slate-200 bg-slate-50">
              <div id="dashboard-filters-panel" />
            </div>
          </div>
        ) : null}
        </div>
        {pathname === '/dashboard' ? <BarraKpis /> : null}
        <SyncBanner />
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}