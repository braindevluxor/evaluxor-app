import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, RefreshCw } from 'lucide-react'

/**
 * El marco de las pantallas de INVITADO: sin sesión, sin sidebar y sin barra
 * inferior, con la marca arriba y el aviso de modo invitado.
 *
 * Vive en su propio archivo porque lo comparten la conciliación pública y el
 * enlace de fallas por cargo: son dos documentos distintos con la misma
 * puerta (un token, una función de lectura y nada más).
 */
export function Marco({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <img src="/completo.webp" alt="EvaLuxor" className="logo-invitado h-8 w-auto" />
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Modo invitado
          </span>
        </div>
      </header>
      {children}
    </div>
  )
}

/** El estado «esto no se puede abrir»: enlace apagado, incompleto o caído. */
export function VistaInvalida({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <Marco>
      <main className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
        <img src="/isotipo.webp" alt="" className="logo-invitado h-14 w-auto" />
        <h1 className="mt-6 text-xl font-extrabold text-slate-900">{titulo}</h1>
        {detalle ? <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">{detalle}</p> : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reintentar
          </button>
          <Link to="/" className="rounded-full bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-600">
            Ir a EvaLuxor
          </Link>
        </div>
      </main>
    </Marco>
  )
}
