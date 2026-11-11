import type { ReactNode } from 'react'
import { cn } from '../ui'

/**
 * Fondo y marco de las pantallas de acceso (login / registro):
 * fondo blanco plano y el formulario flotando directo sobre él, sin contenedor.
 * El contenido va centrado: con el logo ya recortado el bloque es compacto y
 * alineado al fondo dejaba demasiado aire arriba.
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

/**
 * Marca completa (isotipo + nombre) en public/completo.webp.
 *
 * El archivo ya viene recortado a su contenido visible, así que acá no hay que
 * calcular nada: la imagen toma el ancho que le manden y baja sola. Antes se
 * mostraba sólo el wordmark sobre un lienzo 16:9 y hacía falta recortarlo en
 * pantalla con las medidas escritas a mano, que era frágil y dejaba un hueco
 * invisible entre el logo y el formulario.
 */
export function LogoAuth({ alt, className }: { alt: string; className?: string }) {
  return <img src="/completo.webp" alt={alt} className={cn('h-auto', className)} />
}

/**
 * Marca de las pantallas de acceso. Con `soloLogo` el logo ya identifica la app
 * (y ocupa todo el ancho del formulario), así que el texto visible se omite; el
 * título queda como nombre accesible del logo y como encabezado de la página.
 */
export function MarcaAuth({ titulo, subtitulo, soloLogo = false }: { titulo: string; subtitulo?: string; soloLogo?: boolean }) {
  return (
    <div className="mb-5 text-center">
      <LogoAuth alt={titulo} className={cn('w-full', soloLogo ? '' : 'mb-5')} />
      {soloLogo ? (
        <h1 className="sr-only">{titulo}</h1>
      ) : (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight text-primary-900">{titulo}</h1>
          {subtitulo ? <p className="mt-1 text-sm font-medium text-slate-500">{subtitulo}</p> : null}
        </>
      )}
    </div>
  )
}