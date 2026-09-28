import type { ReactNode } from 'react'
import { ShoppingCart } from 'lucide-react'

/**
 * Fondo y marco de las pantallas de acceso (login / registro):
 * fondo blanco plano y el formulario flotando directo sobre él, sin contenedor.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
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