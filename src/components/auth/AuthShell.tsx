import type { ReactNode } from 'react'
import { ShoppingCart } from 'lucide-react'

/**
 * Fondo y marco de las pantallas de acceso (login / registro), con el mismo
 * lenguaje visual del sistema: fondo slate claro, halos suaves del color
 * primario y tarjeta blanca redondeada como las de toda la app.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 px-4 py-10">
      {/* Halos suaves del color primario del sistema */}
      <div aria-hidden className="pointer-events-none absolute -left-28 -top-28 h-96 w-96 rounded-full bg-primary-100/70 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-36 -right-28 h-[28rem] w-[28rem] rounded-full bg-primary-200/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-primary-50 blur-3xl" />
      {/* Trama de puntos sutil, atenuada hacia los bordes */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(15 23 42 / 0.045) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'radial-gradient(ellipse at center, black 10%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 10%, transparent 75%)'
        }}
      />
      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
      </div>
    </div>
  )
}

/** Inputs: heredan el estilo base de `Input` del sistema (blanco, borde slate, foco primario). */
export const inputAuth = ''

/** Botón principal: misma píldora primaria que el resto de la app, a lo ancho. */
export const botonAuth = 'w-full'

/** Etiquetas y ayuda: usan los estilos por defecto del sistema (slate). */
export const labelAuth = ''
export const hintAuth = ''

/** Marca (logo + título + subtítulo) centrada, en el azul primario del sistema. */
export function MarcaAuth({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="mb-8 text-center">
      <div className="relative mx-auto mb-4 h-14 w-14">
        <div aria-hidden className="absolute inset-0 -z-10 rounded-2xl bg-primary-50 ring-1 ring-primary-100" />
        <ShoppingCart className="h-14 w-14 p-2 text-primary" strokeWidth={1.6} />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-primary-900">{titulo}</h1>
      <p className="mt-1 text-sm font-medium text-slate-500">{subtitulo}</p>
    </div>
  )
}