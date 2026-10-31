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

/**
 * Un degradado por tarjeta, en rotación y con los colores de la casa: marino,
 * azul, verde, ámbar y rojo. El orden no es decorativo —el verde sigue al
 * azul y el rojo cierra—: es la escala de estado que la app ya usa, para que
 * la fila de tarjetas se lea como la de cualquier otro panel.
 */
const PALETA: { desde: string; hasta: string }[] = [
  { desde: 'from-primary-900', hasta: 'to-primary-700' },
  { desde: 'from-primary-600', hasta: 'to-primary-400' },
  { desde: 'from-green-600', hasta: 'to-green-400' },
  { desde: 'from-amber-500', hasta: 'to-amber-300' },
  { desde: 'from-red-600', hasta: 'to-red-400' }
]

interface DatoKpi {
  etiqueta: string
  icono: LucideIcon
  valor: number | null
  sufijo?: string
  decimales?: number
  /** Posición en la fila: de ahí sale el color de la tarjeta. */
  posicion: number
}

/** Tarjeta de KPI: número grande arriba a la izquierda, icono en su círculo a la derecha. */
function TarjetaKpi({ etiqueta, icono, valor, sufijo, decimales = 0, posicion }: DatoKpi) {
  const animado = useNumeroAnimado(valor, 700)
  const Icono = icono
  const color = PALETA[posicion % PALETA.length]
  return (
    <div
      className={cn(
        'barra-kpis-item relative overflow-hidden rounded-2xl p-4 text-white shadow-md',
        'bg-gradient-to-br',
        color.desde,
        color.hasta
      )}
    >
      <p className="truncate pr-14 text-[10px] font-bold uppercase tracking-wider text-white/85">{etiqueta}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">
        {valor == null ? '—' : textoNumero(animado, decimales, sufijo ?? '')}
      </p>
      <span className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/20">
        <Icono className="h-6 w-6" />
      </span>
    </div>
  )
}

/**
 * La franja de KPIs de la pantalla, ahora como fila de tarjetas de color.
 *
 * `ancho` la estira al ancho total de la ventana: la siguen llamando sólo las
 * vistas del dashboard, y con el `<main>` también ancho las tarjetas quedan
 * alineadas con las de abajo en vez de centradas en 1280px.
 */
export function BarraKpis({ ancho }: { ancho?: boolean }) {
  const k = useKpisGlobal()

  // La animación vive dentro de cada tarjeta; acá sólo se decide de dónde sale
  // cada número y con cuántos decimales se imprime.
  const porDefecto: Omit<DatoKpi, 'posicion'>[] = [
    { etiqueta: 'Cumplimiento global', icono: Target, valor: k?.global ?? null, sufijo: '%', decimales: 2 },
    { etiqueta: 'Evaluaciones completadas', icono: CheckCircle2, valor: k?.completadas ?? null },
    { etiqueta: 'Cobertura de sucursales', icono: Store, valor: k?.cobertura ?? null, sufijo: '%' },
    { etiqueta: 'Ítems incumplidos', icono: AlertTriangle, valor: k?.incumplimientos ?? null }
  ]

  const items: DatoKpi[] = (
    k?.items?.length
      ? k.items.map((it) => {
          const num = typeof it.valor === 'number' ? it.valor : it.valor == null ? null : Number(it.valor) || null
          return {
            etiqueta: it.etiqueta,
            icono: ICONOS[it.icono] ?? Target,
            valor: num,
            sufijo: it.sufijo
          }
        })
      : porDefecto
  ).map((it, i) => ({ ...it, posicion: i }))

  return (
    <div className="barra-kpis">
      <div className={cn('mx-auto grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4 lg:px-8', !ancho && 'max-w-7xl')}>
        {items.map((it) => (
          <TarjetaKpi key={it.etiqueta} {...it} />
        ))}
      </div>
    </div>
  )
}
