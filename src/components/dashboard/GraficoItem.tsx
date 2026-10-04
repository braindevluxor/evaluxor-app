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
import { useState } from 'react'
import type { ResumenItemModulo, ResumenOpcionChecklist } from '../../lib/data/indicadores'
import { cn } from '../ui'
import { pct as pctComa } from '../../lib/numeros'

const VERDE = '#16a34a'
const AMBAR = '#d97706'
const ROJO = '#dc2626'
const GRIS = '#e2e8f0'

function colorDeUmbral(p: number): string {
  return p >= 80 ? VERDE : p >= 60 ? AMBAR : ROJO
}

/** Mezcla dos colores RGB (`a` → `b`) con proporción `p` (0..1). */
function mezclar(a: [number, number, number], b: [number, number, number], p: number): string {
  const c = a.map((x, k) => Math.round(x + (b[k] - x) * p))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

interface CeldaPolar { o: ResumenOpcionChecklist; reinc: number }

/**
 * Área polar de reincidencia por aspecto (CHECKLIST), estilo Chart.js `polarArea`:
 * cada aspecto es un sector de ángulo igual y su radio es la cantidad de veces que
 * NO se cumplió en el rango (más reincidencias → sector más grande y más rojo).
 * Rejilla polar de fondo + tooltip flotante con footer (total) al pasar el cursor, sin leyenda.
 */
function PolarReincidencia({ opciones }: { opciones: ResumenOpcionChecklist[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const datos: CeldaPolar[] = opciones
    .map((o) => ({ o, reinc: o.veces - o.cumplida }))
    .filter((d) => d.reinc > 0)
    .sort((a, b) => b.reinc - a.reinc)
  const totalReincidencias = datos.reduce((a, d) => a + d.reinc, 0)

  if (!datos.length) {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100">
          <span className="text-lg font-black text-emerald-700">0</span>
        </span>
        <p className="text-[11px] font-medium text-emerald-700">Sin reincidencias en el rango</p>
      </div>
    )
  }

  const maxV = Math.max(...datos.map((d) => d.reinc))
  const minV = Math.min(...datos.map((d) => d.reinc))
  const colorDe = (v: number): string => {
    // Normalización relativa: el más chico → verde, el más grande → rojo.
    const t = maxV === minV ? 0.5 : (v - minV) / (maxV - minV)
    return t < 0.5
      ? mezclar([34, 197, 94], [245, 158, 11], t * 2)
      : mezclar([245, 158, 11], [220, 38, 38], (t - 0.5) * 2)
  }

  const n = datos.length
  const C = 80 // centro del viewBox 160×160
  const R = 72 // radio máximo
  const angDe = (i: number) => ((-90 + (360 / n) * i) * Math.PI) / 180
  const rDe = (v: number, i: number) => (v / maxV) * R + (hover === i ? 5 : 0)
  const sectorDe = (i: number) => {
    const a0 = angDe(i)
    const a1 = angDe(i + 1)
    const r = rDe(datos[i].reinc, i)
    return `M ${C} ${C} L ${C + r * Math.cos(a0)} ${C + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${C + r * Math.cos(a1)} ${C + r * Math.sin(a1)} Z`
  }

  // Sector hovereado + posición del tooltip (anclado sobre el borde exterior del sector).
  const hovered = hover != null ? datos[hover] : undefined
  let tipX = 50
  let tipY = 50
  if (hovered) {
    const a = angDe(hover!) + Math.PI / n // ángulo medio del sector
    const r = R * 0.72
    tipX = Math.min(86, Math.max(14, ((C + r * Math.cos(a)) / 160) * 100))
    tipY = Math.min(86, Math.max(34, ((C + r * Math.sin(a)) / 160) * 100))
  }

  return (
    <div>
      <div className="flex justify-center">
        <div className="relative h-44 w-44 shrink-0">
          <svg
            viewBox="0 0 160 160"
            className="h-full w-full"
            role="img"
            aria-label={`Reincidencia por aspecto: ${totalReincidencias} ${totalReincidencias === 1 ? 'reincidencia' : 'reincidencias'} en el rango`}
          >
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="#e2e8f0" strokeWidth={1} />
            ))}
            <circle cx={C} cy={C} r={2.5} fill="#cbd5e1" />
            {datos.map((d, i) => (
              <path
                key={d.o.id}
                d={sectorDe(i)}
                fill={colorDe(d.reinc)}
                fillOpacity={hover == null || hover === i ? 1 : 0.45}
                stroke="#ffffff"
                strokeWidth={hover === i ? 2 : 1}
                className="cursor-pointer transition-all duration-150"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </svg>
          {hovered ? (
            <div
              className="pointer-events-none absolute z-10 w-44 -translate-x-1/2 -translate-y-[125%] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] shadow-xl"
              style={{ left: `${tipX}%`, top: `${tipY}%` }}
            >
              <p className="max-w-full truncate font-semibold text-slate-800">{hovered.o.etiqueta}</p>
              <p className="mt-0.5 text-slate-500">
                {hovered.reinc} {hovered.reinc === 1 ? 'reincidencia' : 'reincidencias'} de {hovered.o.veces} veces (cumplió {hovered.o.cumplida})
              </p>
              <p className="mt-1 border-t border-slate-100 pt-1 font-bold text-slate-900">
                Total: {totalReincidencias} {totalReincidencias === 1 ? 'reincidencia' : 'reincidencias'}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-slate-400">
        Área polar por aspecto: cada sector tiene el mismo ángulo y su radio es la reincidencia en el rango (más grande, más rojo) · pasa el cursor para ver el detalle · total {totalReincidencias}
      </p>
    </div>
  )
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
        className="relative h-24 w-24 shrink-0 rounded-full shadow-sm ring-1 ring-slate-200 transition-transform duration-300 hover:scale-[1.03]"
        style={{ background: pct == null ? GRIS : `conic-gradient(${VERDE} ${pct * 3.6}deg, ${ROJO} 0deg)` }}
        title={proporcion == null ? 'Sin respuestas puntuables' : `${pctComa(proporcion * 100)} de cumplimiento`}
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

/** Checklist: promedio + área polar con la reincidencia por aspecto. */
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
        <div className="space-y-2 border-t border-slate-100 pt-2.5">
          <p className="text-[11px] font-semibold text-slate-500">Reincidencia por aspecto</p>
          <PolarReincidencia opciones={opciones} />
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
          {total ? `${total} productos escaneados · tasa de descuadre ${pctComa(c?.tasaDescuadre)}` : 'Sin productos escaneados en el rango'}
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

  if (item.tipo === 'PLANO_XY') {
    return (
      <BarraProporcion
        proporcion={resumen.promedio}
        total={resumen.muestras}
        etiqueta="Puntos del plano que cumplen"
        unidad="evaluaciones con plano"
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