/**
 * Anillo de progreso estilo ECharts "gauge-progress" dibujado con SVG nativo:
 * pista de fondo gris claro + aro de progreso con puntas redondeadas y gradiente
 * de color (por etapa alcanzada) + valor grande al centro. Anima el aro y el
 * número como los medidores ECharts. Sin librerías.
 */
import { useId } from 'react'
import { TRANSICION, useAnimacionActiva, useNumeroAnimado } from './useAnimacion'

/** Cortes (%) de estado y su gradiente (tono claro → intenso). */
const ETAPAS: { umbral: number; color: string; claro: string }[] = [
  { umbral: 60, color: '#dc2626', claro: '#f87171' }, // no cumple
  { umbral: 80, color: '#d97706', claro: '#fbbf24' }, // en riesgo
  { umbral: 101, color: '#16a34a', claro: '#4ade80' } // cumple
]

function estadoDe(valor: number | null): { color: string; claro: string } | null {
  if (valor == null) return null
  return ETAPAS.find((e) => valor < e.umbral) ?? ETAPAS[ETAPAS.length - 1]
}

const CX = 88
const CY = 90
const R = 58
const GROSOR = 12
const INICIO = -135 // grados desde las 12 en sentido horario (inicio del arco)
const ARCO = 270

function anguloDe(valor: number): number {
  return INICIO + (ARCO * Math.min(100, Math.max(0, valor))) / 100
}

function punto(r: number, grados: number): [number, number] {
  const a = (grados * Math.PI) / 180
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)]
}

function arco(r: number, a0: number, a1: number): string {
  const [x0, y0] = punto(r, a0)
  const [x1, y1] = punto(r, a1)
  const grande = a1 - a0 > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function fmt(v: number): string {
  return `${Math.round(v * 100) / 100}%`
}

/** Máximo de caracteres aprox. por línea (≈ ancho del viewBox a font 14 bold). */
const MAX_CHARS_NOMBRE = 20

/**
 * Parte el nombre del módulo en a lo sumo 2 líneas para que no se corte:
 * el texto SVG no salta de línea solo, así que partimos por palabras (y cortamos
 * palabras muy largas) cuando el nombre excede el ancho disponible.
 */
function partirNombre(nombre: string): string[] {
  const palabras = nombre.trim().split(/\s+/)
  const lineas: string[] = []
  let actual = ''
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra
    if (candidata.length <= MAX_CHARS_NOMBRE) {
      actual = candidata
      continue
    }
    if (actual) lineas.push(actual)
    let resto = palabra
    while (resto.length > MAX_CHARS_NOMBRE) {
      lineas.push(resto.slice(0, MAX_CHARS_NOMBRE))
      resto = resto.slice(MAX_CHARS_NOMBRE)
    }
    actual = resto
  }
  if (actual) lineas.push(actual)
  return lineas.slice(0, 2)
}

export function MedidorModulo({
  nombre,
  valor,
  sub
}: {
  nombre: string
  valor: number | null
  sub?: string
}) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, '_')
  const est = estadoDe(valor)
  const color = est?.color ?? '#94a3b8'
  const animada = useAnimacionActiva()
  const numero = useNumeroAnimado(valor)
  const [linea1, linea2] = partirNombre(nombre)

  // El aro se dibuja desde vacío (offset 100) hasta el valor (100 − v) al animarse.
  const offset = animada && valor != null ? Math.round((100 - valor) * 100) / 100 : 100
  const texto = numero != null ? fmt(numero) : '—'

  return (
    <svg
      viewBox="0 0 176 206"
      role="img"
      aria-label={`${nombre}: ${valor != null ? fmt(valor) : 'sin datos'}`}
      className="w-full"
    >
      <defs>
        {est ? (
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={est.claro} />
            <stop offset="100%" stopColor={est.color} />
          </linearGradient>
        ) : null}
      </defs>

      {/* Pista de fondo */}
      <path d={arco(R, INICIO, INICIO + ARCO)} fill="none" stroke="#e2e8f0" strokeWidth={GROSOR} strokeLinecap="butt" />

      {/* Progreso hasta el valor (animado) */}
      {valor != null && valor > 0 ? (
        <path
          d={arco(R, INICIO, anguloDe(valor))}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={GROSOR}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={offset}
          style={{ transition: TRANSICION }}
        />
      ) : null}

      {/* Valor central (animado) */}
      <text
        x={CX}
        y={CY + 12}
        textAnchor="middle"
        fontSize={28}
        fontWeight={800}
        fill={color}
        className="tabular-nums"
      >
        {texto}
      </text>
      {/* Nombre del módulo (1 o 2 líneas, sin cortarse) */}
      <text textAnchor="middle" fontSize={14} fontWeight={700} fill="#334155">
        <tspan x={CX} y={linea2 ? CY + 70 : CY + 80}>
          {linea1}
        </tspan>
        {linea2 ? (
          <tspan x={CX} y={CY + 86}>
            {linea2}
          </tspan>
        ) : null}
      </text>
      {sub ? (
        <text x={CX} y={CY + 102} textAnchor="middle" fontSize={11} fill="#94a3b8">
          {sub}
        </text>
      ) : null}
    </svg>
  )
}