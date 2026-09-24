import { Target, CheckCircle2, Store, AlertTriangle } from 'lucide-react'
import { useKpisGlobal } from '../../lib/kpisGlobal'

export function BarraKpis() {
  const k = useKpisGlobal()
  const items = [
    { icono: <Target className="h-4 w-4" />, etiqueta: 'Cumplimiento global', valor: k?.global != null ? `${k.global}%` : '—' },
    { icono: <CheckCircle2 className="h-4 w-4" />, etiqueta: 'Evaluaciones completadas', valor: k?.completadas ?? '—' },
    { icono: <Store className="h-4 w-4" />, etiqueta: 'Cobertura de sucursales', valor: `${k?.cobertura ?? 0}%` },
    { icono: <AlertTriangle className="h-4 w-4" />, etiqueta: 'Ítems incumplidos', valor: k?.incumplimientos ?? '—' }
  ]
  return (
    <div className="bg-primary shadow-sm">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-4 lg:px-8">
        {items.map((it) => (
          <div key={it.etiqueta} className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white">{it.icono}</span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-wider text-primary-100/90">{it.etiqueta}</p>
              <p className="text-xl font-black text-white sm:text-2xl">{it.valor}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}