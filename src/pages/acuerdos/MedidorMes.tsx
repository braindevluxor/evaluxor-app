import { porcentajeAnillo, usd } from '../../lib/acuerdos'

/**
 * EL MEDIDOR CURVO (semicírculo multi-anillo)
 * -------------------------------------------
 * Cada anillo es una magnitud del MES elegido: su valor se dibuja como un
 * arco de color sobre una pista gris que siempre va de la izquierda a la
 * derecha (180°). El % es `valor / base`, y la base se explica en la
 * leyenda de la derecha — son distintas para cada anillo, por eso no se
 * pueden adivinar leyendo sólo el número.
 *
 * Va como SVG propio y no como gráfico de recharts: recharts no tiene
 * anillos concéntricos con pista, y acá el dibujo es literalmente tres
 * `path` (pista + relleno) por anillo.
 */

export type AnilloMedidor = {
  id: string
  etiqueta: string
  /** El monto en USD que representa. */
  valor: number
  /** El denominador del porcentaje (0 → no hay base, se muestra «—»). */
  base: number
  /** De qué es la base, para la leyenda («del total vigente»…). */
  baseTexto: string
  color: string
}

/* Geometría: el centro está abajo al medio y los anillos crecen hacia
   afuera. Con 4 anillos de 22px y 10px de hueco, el mayor queda en r=162
   y con su grosor llega a 173 — que es lo que define el viewBox. */
const CX = 200
const CY = 200
const R_MIN = 66
const GROSOR = 22
const HUECO = 10
const PASO = GROSOR + HUECO

const radio = (i: number) => R_MIN + i * PASO

/** La pista COMPLETA de un anillo: el semicírculo de izquierda a derecha. */
function pista(r: number): string {
  return `M ${CX - r},${CY} A ${r},${r} 0 0,1 ${CX + r},${CY}`
}

/** El punto donde termina un arco de `pct` (y donde va su etiqueta). */
function finDeArco(r: number, pct: number): { x: number; y: number } {
  const angulo = Math.PI * (1 - Math.max(0, Math.min(1, pct)))
  return { x: CX + r * Math.cos(angulo), y: CY - r * Math.sin(angulo) }
}

export function MedidorMes({ anillos, etiqueta }: { anillos: AnilloMedidor[]; etiqueta: string }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
      <svg
        viewBox="0 0 400 215"
        className="w-full max-w-[30rem] shrink-0"
        role="img"
        aria-label={`Medidor de ${etiqueta}: ${anillos
          .map((a) => {
            const p = porcentajeAnillo(a.valor, a.base)
            return `${a.etiqueta} ${p === null ? 'sin base' : `${Math.round(p * 100)}%`}`
          })
          .join(', ')}`}
      >
        {anillos.map((a, i) => {
          const r = radio(i)
          const pct = porcentajeAnillo(a.valor, a.base)
          // El ARCO se techoa al 100 % (un anillo no puede dar más vuelta
          // que su pista), pero el NÚMERO muestra el valor real: si este
          // mes se cobró más de lo negociado, dice 150 % y no miente.
          const arco = pct === null ? 0 : Math.min(1, pct)
          const fin = finDeArco(r, arco)
          return (
            <g key={a.id}>
              {/* La pista: siempre el semicírculo entero, en gris. */}
              <path d={pista(r)} fill="none" stroke="#e2e8f0" strokeWidth={GROSOR} />
              {/* El relleno: la MISMA pista, cortada con `stroke-dasharray`
                  sobre `pathLength=100` (así el % es directo y el corte se
                  anima al cambiar de mes). */}
              {arco > 0 ? (
                <path
                  d={pista(r)}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={GROSOR}
                  pathLength={100}
                  strokeDasharray={`${arco * 100} 100`}
                  style={{ transition: 'stroke-dasharray 500ms ease' }}
                />
              ) : null}
              {/* El % sobre el final del arco, con halo blanco para que se
                  lea encima de la pista gris. */}
              <text
                x={fin.x}
                y={fin.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={800}
                fill={pct === null ? '#94a3b8' : a.color}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {pct === null ? '—' : `${Math.round(pct * 100)}%`}
              </text>
            </g>
          )
        })}
      </svg>

      {/* La leyenda: el valor en USD y, sobre todo, QUÉ ES LA BASE de
          cada porcentaje — sin esto los cuatro números no se entienden. */}
      <ul className="min-w-0 flex-1 divide-y divide-slate-100">
        {anillos.map((a) => {
          const pct = porcentajeAnillo(a.valor, a.base)
          return (
            <li key={a.id} className="flex items-start gap-3 py-2.5">
              <span
                className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: a.color }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-xs font-extrabold uppercase tracking-wide text-slate-700">
                    {a.etiqueta}
                  </span>
                  <span
                    className="shrink-0 text-sm font-black tabular-nums"
                    style={{ color: pct === null ? '#94a3b8' : a.color }}
                  >
                    {pct === null ? '—' : `${Math.round(pct * 100)}%`}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[11px] text-slate-500">{a.baseTexto}</span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-slate-800">
                    {usd(a.valor)} USD
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
