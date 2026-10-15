/**
 * Medidor circular estilo ECharts "gauge-stage" dibujado con SVG nativo:
 * arco dividido en etapas de color (no cumple / riesgo / cumple), aguja con
 * centro, y el valor grande en el medio. Anima aguja y número. Sin librerías de gráficos.
 */
import { TRANSICION, useAnimacionActiva, useNumeroAnimado } from './useAnimacion'

/** Etapas del arco: corte (%) y color. Ordenadas de menor a mayor. */
const ETAPAS: { hasta: number; color: string; nombre: string }[] = [
  { hasta: 60, color: '#dc2626', nombre: 'No cumple' },
  { hasta: 80, color: '#d97706', nombre: 'En riesgo' },
  { hasta: 100, color: '#16a34a', nombre: 'Cumple' }
]

/** La aguja y el valor se colorean según la etapa alcanzada. */
function colorDe(valor: number | null): string {
  if (valor == null) return '#94a3b8'
  if (valor >= 80) return '#16a34a'
  if (valor >= 60) return '#d97706'
  return '#dc2626'
}

const CX = 130
const CY = 124
/** Radio del arco (banda) en unidades del viewBox. */
const R = 78
const GROSOR = 15
const INICIO = -135 // grados desde las 12 en sentido horario (esquina inferior izquierda)
const ARCO = 270 // barrido total

function anguloDe(valor: number): number {
  return INICIO + (ARCO * Math.min(100, Math.max(0, valor))) / 100
}

/** Punto sobre la circunferencia: θ se mide desde las 12 hacia la derecha. */
function punto(cx: number, cy: number, r: number, grados: number): [number, number] {
  const a = (grados * Math.PI) / 180
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

/** Trazo de arco de a0 a a1 (sentido horario). */
function arco(r: number, a0: number, a1: number): string {
  const [x0, y0] = punto(CX, CY, r, a0)
  const [x1, y1] = punto(CX, CY, r, a1)
  const grande = a1 - a0 > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function fmt(v: number): string {
  return `${Math.round(v * 100) / 100}%`
}

export function MedidorCumplimiento({
  valor,
  titulo = 'Cumplimiento global',
  sub
}: {
  valor: number | null
  titulo?: string
  sub?: string
}) {
  const aValor = valor != null ? anguloDe(valor) : -90
  const color = colorDe(valor)
  const animada = useAnimacionActiva()
  const numero = useNumeroAnimado(valor)
  // La aguja se dibuja apuntando a las 12 y rota hasta el valor (desde el inicio del arco).
  const rot = animada ? Math.round(aValor * 100) / 100 : INICIO

  return (
    <svg
      viewBox="0 0 260 228"
      role="img"
      aria-label={`${titulo}: ${valor != null ? fmt(valor) : 'sin datos'}`}
      className="w-full max-w-sm"
    >
      {/* Etapas del arco */}
      {ETAPAS.map((e, i) => {
        const desde = i === 0 ? 0 : ETAPAS[i - 1].hasta
        return (
          <path
            key={e.hasta}
            d={arco(R, anguloDe(desde), anguloDe(e.hasta))}
            fill="none"
            stroke={e.color}
            strokeWidth={GROSOR}
            strokeLinecap="butt"
            opacity={0.9}
          />
        )
      })}

      {/* Escala: ticks y etiquetas */}
      {[0, 25, 50, 75, 100].map((v) => {
        const a = anguloDe(v)
        const [t0x, t0y] = punto(CX, CY, 88, a)
        const [t1x, t1y] = punto(CX, CY, 96, a)
        const [lx, ly] = punto(CX, CY, 106, a)
        return (
          <g key={v}>
            <line x1={t0x} y1={t0y} x2={t1x} y2={t1y} stroke="#cbd5e1" strokeWidth={1.4} strokeLinecap="round" />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9.5}
              fontWeight={600}
              fill="#64748b"
            >
              {v}
            </text>
          </g>
        )
      })}

      {/* Aguja (animada: rota desde el inicio del arco hasta el valor) */}
      {valor != null ? (
        <g
          style={{
            transform: `rotate(${rot}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
            transformBox: 'view-box',
            transition: TRANSICION
          }}
        >
          <polygon
            points={`${CX.toFixed(2)},${(CY - 70).toFixed(2)} ${(CX - 11).toFixed(2)},${CY.toFixed(2)} ${(CX + 11).toFixed(2)},${CY.toFixed(2)}`}
            fill="#0B2545"
            stroke="#ffffff"
            strokeWidth={1}
          />
        </g>
      ) : null}
      <circle cx={CX} cy={CY} r={8.5} fill="#0B2545" />
      <circle cx={CX} cy={CY} r={3.6} fill="#f8fafc" />

      {/* Valor central (animado) */}
      <text
        x={CX}
        y={CY + 30}
        textAnchor="middle"
        fontSize={27}
        fontWeight={800}
        fill={color}
        className="tabular-nums"
      >
        {numero != null ? fmt(numero) : '—'}
      </text>
      <text x={CX} y={CY + 45} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#475569">
        {titulo}
      </text>
      {sub ? (
        <text x={CX} y={CY + 57} textAnchor="middle" fontSize={9} fill="#94a3b8">
          {sub}
        </text>
      ) : null}
    </svg>
  )
}

/** Leyenda compacta de las etapas (uso en tarjetas del dashboard). */
export function LeyendaEtapas() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
      {ETAPAS.map((e) => (
        <span key={e.hasta} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: e.color }} />
          {e.nombre}
        </span>
      ))}
    </div>
  )
}