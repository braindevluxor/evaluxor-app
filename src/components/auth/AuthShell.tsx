import type { ReactNode } from 'react'
import { ShoppingCart } from 'lucide-react'

/**
 * Fondo decorativo y marco de las pantallas de acceso (login / registro).
 * Diseño "sin contenedores": el formulario flota directo sobre un gradiente
 * con orbes difuminados y una trama de puntos; no hay tarjeta.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-primary-900 px-4 py-10">
      {/* Gradiente de base */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-900 via-primary-800 to-primary-600" />
      {/* Orbes difuminados */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary-300/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-44 -right-24 h-[30rem] w-[30rem] rounded-full bg-primary-500/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute left-1/3 top-0 h-64 w-64 rounded-full bg-primary-400/15 blur-3xl" />
      {/* Trama de puntos desvanecida desde el centro */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(255 255 255 / 0.08) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'radial-gradient(ellipse at center, black 15%, transparent 72%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 15%, transparent 72%)'
        }}
      />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  )
}

/** Input tipo glass: caja translúcida con difuminado, redondeada y sin tarjeta. */
export const inputAuth =
  'rounded-xl border border-white/20! bg-white/10! px-3.5 py-2.5! text-white! placeholder:text-white/40! backdrop-blur transition-colors focus:border-white/60! focus:bg-white/15! focus:ring-white/25!'

/** Botón principal de acceso: píldora blanca sobre fondo oscuro. */
export const botonAuth = 'w-full bg-white! text-primary-900! hover:bg-white/90! shadow-lg shadow-primary-900/40'

export const labelAuth = 'text-white/70!'
export const hintAuth = 'text-white/45!'

/** Marca (logo sin contenedor + título + subtítulo) centrada. */
export function MarcaAuth({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="mb-10 text-center">
      <div className="relative mx-auto mb-5 h-16 w-16">
        <div aria-hidden className="absolute inset-0 -z-10 rounded-full bg-primary-300/30 blur-2xl" />
        <ShoppingCart className="h-16 w-16 text-white drop-shadow-lg" strokeWidth={1.3} />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight text-white">{titulo}</h1>
      <p className="mt-1.5 text-sm font-medium text-primary-200">{subtitulo}</p>
    </div>
  )
}