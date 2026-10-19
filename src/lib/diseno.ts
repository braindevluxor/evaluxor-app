/* ---------------------------------------------------------------------------
 * Tokens de diseño semánticos (fuente única).
 *
 * Antes de este módulo, los significados visuales de la app vivían duplicados
 * en 3–7 archivos cada uno y ya se contradecían entre sí: el mismo estado de
 * evaluación salía verde en una pantalla y ámbar en otra, los tipos de ítem
 * tenían una paleta distinta según la pantalla y los umbrales 60/80 estaban
 * escritos como hex en cada gráfico. Todo lo semántico se decide aquí.
 *
 * Las clases van en MINÚSCULAS sin acentos (HTML). Los hex son las copias sin
 * token que usan los gráficos SVG/Recharts: como no se pueden heredar tokens
 * Tailwind adentro de un `<LinearGradient>` o `<stop>`, se centralizan acá.
 * ------------------------------------------------------------------------- */
import type { EstadoEvaluacion, TipoItem } from './types'

/* --- Umbrales de puntaje (verde ≥ 80, ámbar 60–79, rojo < 60) -------------- */

export const HEX_CUMPLE = '#16a34a'
export const HEX_RIESGO = '#d97706'
export const HEX_NO_CUMPLE = '#dc2626'
/** Gris de "sin dato": se usa donde un valor nulo dejaría un hueco. */
export const HEX_SIN_DATO = '#cbd5e1'

/** Clase de texto para un puntaje (usa `Puntaje` y derivados). */
export function colorPuntajeClase(value: number | null): string {
  if (value == null) return 'text-slate-400'
  return value >= 80 ? 'text-green-700' : value >= 60 ? 'text-amber-700' : 'text-red-700'
}

/** Índice de la paleta `Badge` para un puntaje (etiquetas "Cumple/En riesgo/No cumple"). */
export function colorBadgePuntaje(value: number): number {
  return value >= 80 ? 2 : value >= 60 ? 3 : 4
}

/** Hex por umbral para gráficos; `null` → gris sin dato. */
export function colorPuntajeHex(value: number | null): string {
  if (value == null) return HEX_SIN_DATO
  return value >= 80 ? HEX_CUMPLE : value >= 60 ? HEX_RIESGO : HEX_NO_CUMPLE
}

/**
 * Fondo sólido coloreado por puntaje (las tarjetas de «Cumplimiento por
 * módulo»): mismos umbrales que `colorPuntajeHex`, pero con el «sin dato» más
 * oscuro (slate-500). Esas tarjetas llevan el porcentaje y el icono en
 * blanco, y sobre el gris claro de los gráficos no se leerían. Blanco sobre
 * los tres colores de umbral queda en ≥3:1, que es lo que pide el texto grande.
 */
export function colorFondoPuntaje(value: number | null): string {
  if (value == null) return '#64748b'
  return colorPuntajeHex(value)
}

/* --- Colores de marca (el navy EvaLuxor se escribía a mano en ~6 archivos) -- */
export const HEX_PRIMARY = '#28315F'
export const HEX_PRIMARY_400 = '#4f87c7'
export const HEX_PRIMARY_900 = '#0b2545'

/* --- Colores de los módulos del dashboard ---------------------------------- */
/**
 * Paleta ordenada y PASTEL de los módulos en los gráficos (curvas de la
 * ponderación); el tono de marca va primero. Se pidieron pasteles en 2026-01:
 * se conservan los matices de la paleta saturada que había antes —cada módulo
 * seguía siendo reconocible por su matiz— con la saturación acotada entre 45%
 * y 65% y la luminosidad alternada 66/76, porque dos pasteles seguidos se
 * confunden si sólo cambia el matiz.
 */
export const COLORES_MODULOS = ['#818ECF', '#A2C0E2', '#70E199', '#EACC9A', '#E17070', '#B29AEA', '#70D0E1', '#EA9ABE']

/* --- Color por serie en las tortas del dashboard ---------------------------
 * Cada torta tiene una porción por sucursal / departamento / cargo: con la
 * paleta de módulos no alcanza y los tonos seguidos del arcoíris quedan casi
 * iguales entre vecinos, así que se avanza el ángulo dorado (137,5°). La
 * saturación y la luminosidad quedan en clave pastel, igual que las curvas. */
