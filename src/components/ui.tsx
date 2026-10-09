import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, HelpCircle, X } from 'lucide-react'

export function cn(...cls: (string | false | null | undefined)[]): string {
  return cls.filter(Boolean).join(' ')
}

/** Cierra un modal/overlay con la tecla Escape mientras está abierto. */
function useCerrarConEscape(abierto: boolean, onCerrar: () => void): void {
  useEffect(() => {
    if (!abierto) return
    const manejar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCerrar()
      }
    }
    window.addEventListener('keydown', manejar)
    return () => window.removeEventListener('keydown', manejar)
  }, [abierto, onCerrar])
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const variantes: Record<BtnVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-700 active:bg-primary-800',
  secondary: 'bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100',
  ghost: 'text-primary-700 hover:bg-primary-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-green-600 text-white hover:bg-green-700'
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]',
        variantes[variant],
        className
      )}
      {...props}
    />
  )
}

interface FieldProps {
  label: string
  children: ReactNode
  className?: string
  hint?: string
  /** Clases extra para el texto de la etiqueta (p. ej. reiniciar color en fondos oscuros). */
  labelClassName?: string
  /** Clases extra para el texto de la ayuda. */
  hintClassName?: string
}

export function Field({ label, children, className, hint, labelClassName, hintClassName }: FieldProps) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className={cn('text-sm font-medium text-slate-700', labelClassName)}>{label}</span>
      {children}
      {hint ? <span className={cn('text-xs text-slate-400', hintClassName)}>{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  // Si el consumidor pasa una clase de ancho (p. ej. w-20), no aplicar el w-full base para no pisarlo.
  const conAncho = /(?:^|\s)w-/.test(className ?? '')
  return (
    <input
      className={cn(
        'rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[38px]',
        !conAncho && 'w-full',
        className
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const conAncho = /(?:^|\s)w-/.test(className ?? '')
  return (
    <textarea
      className={cn(
        'rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
        !conAncho && 'w-full',
        className
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const conAncho = /(?:^|\s)w-/.test(className ?? '')
  return (
    <select
      className={cn(
        'rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[38px]',
        !conAncho && 'w-full',
        className
      )}
      {...props}
    />
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white p-4', className)}>
      {children}
    </div>
  )
}

/**
 * La paleta de las etiquetas: fondo + texto de la misma familia.
 *
 * Se exporta porque hay pantallas que necesitan el MISMO fondo que su etiqueta —
 * el puntaje total de la evaluación es una etiqueta gigante— y elegir el color a
 * mano en el segundo uso haría que el número y la etiqueta que lo califica
 * dejaran de coincidir el día que se cambie un tono acá.
 *
 * `cn` solo concatena clases, no resuelve conflictos: pasar un `bg-red-600` por
 * `className` sobre un `bg-red-100` de la paleta deja las dos en el HTML y gana
 * la que aparezca después en la hoja de estilos. Por eso el color se elige con el
 * índice y no pisando el fondo.
 */
const COLORES_BADGE = ['bg-slate-100 text-slate-700', 'bg-primary-50 text-primary-700', 'bg-green-100 text-green-800', 'bg-amber-100 text-amber-800', 'bg-red-100 text-red-700', 'bg-indigo-100 text-indigo-700'] as const

/**
 * El fondo de una etiqueta pintado como texto, un paso más oscuro. Lo usa el
 * puntaje total de la evaluación: el rojo del "No cumple" de al lado, el amarillo
 * del "En riesgo", el verde del "Cumple".
 *
 * POR QUÉ UN PASO MÁS OSCURO Y NO EL FONDO TAL CUAL
 * -------------------------------------------------
 * `bg-red-100` como texto es un rosado que sobre la tarjeta blanca no se lee: se
 * veía el 62% como una mancha y no como un número. Sumarle un paso a la escala
 * (`red-100` → `red-200`) devuelve un color de la misma familia y del mismo tono
 * claro, pero con cuerpo suficiente para leerse sin cambiar de matiz. Por eso la
 * suma es aritmética y no una lista escrita a mano: si mañana el fondo del tag
 * pasa a `-200`, el número pasa a `-300` solo.
 *
 * Por qué no escribir el color en cada uso: los dos tonos de una etiqueta viven en
 * la misma clase (`bg-red-100 text-red-700`) y `cn` solo concatena, no resuelve
 * conflictos, así que un `text-red-600` pasado por `className` convive con el
 * `text-red-700` de la paleta y gana el que aparezca después en la hoja de estilos.
 */
export function colorFondoBadge(color: number): string {
  const clases = COLORES_BADGE[color % COLORES_BADGE.length].split(' ')
  const fondo = clases.find((c) => c.startsWith('bg-')) ?? ''
  return fondo
    .replace(/^bg-/, 'text-')
    .replace(/-(\d+)$/, (_, paso: string) => `-${Number(paso) + 100}`)
}

export function Badge({ children, color = 0, className }: { children: ReactNode; color?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', COLORES_BADGE[color % COLORES_BADGE.length], className)}>
      {children}
    </span>
  )
}

export function Spinner({ className, size = 20, light = false }: { className?: string; size?: number; light?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cn('inline-block shrink-0', className)}
      style={{ '--u': `${Math.round((size / 7) * 100) / 100}px` } as CSSProperties}
    >
      <span className={cn('cargador', light && 'cargador--claro')}>
        <span className="cargador-box cargador-box--1" />
        <span className="cargador-box cargador-box--2" />
        <span className="cargador-box cargador-box--3" />
      </span>
    </span>
  )
}

/* --- Skeleton (esqueletos de carga por página) ----------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-200', className)} aria-hidden="true" />
}

/** Filas tipo lista/tabla (con tarjeta opcional). */
export function SkeletonFilas({ n = 5, card = false }: { n?: number; card?: boolean }) {
  return (
    <div className={cn('space-y-4', card && 'rounded-2xl border border-slate-200 bg-white p-4')}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="ml-auto h-4 w-1/5" />
        </div>
      ))}
    </div>
  )
}

/** Tarjetas en grid (título + línea + acciones). */
export function SkeletonTarjetas({ n = 3, cols = 'md:grid-cols-2 lg:grid-cols-3' }: { n?: number; cols?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-3', cols)}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-12 shrink-0 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-9 flex-1 rounded-full" />
            <Skeleton className="h-9 flex-1 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Esqueleto genérico de pantalla (guardas de ruta, rutas lazy). */
export function SkeletonPantalla({ completa = false }: { completa?: boolean }) {
  return (
    <div className={cn('grid place-items-center px-4 py-6', completa ? 'min-h-screen' : 'min-h-[60vh]')}>
      <div className="w-full max-w-3xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
        <SkeletonFilas n={4} card />
        <SkeletonTarjetas n={2} cols="sm:grid-cols-2" />
      </div>
    </div>
  )
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <FolderOpen className="h-10 w-10 text-slate-300" strokeWidth={1.5} />
      <p className="font-semibold text-slate-700">{title}</p>
      {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
  backdropClassName
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
  footer?: ReactNode
  backdropClassName?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useCerrarConEscape(open, onClose)
  if (!open) return null
  const contenido = (
    <div className={cn('fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4', backdropClassName)}>
      <div
        className={cn('flex max-h-[92vh] w-full flex-col rounded-t-2xl sm:rounded-2xl bg-white', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
      >
        {/* Cabecera fija: título y botón de cerrar siempre visibles. */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-5 pb-3">
          {/* `break-words`: los títulos vienen de datos (un nombre de cargo, una
            incidencia) y sin esto uno largo empuja el botón de cerrar fuera de la
            cabecera en vez de partirse en dos líneas. */}
          <h3 className="min-w-0 text-lg font-bold break-words text-primary-900">{title}</h3>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 [overflow-anchor:none]"
          onBlur={(e) => {
            // Al perder foco un campo interno (clic fuera de él), el navegador puede
            // reiniciar el scroll del modal al tope (reflow / cierre del teclado).
            // Conservamos la posición mientras el foco no quede en otro elemento del modal.
            const destino = e.relatedTarget as Node | null
            if (destino && scrollRef.current?.contains(destino)) return
            const top = scrollRef.current?.scrollTop ?? 0
            const restaurar = () => {
              if (scrollRef.current && (!document.activeElement || !scrollRef.current.contains(document.activeElement))) {
                scrollRef.current.scrollTop = top
              }
            }
            requestAnimationFrame(restaurar)
            window.setTimeout(restaurar, 300)
          }}
        >
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-slate-100 px-5 py-3.5">{footer}</div>
        ) : null}
      </div>
    </div>
  )
  return typeof document === 'undefined' ? contenido : createPortal(contenido, document.body)
}

export function Confirmar({
  open,
  texto,
  onConfirm,
  onCancel,
  textoConfirmar = 'Sí, confirmar',
  variant = 'danger'
}: {
  open: boolean
  texto: string
  onConfirm: () => void
  onCancel: () => void
  /** Etiqueta y color del botón: rojo por defecto (borrar); otro para acciones que no destruyen. */
  textoConfirmar?: string
  variant?: BtnVariant
}) {
  useCerrarConEscape(open, onCancel)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5">
        <p className="text-sm text-slate-700">{texto}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant={variant} onClick={onConfirm}>{textoConfirmar}</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Barra de progreso.
 *
 * La diferencia entre los dos modos es si el número existe o no, y eso también
 * cambia lo que se anuncia:
 *
 * - `value`: el porcentaje es real (subida de un archivo). Se pinta y se
 *   anuncia con `aria-valuenow`.
 * - `valorAprox`: el porcentaje es de adorno —el avance automático de una
 *   consulta que no sabe cuánto va a tardar—. Se ve, pero sin `aria-valuenow`,
 *   porque un lector de pantalla repetiría un número inventado en cada cambio
 *   y eso es peor que no anunciar nada.
 */
export function ProgressBar({
  value,
  valorAprox,
  className,
  fillClassName
}: {
  value?: number
  valorAprox?: number
  className?: string
  /** Color del relleno. Por defecto el primario de la app; las barras que
   *  dependen del valor (una Calificación, un %) lo pasan para que el color
   *  venga de la misma regla que el número que acompaña. */
  fillClassName?: string
}) {
  const ancho = Math.max(0, Math.min(100, value ?? valorAprox ?? 0))
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-200', className)}
      role="progressbar"
      aria-label="Cargando"
      aria-valuemin={value == null ? undefined : 0}
      aria-valuemax={value == null ? undefined : 100}
      aria-valuenow={value == null ? undefined : Math.max(0, Math.min(100, value))}
    >
      <div
        // 200ms y no 300: el reloj del avance pica cada 110ms, y con una
        // transición más larga que el intervalo el relleno siempre va atrasado
        // respecto al número. `motion-reduce` lo pasa a saltos, que para una
        // barra de adorno se lee mejor que un llenado continuo.
        className={cn('h-full rounded-full bg-primary transition-all duration-200 motion-reduce:transition-none', fillClassName)}
        style={{ width: `${ancho}%` }}
      />
    </div>
  )
}

export function Puntaje({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className={cn('text-sm text-slate-400', className)}>—</span>
  const color = value >= 80 ? 'text-green-700' : value >= 60 ? 'text-amber-700' : 'text-red-700'
  return <span className={cn('font-bold tabular-nums', color, className)}>{value.toLocaleString('es')}%</span>
}

const MARGEN_TOOLTIP = 12

/**
 * Signo de interrogación que explica el bloque que tiene al lado.
 *
 * POR QUÉ UN PORTAL Y NO `absolute`
 * --------------------------------
 * Nace para el detalle de evaluación, y ahí el panel NO puede ser un hijo con
 * `position: absolute`: la columna izquierda lleva `overflow-hidden` (su alto es
 * fijo justamente para no tener scroll propio) y cualquier tooltip dentro se
 * cortaría contra el borde de la columna, a media frase. Se mide el botón, se
 * calcula dónde hay sitio y se pinta en `document.body` con `position: fixed`,
 * como hace el `Modal`.
 *
 * SE ABRE CON CLIC, NO SOLO AL PASAR EL CURSOR
 * --------------------------------------------
 * Porque en el teléfono no hay cursor. Un tooltip que solo abre con `hover` es
 * inalcanzable en la mitad de los dispositivos donde corre la app, y estos textos
 * son los que explican cómo se calcula el puntaje.
 *
 * La posición se mide con `useLayoutEffect` a propósito: si se midiera después del
 * paint, el panel aparecería un instante en la esquina (0, 0) antes de saltar a su
 * sitio. Antes del paint no se ve ese salto.
 */
export function InfoTooltip({ texto, className }: { texto: string; className?: string }) {
  const [abierto, setAbierto] = useState(false)
  const [caja, setCaja] = useState<{ top: number; left: number } | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const cerrar = useCallback(() => setAbierto(false), [])

  useCerrarConEscape(abierto, cerrar)

  // Medir y colocar. Sin esto el panel quedaría en el `top`/`left` que se le pase,
  // que no es donde está el botón.
  useLayoutEffect(() => {
    if (!abierto) {
      setCaja(null)
      return
    }
    const boton = botonRef.current?.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    if (!boton || !panel) return

    // Horizontal: alineado al botón, y empujado dentro de la ventana si no cabe.
    // La columna mide 17rem y el panel 20: alineado a la derecha del botón se
    // salía por el borde, y sin este ajuste el texto quedaba cortado.
    let left = boton.left
    if (left + panel.width > window.innerWidth - MARGEN_TOOLTIP) {
      left = window.innerWidth - MARGEN_TOOLTIP - panel.width
    }
    if (left < MARGEN_TOOLTIP) left = MARGEN_TOOLTIP

    // Vertical: debajo del botón, o arriba si no cabe. Con poco espacio abajo se
    // sube; si tampoco cabe arriba (pantalla muy baja) se pega al borde inferior
    // y el propio panel scrollea por su `max-h`.
    let top = boton.bottom + 8
    if (top + panel.height > window.innerHeight - MARGEN_TOOLTIP) {
      const arriba = boton.top - 8 - panel.height
      top = arriba >= MARGEN_TOOLTIP ? arriba : window.innerHeight - MARGEN_TOOLTIP - panel.height
    }
    setCaja({ top, left })
  }, [abierto, texto])

  // Click afuera y scroll: el panel está posicionado en píxeles contra la ventana,
  // así que si la página se mueve queda flotando en el aire. Se cierra antes de
  // que se note.
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => {
      if (botonRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setAbierto(false)
    }
    const mover = () => setAbierto(false)
    document.addEventListener('pointerdown', fuera)
    window.addEventListener('resize', mover)
    // `capture`: el scroll de cualquier contenedor interno también lo dispara, y sin
    // esto el tooltip se quedaría pegado a un botón que ya se movió.
    window.addEventListener('scroll', mover, true)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      window.removeEventListener('resize', mover)
      window.removeEventListener('scroll', mover, true)
    }
  }, [abierto])

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-label="Más información"
        className={cn(
          'inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600',
          abierto && 'bg-slate-100 text-slate-600',
          className
        )}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {abierto
        ? createPortal(
            <div
              ref={panelRef}
              role="tooltip"
              style={{
                top: caja?.top ?? 0,
                left: caja?.left ?? 0,
                // Invisible hasta que se midió: evita el parpadeo en el 0,0.
                visibility: caja ? 'visible' : 'hidden'
              }}
              className="fixed z-[110] max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs leading-snug text-slate-600 shadow-lg"
            >
              {texto}
            </div>,
            document.body
          )
        : null}
    </>
  )
}