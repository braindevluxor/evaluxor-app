/**
 * Gráfico más idóneo por tipo de ítem, a partir del resumen agregado de un
 * módulo en el rango seleccionado:
 * - CUMPLE_NO_CUMPLE   → Donut (cumplen vs no cumplen).
 * - CHECKLIST          → Promedio con barra de umbral + cumplimiento por opción.
 * - CONCILIACION       → Donut de productos conciliados vs descuadrados + tasa.
 * - LISTA_COLABORADORES→ Barra de % de colaboradores que cumplen (de los que aplican).
 * - UNIDAD_CHECKLIST   → Barra de % de unidades que cumplen.
 * - CONTENEDOR         → (agrupador) resumen promedio de sus hijos en la página.
 * Sin librerías de gráficos: SVG/CSS ligeros y consistentes con la paleta de la app.
 */
import type { ResumenItemModulo } from '../../lib/data/indicadores'
import { cn } from '../ui'

const VERDE = '#16a34a'
const AMBAR = '#d97706'
const ROJO = '#dc2626'
const GRIS = '#e2e8f0'

function colorDeUmbral(p: number): string {
  return p >= 80 ? VERDE : p >= 60 ? AMBAR : ROJO
}

/** Donut con % central y leyenda de conteos (verde = cumple/ok, rojo = no). */
function Donut({ proporcion, ok, no, etiquetaOk, etiquetaNo }: {
  proporcion: number | null
  ok: number
  no: number
  etiquetaOk: string
  etiquetaNo: string
}) {
  const pct = proporcion == null ? null : Math.round(proporcion * 100)
  return (
    <div className="flex items-center gap-4">
      <div
        className="relative h-24 w-24 shrink-0 rounded-full"
        style={{ background: pct == null ? GRIS : `conic-gradient(${VERDE} ${pct * 3.6}deg, ${ROJO} 0deg)` }}
      >
        <div className="absolute inset-2.5 grid place-items-center rounded-full bg-white shadow-inner">
          <span className={cn('text-lg font-black tabular-nums', pct == null ? 'text-slate-300' : 'text-slate-800')}>
            {pct == null ? '—' : `${pct}%`}
          </span>
        </div>
      </div>
      <div className="min-w-0 space-y-1.5 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-slate-600">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: VERDE }} />
          <span className="min-w-0 truncate">{etiquetaOk}</span>
          <span className="font-bold text-slate-900">{ok}</span>
        </p>
        <p className="flex items-center gap-1.5 font-medium text-slate-600">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: ROJO }} />
          <span className="min-w-0 truncate">{etiquetaNo}</span>
          <span className="font-bold text-slate-900">{no}</span>
        </p>
        {proporcion == null ? (
          <p className="pt-1 font-medium text-slate-400">Sin respuestas puntuables en el rango</p>
        ) : null}
      </div>
    </div>
  )
}

/** Barra horizontal de proporción coloreada por umbral (verde/ámbar/rojo). */
function BarraProporcion({ proporcion, total, etiqueta, unidad }: {
  proporcion: number | null
  total: number
  etiqueta: string
  unidad: string
}) {
  const pct = proporcion == null ? null : Math.round(proporcion * 100)
  const color = pct == null ? GRIS : colorDeUmbral(pct)
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">{etiqueta}</p>
        <p className="text-sm font-black tabular-nums" style={{ color }}>
          {pct == null ? '—' : `${pct}%`}
        </p>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
      <p className="text-[11px] text-slate-400">
        {proporcion == null
          ? total > 0 ? 'Sin respuestas puntuables en el rango' : 'Sin respuestas en el rango'
          : `${unidad}: ${total}`}
      </p>
    </div>
  )
}

/** Checklist: promedio + fila por opción (casilla/rango) con su % de veces cumplida. */
function ChecklistGrafico({ resumen }: { resumen: ResumenItemModulo }) {
  const { promedio, muestras, opciones } = resumen
  return (
    <div className="space-y-3">
      <BarraProporcion
        proporcion={promedio}
        total={muestras}
        etiqueta="Promedio de cumplimiento"
        unidad="respuestas puntuables"
      />
      {promedio != null && opciones?.length ? (
        <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
          {opciones.map((o) => {
            const pct = o.veces ? Math.round((o.cumplida / o.veces) * 100) : 0
            const color = !o.veces ? GRIS : pct >= 100 ? VERDE : pct >= 60 ? AMBAR : ROJO
            return (
              <div key={o.id} className="flex items-center gap-2.5">
                <p className="w-40 min-w-0 shrink-0 truncate text-xs text-slate-600 sm:w-52" title={o.etiqueta}>
                  {o.etiqueta}
                </p>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
                <p className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
                  {o.veces ? `${o.cumplida}/${o.veces}` : '—'}
                </p>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function GraficoItem({ resumen }: { resumen: ResumenItemModulo }) {
  const { item } = resumen

  if (item.tipo === 'CUMPLE_NO_CUMPLE') {
    return (
      <Donut
        proporcion={resumen.promedio}
        ok={resumen.muestras ? resumen.ok : 0}
        no={resumen.muestras ? resumen.muestras - resumen.ok : 0}
        etiquetaOk="Cumplen"
        etiquetaNo="No cumplen"
      />
    )
  }

  if (item.tipo === 'CHECKLIST') {
    return <ChecklistGrafico resumen={resumen} />
  }

  if (item.tipo === 'CONCILIACION') {
    const c = resumen.conciliacion
    const total = c?.total ?? 0
    const conciliados = c?.conciliados ?? 0
    return (
      <div className="space-y-3">
        <Donut
          proporcion={total ? conciliados / total : null}
          ok={conciliados}
          no={total - conciliados}
          etiquetaOk="Conciliados"
          etiquetaNo="Descuadrados"
        />
        <p className="text-[11px] text-slate-400">
          {total ? `${total} productos escaneados · tasa de descuadre ${c?.tasaDescuadre ?? 0}%` : 'Sin productos escaneados en el rango'}
        </p>
      </div>
    )
  }

  if (item.tipo === 'LISTA_COLABORADORES') {
    const col = resumen.colaboradores
    const total = col?.total ?? 0
    return (
      <BarraProporcion
        proporcion={total ? col!.ok / total : null}
        total={total}
        etiqueta="Colaboradores que cumplen"
        unidad="colaboradores evaluados (aplican)"
      />
    )
  }

  if (item.tipo === 'UNIDAD_CHECKLIST') {
    const uni = resumen.unidades
    const total = uni?.total ?? 0
    return (
      <BarraProporcion
        proporcion={total ? uni!.ok / total : null}
        total={total}
        etiqueta="Unidades que cumplen"
        unidad="unidades evaluadas"
      />
    )
  }

  // CONTENEDOR u otro: la página agrupa sus hijos; resumen simple por si acaso.
  return (
    <BarraProporcion
      proporcion={resumen.promedio}
      total={resumen.muestras}
      etiqueta="Cumplimiento del grupo"
      unidad="respuestas puntuables"
    />
  )
}