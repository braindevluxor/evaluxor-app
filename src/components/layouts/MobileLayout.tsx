import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useOffline } from '../../context/OfflineContext'
import { cn, Spinner } from '../ui'
import { useState } from 'react'

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
        <span>{ultimoResultado?.fail ? 'Hubo errores al sincronizar.' : 'Todo sincronizado ✅'}</span>
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
          className="ml-auto rounded-md bg-white/20 px-2 py-1 font-bold hover:bg-white/30 disabled:opacity-50"
        >
          {msg || 'Sincronizar'}
        </button>
      ) : null}
    </div>
  )
}

export function HeaderMini({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  const { profile, signOut } = useAuth()
  return (
    <header className="sticky top-0 z-30 bg-primary text-white shadow-md">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-extrabold">{titulo}</h1>
          {subtitulo ? <p className="truncate text-xs text-primary-200">{subtitulo}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden max-w-[140px] truncate text-xs text-primary-200 sm:block">{profile?.nombre}</span>
          <button
            onClick={() => void signOut()}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm hover:bg-white/20"
            title="Cerrar sesión"
          >
            ⎋
          </button>
        </div>
      </div>
    </header>
  )
}

export function MobileLayout({
  children,
  titulo,
  subtitulo
}: {
  children: React.ReactNode
  titulo?: string
  subtitulo?: string
}) {
  const { profile, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <HeaderMini titulo={titulo ?? 'EvaLuxor'} subtitulo={subtitulo} />
      <SyncBanner />
      <main className="mx-auto w-full max-w-md px-4 py-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white shadow-lg">
        <div className="mx-auto flex max-w-md items-stretch">
          <NavItem to="/evaluar" label="Evaluar" icon="✓" />
          <NavItem to="/evaluar/historial" label="Historial" icon="≡" />
          <button
            onClick={() => void signOut()}
            className="flex w-full flex-col items-center justify-center gap-0.5 py-2.5 text-slate-500"
          >
            <span className="text-lg leading-none">⎋</span>
            <span className="text-[11px] font-medium">{profile?.nombre?.split(' ')[0] || 'Salir'}</span>
          </button>
        </div>
      </nav>
    </div>
  )
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex w-full flex-col items-center justify-center gap-0.5 py-2.5',
          isActive ? 'text-primary' : 'text-slate-500'
        )
      }
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-[11px] font-medium">{label}</span>
    </NavLink>
  )
}