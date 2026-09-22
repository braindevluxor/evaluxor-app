import type { ReactNode } from 'react'
import { Puntaje, cn } from '../ui'

export function KpiCard({
  titulo,
  valor,
  sub,
  icono,
  color = 'bg-primary text-white',
  children
}: {
  titulo: string
  valor: ReactNode
  sub?: ReactNode
  icono?: ReactNode
  color?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-2xl border border-slate-200 p-4 shadow-sm', color)}>
      <div className="flex items-center gap-2 text-sm font-semibold opacity-90">
        {icono ? <span>{icono}</span> : null}
        {titulo}
      </div>
      <div className="text-3xl font-extrabold leading-none">{valor}</div>
      {sub ? <div className="text-xs opacity-80">{sub}</div> : null}
      {children}
    </div>
  )
}

export function PuntajeCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-300">—</span>
  return (
    <Puntaje value={value} className={cn(
      value >= 80 ? 'text-green-700' : value >= 60 ? 'text-amber-700' : 'text-red-700'
    )} />
  )
}