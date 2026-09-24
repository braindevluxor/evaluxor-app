import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { FolderOpen, X } from 'lucide-react'

export function cn(...cls: (string | false | null | undefined)[]): string {
  return cls.filter(Boolean).join(' ')
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
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]',
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
}

export function Field({ label, children, className, hint }: FieldProps) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[44px]"
      {...props}
    />
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      {...props}
    />
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[44px]"
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

const colores = ['bg-slate-100 text-slate-700', 'bg-primary-50 text-primary-700', 'bg-green-100 text-green-800', 'bg-amber-100 text-amber-800', 'bg-red-100 text-red-700', 'bg-indigo-100 text-indigo-700'] as const

export function Badge({ children, color = 0, className }: { children: ReactNode; color?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', colores[color % colores.length], className)}>
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span className={cn('inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary', className)} />
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
  sinCerrarFuera
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
  sinCerrarFuera?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
      onClick={sinCerrarFuera ? undefined : onClose}
    >
      <div
        ref={scrollRef}
        className={cn('max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl bg-white p-5 [overflow-anchor:none]', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
        onClick={(e) => e.stopPropagation()}
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
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-primary-900">{title}</h3>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Confirmar({
  open,
  texto,
  onConfirm,
  onCancel
}: {
  open: boolean
  texto: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5">
        <p className="text-sm text-slate-700">{texto}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant="danger" onClick={onConfirm}>Sí, confirmar</Button>
        </div>
      </div>
    </div>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-200', className)}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Puntaje({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className={cn('text-sm text-slate-400', className)}>—</span>
  const color = value >= 80 ? 'text-green-700' : value >= 60 ? 'text-amber-700' : 'text-red-700'
  return <span className={cn('font-bold tabular-nums', color, className)}>{value.toLocaleString('es')}%</span>
}