export function colorSerie(i: number): string {
  return `hsl(${Math.round(i * 137.508) % 360} 62% 74%)`
}

/* --- Estados de evaluación (PROGRAMADA / ACTIVA / CERRADA) ------------------
 * Semántica decidida:
 *  - PROGRAMADA → azul de marca (1): agendada, disponible en el futuro.
 *  - ACTIVA     → verde (2): viva, es donde hay que actuar ahora.
 *  - CERRADA    → gris (0): terminada, sin atención pendiente.
 * El rojo y el ámbar quedan reservados al semáforo de puntaje (No cumple/Riesgo),
 * que viaja en la misma fila, para que nunca se confundan los dos lenguajes. */
export const ETIQUETA_ESTADO: Record<EstadoEvaluacion, string> = {
  PROGRAMADA: 'Programada',
  ACTIVA: 'Activa',
  CERRADA: 'Cerrada'
}

export const COLOR_BADGE_ESTADO: Record<EstadoEvaluacion, number> = {
  PROGRAMADA: 1,
  ACTIVA: 2,
  CERRADA: 0
}

/** Etiqueta/índice de badge tolerantes a estados desconocidos (datos crudos). */
export function etiquetaEstado(estado: string): string {
  return ETIQUETA_ESTADO[estado as EstadoEvaluacion] ?? estado
}

export function badgeEstado(estado: string): number {
  return COLOR_BADGE_ESTADO[estado as EstadoEvaluacion] ?? 0
}

/* --- Tipos de ítem ----------------------------------------------------------
 * Dos salidas de la MISMA paleta:
 *  - `COLOR_BADGE_TIPO_ITEM` → índice de `Badge` (usado en ItemRenderer/Items).
 *  - `CLASES_TIPO_ITEM`      → clases completas (usado donde se pinta a mano,
 *    p. ej. las tarjetas de ModuloDashboard).
 * Antes cada pantalla elegía una familia distinta para el mismo tipo. */
const PALETA_TIPO: Record<TipoItem, [number, string]> = {
  CUMPLE_NO_CUMPLE: [2, 'bg-green-100 text-green-800'],
  CHECKLIST: [5, 'bg-indigo-100 text-indigo-800'],
  CONCILIACION: [3, 'bg-amber-100 text-amber-800'],
  LISTA_COLABORADORES: [1, 'bg-primary-50 text-primary-700'],
  UNIDAD_CHECKLIST: [0, 'bg-slate-100 text-slate-700'],
  PLANO_XY: [4, 'bg-red-100 text-red-700'],
  CONTENEDOR: [0, 'bg-slate-100 text-slate-700']
}

export const COLOR_BADGE_TIPO_ITEM: Record<TipoItem, number> = Object.fromEntries(
  Object.entries(PALETA_TIPO).map(([t, [i]]) => [t, i])
) as Record<TipoItem, number>

export const CLASES_TIPO_ITEM: Record<TipoItem, string> = Object.fromEntries(
  Object.entries(PALETA_TIPO).map(([t, [, c]]) => [t, c])
) as Record<TipoItem, string>

/* --- Etiqueta micro-uppercase (eyebrow) --------------------------------------
 * El patrón `text-[10px] font-bold uppercase tracking-* text-slate-*` se copiaba
 * con variantes entre pantallas; una sola clase para todas. */
export const EYEBROW = 'text-[10px] font-bold uppercase tracking-wider text-slate-500'

/* --- Contenedores de las vistas del dashboard -------------------------------
 * El `<main>` de ConsoleLayout pinta `bg-slate-100` (y el panel de filtros del
 * dashboard, también): ahí los contenedores usan ese mismo gris en lugar de
 * blanco, para que la pantalla no se lea como cajas blancas flotando sobre el
 * fondo. Si cambia el gris del layout, cambia solo acá.
 * El `!` es porque `Card` ya trae `bg-white` y esta clase llega después por `cn`. */
export const CLASE_CONTENEDOR_DASHBOARD = 'bg-slate-100!'