import { Target, CheckCircle2, Store, AlertTriangle } from 'lucide-react'
import { useKpisGlobal } from '../../lib/kpisGlobal'
import { useNumeroAnimado } from './useAnimacion'

/** Formatea un número animado (puede ir contando de 0 al valor final). */
function textoNumero(v: number | null, decimales = 0, sufijo = ''): string {
  if (v == null) return '—'
  const n = decimales ? Math.round(v * 100) / 100 : Math.round(v)
  return `${n}${sufijo}`
}

export function BarraKpis() {
  const k = useKpisGlobal()
  const global = useNumeroAnimado(k?.global ?? null, 700)
  const completadas = useNumeroAnimado(k?.completadas ?? null, 700)
  const cobertura = useNumeroAnimado(k?.cobertura ?? null, 700)
  const incumplimientos = useNumeroAnimado(k?.incumplimientos ?? null, 700)

  const items = [
    { icono: <Target className="h-8 w-8" />, etiqueta: 'Cumplimiento global', valor: textoNumero(global, 2, '%') },
    { icono: <CheckCircle2 className="h-8 w-8" />, etiqueta: 'Evaluaciones completadas', valor: textoNumero(completadas) },
    { icono: <Store className="h-8 w-8" />, etiqueta: 'Cobertura de sucursales', valor: textoNumero(cobertura, 0, '%') },
    { icono: <AlertTriangle className="h-8 w-8" />, etiqueta: 'Ítems incumplidos', valor: textoNumero(incumplimientos) }
  ]

  return (
    <div className="barra-kpis bg-primary shadow-md">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-4 lg:px-8">
        {items.map((it) => (
          <div key={it.etiqueta} className="barra-kpis-item flex items-center justify-center gap-3">
            <span className="shrink-0 text-white">{it.icono}</span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-wider text-primary-100/90">{it.etiqueta}</p>
              <p className="text-xl font-black tabular-nums text-white sm:text-2xl">{it.valor}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}