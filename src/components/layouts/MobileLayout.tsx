import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { CheckCheck, History, LogOut, Menu, Settings, Check, LayoutDashboard, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOffline } from '../../context/OfflineContext'
import { cn, Spinner } from '../ui'

export function SyncBanner() {
  const { online, pendientes, sincronizando, ultimoResultado, sync } = useOffline()
  const [msg, setMsg] = useState('')

  if (online && pendientes === 0 && !ultimoResultado) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2 text-xs font-medium',
        online ? 'bg-slate-800 text-white' : 'bg-amber-500 text-white'
      )}
    >
      {!online ? (
        <span>Sin conexión. Los cambios se guardarán en el dispositivo.</span>
      ) : pendientes > 0 ? (
        <>
          {sincronizando ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : null}
          {pendientes} evaluación(es) pendiente(s) de sincronizar
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <CheckCheck className="h-4 w-4" />
          {ultimoResultado?.fail ? 'Hubo errores al sincronizar.' : 'Todo sincronizado'}
        </span>
      )}
      {online && pendientes > 0 ? (
        <button
          onClick={() => {
            void (async () => {
              const r = await sync()
              setMsg(r.fail ? `Sincronizado. ${r.fail} con error.` : 'Sincronizado correctamente.')
            })()
          }}
          disabled={sincronizando}
          className="ml-auto rounded-full bg-white/20 px-2 py-1 font-bold hover:bg-white/30 disabled:opacity-50"
        >
          {msg || 'Sincronizar'}
        </button>
      ) : null}
    </div>
  )
}

export function HeaderMini({
  titulo,
  subtitulo,
  onClickMenu,
  extra
}: {
  titulo: string
  subtitulo?: string
  onClickMenu?: () => void
  extra?: React.ReactNode
}) {
  const { profile } = useAuth()
  return (
    <header className="sticky top-0 z-30 bg-primary text-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {onClickMenu ? (
            <button
              onClick={onClickMenu}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold">{titulo}</h1>
            {subtitulo ? <p className="truncate text-xs text-primary-200">{subtitulo}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {extra}
          <span className="hidden max-w-[140px] truncate text-xs text-primary-200 sm:block">{profile?.nombre}</span>
          <NavLink
            to="/dashboard"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"
            title="Ir al dashboard"
          >
            <LayoutDashboard className="h-4 w-4" />
          </NavLink>
        </div>
      </div>
    </header>
  )
}

export function MobileLayout({
  children,
  titulo,
  subtitulo,
  extra
}: {
  children: React.ReactNode
  titulo?: string
  subtitulo?: string
  extra?: React.ReactNode
}) {
  const { profile, signOut } = useAuth()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const cerrar = () => setMenuAbierto(false)
  return (
    <div className="min-h-screen bg-slate-50 pb-6">
      <HeaderMini titulo={titulo ?? 'EvaLuxor'} subtitulo={subtitulo} onClickMenu={() => setMenuAbierto(true)} extra={extra} />
      <SyncBanner />
      <main className="mx-auto w-full max-w-md px-4 py-4">{children}</main>

      {menuAbierto ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={cerrar} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-lg font-extrabold text-primary">EvaLuxor</span>
              <button
                onClick={cerrar}
                className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              <ItemLateral to="/evaluar" label="Evaluar" icon={<Check className="h-5 w-5" />} onClick={cerrar} />
              <ItemLateral to="/evaluar/historial" label="Historial" icon={<History className="h-5 w-5" />} onClick={cerrar} />
              <ItemLateral to="/perfil" label="Perfil" icon={<Settings className="h-5 w-5" />} onClick={cerrar} />
            </nav>
            <div className="border-t border-slate-100 p-3">
              <p className="px-3 pb-2 text-sm font-semibold text-slate-800">{profile?.nombre || 'Usuario'}</p>
              <button
                onClick={() => void signOut()}
                className="flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-5 w-5" />
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function ItemLateral({
  to,
  label,
  icon,
  onClick
}: {
  to: string
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium',
          isActive ? 'bg-primary-50 text-primary' : 'text-slate-700 hover:bg-slate-50'
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}