import { Star, Gauge, FolderOpen, History, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, SlidersHorizontal, Store, Users, X, ClipboardCheck } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { DashboardFiltersProvider, useDashboardFilters } from '../../context/DashboardFiltersContext'
import { puedeConfigurar } from '../../lib/roles'
import { TemaInterruptor } from '../TemaInterruptor'
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
    { to: '/dashboard/responsables', label: 'Seguimiento por cargo', icon: <Users className="h-5 w-5" /> },
    { to: '/dashboard/historial', label: 'Historial', icon: <History className="h-5 w-5" /> }
  ]}
]

const titulosVista: Record<string, { titulo: string; subtitulo: string }> = {
  '/dashboard': { titulo: 'Indicadores de gestión', subtitulo: 'Desempeño de las evaluaciones 360' },
  '/dashboard/historial': { titulo: 'Historial de evaluaciones', subtitulo: 'Programación, seguimiento y cierre de evaluaciones' },
  '/dashboard/comparativas': { titulo: 'Comparativas', subtitulo: 'Analiza el desempeño por evaluador, mes o sucursal' },
  '/dashboard/responsables': { titulo: 'Seguimiento por cargo', subtitulo: 'Nota promedio de cada responsable por sucursal' },
  '/config/usuarios': { titulo: 'Usuarios', subtitulo: 'Gestión de roles y accesos' },
  '/config/unidades': { titulo: 'Unidades', subtitulo: 'Registro de sucursales y departamentos' },
  '/config/modulos': { titulo: 'Módulos', subtitulo: 'Configuración y explicación de cada módulo' },
  '/config/bonos': { titulo: 'Bonos por desempeño', subtitulo: 'Cargos que gozan de bono y pago de los mismos' },
  // La cuenta se configura DESDE la consola, con su barra y su menú: salirse
  // de la barra para cambiar la contraseña se sentía como otra app.
  '/perfil': { titulo: 'Configuración', subtitulo: 'Administra tus datos personales y la seguridad de tu cuenta' }
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
  const { pathname } = useLocation()
  const tituloVista =
    titulosVista[pathname] ??
    (pathname.startsWith('/dashboard/modulo/')
      ? { titulo: 'Dashboard del módulo', subtitulo: 'Ítems del módulo con el gráfico más idóneo según su tipo' }
      : undefined)
  const esDashboard = pathname.startsWith('/dashboard')
  // Las vistas de indicadores (panel principal y el dashboard de un módulo) se
  // llevan todo el ancho de la pantalla: su grilla de tarjetas y gráficos vive
  // en columnas y el ancho centrado de 1280px dejaba media pantalla vacía.
  const anchoTotal = pathname === '/dashboard' || pathname.startsWith('/dashboard/modulo/')
  const puedeEvaluar = profile?.rol === 'EVALUADOR' || profile?.rol === 'LIDER'
  const navRef = useRef<HTMLElement | null>(null)
  const cuentaRef = useRef<HTMLDivElement | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [cuentaAbierta, setCuentaAbierta] = useState(false)
  // Por defecto la barra va cerrada (el modo de la imagen: sólo iconos, flotando);
  // quien la abra queda con su elección guardada.
  const [colapsado, setColapsado] = useState<boolean>(() => localStorage.getItem('evaluxor:menu_lateral_cerrado') !== '0')
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)

  const config: { seccion: string; items: EnlaceMenu[] }[] = puedeConfigurar(profile?.rol ?? 'SIN_ROL') && profile ? [
    {
      seccion: 'Gestión',
      items: [
        { to: '/config/unidades', label: 'Unidades', icon: <Store className="h-5 w-5" /> },
        { to: '/config/modulos', label: 'Módulos', icon: <FolderOpen className="h-5 w-5" /> },
        { to: '/config/usuarios', label: 'Usuarios', icon: <Users className="h-5 w-5" /> },
        // Bonos por desempeño: acá entra también el Gerente de Talento Humano
        // (la ruta lo permite y `puede_bonos` es la misma cerradura en RLS).
        { to: '/config/bonos', label: 'Bonos', icon: <Star className="h-5 w-5" /> }
      ]
    }
  ] : profile && profile.rol === 'GERENTE_TH' ? [
    // El Gerente de Talento Humano no configura evaluaciones —por eso no ve
    // «Gestión» completa— pero su área es la dueña de los bonos: su menú es
    // ese módulo y nada más.
    {
      seccion: 'Gestión',
      items: [
        { to: '/config/bonos', label: 'Bonos', icon: <Star className="h-5 w-5" /> }
      ]
    }
  ] : profile && profile.rol === 'EVALUADOR' ? [
    // El evaluador no configura nada, pero sí necesita entrar a Módulos para
    // bajar la explicación de cada uno (la página lo muestra en modo consulta,
    // sin editar ni borrar). Va en su propia sección: "Gestión" diría lo contrario.
    {
      seccion: 'Consulta',
      items: [
        { to: '/config/modulos', label: 'Módulos', icon: <FolderOpen className="h-5 w-5" /> }
      ]
    }
  ] : []

  // La inspección de vehículo no vive en la consola: se llena desde el
  // teléfono, en /evaluar, con su propia tarjeta en EvaluarHome.
  const secciones = [...enlaces, ...config]

  useEffect(() => {
    // Cerrar el panel lateral móvil con Escape.
    if (!abierto) return
    const manejar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('keydown', manejar)
    return () => window.removeEventListener('keydown', manejar)
  }, [abierto])

  // El menú de la cuenta se cierra con Escape y con un toque afuera: un menú
  // que sólo se cierra volviendo a tocar la inicial es una trampa en el
  // teléfono.
  useEffect(() => {
    if (!cuentaAbierta) return
    const manejar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCuentaAbierta(false)
    }
    const afuera = (e: MouseEvent) => {
      if (!cuentaRef.current?.contains(e.target as Node)) setCuentaAbierta(false)
    }
    window.addEventListener('keydown', manejar)
    window.addEventListener('mousedown', afuera)
    return () => {
      window.removeEventListener('keydown', manejar)
      window.removeEventListener('mousedown', afuera)
    }
  }, [cuentaAbierta])

  function mostrarTip(label: string, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    setTip({ label, top: r.top + r.height / 2 })
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <aside
        className={cn(
          // La barra FLOTA sobre el fondo: redondeada, sin borde y con sombra,
          // pegada al borde izquierdo con un margen. En el teléfono sigue siendo
          // un cajón que cubre la pantalla entera, por eso sólo flota en
          // escritorio.
          //
          // El ancho cambia con `duration-200 ease-out` para que la apertura se
          // sienta ágil. NO lleva `overflow-hidden`: el menú de la cuenta se
          // despliega hacia afuera de los 64px de la barra y ese recorte se lo
          // comía en escritorio (en el teléfono no, porque el cajón es ancho y
          // el menú cae adentro). El recorte de los rótulos durante la animación
          // lo hace el `nav`, que ya es scroller.
          'fixed inset-y-0 left-0 z-40 my-4 ml-3 flex w-64 flex-col rounded-2xl bg-white text-slate-800 shadow-xl transition-[width,transform] duration-200 ease-out max-lg:my-0 max-lg:ml-0 max-lg:rounded-none max-lg:shadow-none',
          colapsado && 'lg:w-16',
          abierto ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0'
        )}
      >
        <div className={cn('flex items-center justify-between px-4 py-4', colapsado && 'lg:justify-center lg:px-1')}>
          {/* La marca se adapta al ancho del menú: desplegado entra el logo
              completo (isotipo + nombre) y cerrado queda sólo el isotipo, que es
              lo único que cabe en los 64px sin recortarse. El título sigue
              siendo un <h1>, aunque oculto, para que el nombre de la app no
              desaparezca del árbol accesible. */}
          <h1 className="sr-only">EvaLuxor</h1>
          <div className={cn(colapsado && 'lg:hidden')}>
            <img src="/completo.webp" alt="" className="h-auto w-40 max-w-full" />
            <p className="mt-1 text-xs text-slate-500">Indicadores de gestión</p>
          </div>
          {/* El isotipo cerrado es el ancla visual de la barra: en su círculo,
              arriba del todo, como en cualquier barra de atajos. */}
          <img
            src="/isotipo.webp"
            alt=""
            className={cn('hidden h-10 w-10 rounded-full bg-slate-50 object-contain p-1', colapsado && 'lg:block')}
          />
          <button onClick={() => setAbierto(false)} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 lg:hidden"><X className="h-5 w-5" /></button>
        </div>

        {/* `overflow-x-hidden`: durante el cambio de ancho los rótulos se
            recortan acá (y no saliéndose de la barra) sin que el menú de la
            cuenta se vea afectado, que vive en el pie. */}
        <nav ref={navRef} className={cn('relative min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pb-4', colapsado && 'lg:px-2')}>
          <div className="space-y-4">
            {/* «Ir a evaluaciones» estaba en la cabecera, a la derecha de
                Filtros; se muda al menú para que la barra superior quede sólo
                para filtros y acciones de la vista. Mismo destino de siempre,
                y sólo para quien puede evaluar (antes el botón existía para
                todos pero no hacía nada si no era EVALUADOR/LÍDER). Es la
                acción principal de la barra: por eso va en su cuadrito
                azul, no como un enlace más. */}
            {puedeEvaluar ? (
              <Link
                to="/evaluar"
                onClick={() => setAbierto(false)}
                title="Ir a evaluaciones"
                className={cn(
                  // Amarillo con el icono azul: es la acción que no es de
                  // navegación y tiene que leerse como un botón, no como un
                  // enlace más de la lista.
                  // Amarillo con icono y texto de marca FIJOS: el amarillo
                  // `bg-yellow-400` no cambia en oscuro, así que tampoco puede
                  // cambiar el azul que va encima. Con `text-primary-700` el
                  // tema oscuro lo aclaraba a `#9cc1ef` y quedaba azul
                  // clarito sobre amarillo, ilegible.
                  'flex items-center gap-3 rounded-2xl bg-yellow-400 px-3 py-2.5 text-sm font-semibold text-[#28315F] shadow-md transition-colors hover:bg-yellow-300',
                  colapsado && 'lg:justify-center lg:px-0'
                )}
              >
                <ClipboardCheck className="h-5 w-5 shrink-0 text-[#28315F]" />
                <span className={cn(colapsado && 'lg:hidden')}>Ir a evaluaciones</span>
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
                        cn('relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors',
                          colapsado && 'lg:justify-center lg:px-0',
                          // La página activa se marca con una sombra amarilla:
                          // en una barra sólo de iconos es lo único que dice
                          // «estás acá» sin depender del hover.
                          isActive ? 'bg-yellow-50 text-primary-900 shadow-[0_0_0_2px_#facc15]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')
                      }
                    >
                      {() => (
                        <>
                          <span className="shrink-0">{i.icon}</span>
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

        {/* El pie es `shrink-0` y el nav de arriba `min-h-0`: sin eso el nav no
            puede bajar de su contenido y empuja el pie fuera de la barra, donde
            `overflow-hidden` se lo comía. */}
        <div className={cn('relative shrink-0 border-t border-slate-200 px-3 py-3', colapsado && 'lg:flex lg:flex-col lg:items-center lg:px-0')}>
          {/* Sólo UNA pieza a la vez: cerrada, la inicial en su pastilla azul;
              abierta, el nombre del usuario. En el teléfono el cajón está
              abierto, así que manda el nombre (las clases del modo cerrado son
              de escritorio). */}
          <div ref={cuentaRef} className="relative flex w-full flex-col items-center">
            {cuentaAbierta ? (
              <div
                role="menu"
                className={cn(
                  'absolute z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl',
                  // Sale HACIA ARRIBA del nombre, sobre la barra. Sólo con la
                  // barra cerrada se corre a su derecha: ahí no hay ancho para
                  // desplegarlo encima sin taparlo con su propia pastilla.
                  'bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2',
                  colapsado ? 'w-60 lg:bottom-0 lg:left-full lg:translate-x-3' : 'w-full'
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-black text-white" aria-hidden>
                    {(profile?.nombre || profile?.email || 'U').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {profile?.nombre || 'Sin nombre'}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{profile?.email}</span>
                  </span>
                </div>
                <div className="border-t border-slate-100">
                  <Link
                    to="/perfil"
                    role="menuitem"
                    onClick={() => setCuentaAbierta(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Settings className="h-4 w-4 text-slate-400" />
                    Configuración
                  </Link>
                </div>
                <div className="border-t border-slate-100">
                  {/* El mismo interruptor del modo de evaluación: una pieza,
                      dos menús. */}
                  <TemaInterruptor className="px-4" />
                </div>
                <div className="border-t border-slate-100">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <LogOut className="h-4 w-4 text-slate-400" />
                    Cerrar sesión
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={cuentaAbierta}
              aria-label="Mi cuenta"
              title="Mi cuenta"
              onClick={() => setCuentaAbierta((v) => !v)}
              className={cn(
                // `items-center justify-center` y no `place-items-center`: éste
                // sólo centra en grid y el botón es flex, así que la inicial
                // se iba pegada al borde izquierdo de la pastilla.
                'hidden h-10 w-10 items-center justify-center rounded-2xl bg-primary text-sm font-black text-white transition-colors hover:bg-primary-700',
                colapsado && 'lg:flex'
              )}
            >
              <span aria-hidden>{(profile?.nombre || profile?.email || 'U').slice(0, 1).toUpperCase()}</span>
            </button>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={cuentaAbierta}
              aria-label="Mi cuenta"
              title="Mi cuenta"
              onClick={() => setCuentaAbierta((v) => !v)}
              className={cn(
                'flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900',
                colapsado && 'lg:hidden'
              )}
            >
              <span className="truncate">{profile?.nombre || profile?.email}</span>
            </button>
          </div>
        </div>
      </aside>

      {abierto ? <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" /> : null}

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

      {/* Sin transición de padding: reacomodar el alto entero de la ventana por
          cuadro era lo que hacía pesada la apertura de la barra. En el teléfono
          no hay margen: el cajón se superpone. */}
      <div className={cn(colapsado ? 'lg:pl-20' : 'lg:pl-72')}>
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
          {/* Acciones de la vista, a la derecha del título: «Filtros» (sólo en
              el dashboard) y el hueco al que cada página se cuelga sus botones
              por portal —el Historial el de aperturar, Unidades el selector de
              pestañas y «+ Nueva». El hueco está siempre, aunque hoy sólo
              esas dos vistas lo usen. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {esDashboard ? (
              <button
                type="button"
                onClick={alternarFiltros}
                aria-expanded={filtrosAbiertos}
                aria-controls="dashboard-filters-panel"
                className={cn('inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors', filtrosAbiertos ? 'border-primary bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary')}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filtros
              </button>
            ) : null}
            <div id="acciones-vista" className="flex items-center gap-2" />
          </div>
        </header>
        {esDashboard ? (
          <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', filtrosAbiertos ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
            {/* El panel de filtros es de las vistas del dashboard: mismo gris
                que su `<main>` (ver CLASE_CONTENEDOR_DASHBOARD en diseno.ts). */}
            <div className="min-h-0 overflow-hidden border-b border-slate-200 bg-slate-100">
              <div id="dashboard-filters-panel" />
            </div>
          </div>
        ) : null}
        </div>
        {pathname === '/dashboard' ||
        pathname === '/dashboard/responsables' ||
        pathname.startsWith('/dashboard/modulo/') ? (
          <BarraKpis ancho={anchoTotal} />
        ) : null}
        <SyncBanner />
        <main className={cn('px-4 py-6 lg:px-8', !anchoTotal && 'mx-auto max-w-7xl')}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}