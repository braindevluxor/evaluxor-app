import { AlertTriangle, BadgeCheck, CalendarDays, CheckCircle2, ListChecks, Store, Target, type LucideIcon } from 'lucide-react'
import { useKpisGlobal, type IconoKpi } from '../../lib/kpisGlobal'
import { cn } from '../ui'
import { useNumeroAnimado } from './useAnimacion'

/** Formatea un número animado (puede ir contando de 0 al valor final). */
function textoNumero(v: number | null, decimales = 0, sufijo = ''): string {
  if (v == null) return '—'
  const n = decimales ? Math.round(v * 100) / 100 : Math.round(v)
  return `${n}${sufijo}`
}

const ICONOS: Record<IconoKpi, LucideIcon> = {
  calendario: CalendarDays,
  check: CheckCircle2,
  store: Store,
  target: Target,
  alerta: AlertTriangle,
  lista: ListChecks,
  badge: BadgeCheck
}

/** Ítem de la franja azul con número animado (para los KPIs de módulo). */
function ItemKpi({
  etiqueta,
  icono,
  valor,
  sufijo
}: {
  etiqueta: string
  icono: LucideIcon
  valor: number | null
  sufijo?: string
}) {
  const animado = useNumeroAnimado(valor, 700)
  const Icono = icono
  return (
    <div className="barra-kpis-item flex items-center justify-center gap-3">
      <span className="shrink-0 text-white"><Icono className="h-8 w-8" /></span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-primary-100/90">{etiqueta}</p>
        <p className="text-xl font-black tabular-nums text-white sm:text-2xl">
          {valor == null ? '—' : textoNumero(animado, 0, sufijo ?? '')}
        </p>
      </div>
    </div>
  )
}

/**
 * Franja azul con los KPIs de la pantalla.
 *
 * `ancho` la estira al ancho total de la ventana: la siguen llamando sólo las
 * vistas del dashboard, y con el `<main>` también ancho los números quedan
 * alineados con las tarjetas de abajo en vez de centrados en 1280px.
 */
export function BarraKpis({ ancho }: { ancho?: boolean }) {
  const k = useKpisGlobal()
  const global = useNumeroAnimado(k?.global ?? null, 700)
  const completadas = useNumeroAnimado(k?.completadas ?? null, 700)
  const cobertura = useNumeroAnimado(k?.cobertura ?? null, 700)
  const incumplimientos = useNumeroAnimado(k?.incumplimientos ?? null, 700)

  const porDefecto = [
    { etiqueta: 'Cumplimiento global', valor: textoNumero(global, 2, '%'), icono: <Target className="h-8 w-8" /> },
    { etiqueta: 'Evaluaciones completadas', valor: textoNumero(completadas), icono: <CheckCircle2 className="h-8 w-8" /> },
    { etiqueta: 'Cobertura de sucursales', valor: textoNumero(cobertura, 0, '%'), icono: <Store className="h-8 w-8" /> },
    { etiqueta: 'Ítems incumplidos', valor: textoNumero(incumplimientos), icono: <AlertTriangle className="h-8 w-8" /> }
  ]

  const items = k?.items?.length
    ? k.items.map((it) => {
        const num = typeof it.valor === 'number' ? it.valor : it.valor == null ? null : Number(it.valor) || null
        return (
          <ItemKpi
            key={it.etiqueta}
            etiqueta={it.etiqueta}
            icono={ICONOS[it.icono] ?? Target}
            valor={num}
            sufijo={it.sufijo}
          />
        )
      })
    : porDefecto.map((it) => (
        <div key={it.etiqueta} className="barra-kpis-item flex items-center justify-center gap-3">
          <span className="shrink-0 text-white">{it.icono}</span>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-bold uppercase tracking-wider text-primary-100/90">{it.etiqueta}</p>
            <p className="text-xl font-black tabular-nums text-white sm:text-2xl">{it.valor}</p>
          </div>
        </div>
      ))

  return (
    <div className="barra-kpis bg-primary shadow-md">
      <div className={cn('mx-auto grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-4 lg:px-8', !ancho && 'max-w-7xl')}>
        {items}
      </div>
    </div>
  )
}