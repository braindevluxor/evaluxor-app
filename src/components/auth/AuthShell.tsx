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
 * Límites del logo dentro de public/logo.webp, medidos sobre el canal alfa:
 * el archivo es un lienzo de 1920x1080 y el wordmark ocupa solo la franja
 * x 115–1833 / y 471–642 (1719x172), con ~471px vacíos arriba y ~437px abajo.
 */
const LOGO = { lienzo: 1920, x: 115, y: 471, ancho: 1719, alto: 172 } as const

/** Porcentaje del ancho del contenedor que vale un píxel del logo. */
const LOGO_ESCALA = 100 / LOGO.ancho

/**
 * Logo recortado a su contenido visible: sin las franjas transparentes el <img>
 * ocuparía una caja 16:9 con el wordmark flotando en el medio y el formulario
 * quedaría separado por un hueco invisible. El contenedor toma la proporción real
 * del logo y la imagen se corre con márgenes negativos hasta encuadrarla.
 */
export function LogoAuth({ alt, className }: { alt: string; className?: string }) {
  return (
    <div className={cn('overflow-hidden', className)} style={{ aspectRatio: `${LOGO.ancho} / ${LOGO.alto}` }}>
      <img
        src="/logo.webp"
        alt={alt}
        className="max-w-none"
        style={{
          width: `${(LOGO.lienzo * LOGO_ESCALA).toFixed(2)}%`,
          marginLeft: `${(-LOGO.x * LOGO_ESCALA).toFixed(2)}%`,
          marginTop: `${(-LOGO.y * LOGO_ESCALA).toFixed(2)}%`
        }}
      />
    </div>
  )
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