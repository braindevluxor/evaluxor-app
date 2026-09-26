import { useState } from 'react'
import {
  AlertTriangle,
  Award,
  BookOpen,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  LayoutGrid,
  Lightbulb,
  Presentation,
  ScanBarcode,
  Store,
  Target,
  TrendingUp,
  type LucideIcon
} from 'lucide-react'
import { ETAPAS, FASES, KPIS, type FaseId } from '../../lib/biblioteca/contenido'
import { cn } from '../../components/ui'

const ICONOS: Record<string, LucideIcon> = {
  'clipboard-check': ClipboardCheck,
  calculator: Calculator,
  presentation: Presentation,
  lightbulb: Lightbulb,
  'trending-up': TrendingUp,
  target: Target,
  'layout-grid': LayoutGrid,
  store: Store,
  'check-circle-2': CheckCircle2,
  'alert-triangle': AlertTriangle,
  award: Award,
  'scan-barcode': ScanBarcode
}

const COLOR_UMBRAL = {
  rojo: 'border-red-200 bg-red-50 text-red-700',
  ambar: 'border-amber-200 bg-amber-50 text-amber-700',
  verde: 'border-green-200 bg-green-50 text-green-700'
} as const

const ETIQUETA = 'text-[10px] font-bold uppercase tracking-wider text-slate-500'

export function BibliotecaPage() {
  const [kpiId, setKpiId] = useState(KPIS[0].id)
  const [fase, setFase] = useState<FaseId>('recoleccion')
  const kpi = KPIS.find((k) => k.id === kpiId) ?? KPIS[0]

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-white shadow-sm">
          <BookOpen className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className={ETIQUETA}>Documentación</p>
          <h1 className="text-xl font-extrabold leading-tight text-primary-900">Procesos de evaluación</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            De la recolección de la información a la presentación de resultados, interpretaciones y proyecciones.
          </p>
        </div>
      </div>

      {/* Guía general por etapas */}
      <section>
        <p className={cn(ETIQUETA, 'mb-2')}>Guía general del proceso</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {ETAPAS.map((e, i) => {
            const Icon = ICONOS[e.id] ?? BookOpen
            return (
              <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Etapa {i + 1}</span>
                </div>
                <h3 className="mt-2 text-sm font-bold leading-snug text-slate-800">{e.titulo}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{e.resumen}</p>
                <ul className="mt-3 space-y-1.5">
                  {e.puntos.map((p) => (
                    <li key={p} className="flex gap-1.5 text-xs leading-relaxed text-slate-600">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-300" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      {/* Selector de KPI */}
      <section>
        <p className={cn(ETIQUETA, 'mb-2')}>Documentación por KPI</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {KPIS.map((k) => {
            const Icon = ICONOS[k.icono] ?? Target
            const activo = k.id === kpiId
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => setKpiId(k.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors',
                  activo
                    ? 'border-primary bg-primary text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary'
                )}
              >
                <Icon className="h-4 w-4" />
                {k.nombre}
              </button>
            )
          })}
        </div>
      </section>

      {/* Detalle del KPI */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-50 text-primary">
            {(() => {
              const Icon = ICONOS[kpi.icono] ?? Target
              return <Icon className="h-5 w-5" />
            })()}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold leading-tight text-primary-900">{kpi.nombre}</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{kpi.descripcion}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {kpi.formula ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className={cn(ETIQUETA, 'mb-1')}>Cálculo</p>
              <p className="font-mono text-xs leading-relaxed text-slate-700">{kpi.formula}</p>
            </div>
          ) : null}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className={cn(ETIQUETA, 'mb-1.5')}>{kpi.umbrales ? 'Lectura / umbrales' : 'Unidad'}</p>
            {kpi.umbrales ? (
              <div className="flex flex-wrap gap-1.5">
                {kpi.umbrales.map((u) => (
                  <span
                    key={`${u.etiqueta}-${u.color}`}
                    title={u.significado}
                    className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold', COLOR_UMBRAL[u.color])}
                  >
                    <span className={cn('h-2 w-2 rounded-full', u.color === 'rojo' ? 'bg-red-500' : u.color === 'ambar' ? 'bg-amber-500' : 'bg-green-500')} />
                    {u.etiqueta}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-slate-700">{kpi.unidad}</p>
            )}
          </div>
        </div>

        {/* Pestañas de fases */}
        <div className="mt-5 -mx-1 flex overflow-x-auto px-1 pb-1">
          {FASES.map((f) => {
            const Icon = ICONOS[f.icono] ?? BookOpen
            const activa = f.id === fase
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFase(f.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
                  activa ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-primary-50 hover:text-primary'
                )}
              >
                <Icon className="h-4 w-4" />
                {f.etiqueta}
              </button>
            )
          })}
        </div>

        {/* Contenido de la fase */}
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border-l-4 border-primary bg-primary-50/60 p-3.5">
            <p className={cn(ETIQUETA, 'mb-1 text-primary-600')}>Objetivo de esta etapa</p>
            <p className="text-sm leading-relaxed text-slate-700">{kpi.fases[fase].objetivo}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {kpi.fases[fase].bloques.map((b) => (
              <div key={b.titulo} className="rounded-xl border border-slate-200 p-3.5">
                <h4 className="text-sm font-bold text-slate-800">{b.titulo}</h4>
                <ul className="mt-2 space-y-1.5">
                  {b.items.map((it) => (
                    <li key={it} className="flex gap-1.5 text-sm leading-relaxed text-slate-600">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary-400" />
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}