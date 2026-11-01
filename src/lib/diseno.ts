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
 * Tarjeta de «Cumplimiento por módulo»: fondo PASTEL del umbral con el
 * porcentaje y el icono en el tono profundo del mismo matiz (se pidieron
 * pasteles en 2026-01). Blanco no se lee sobre pastel —1,3:1 sobre el verde—
 * así que el texto baja al tono oscuro, y el par queda en ≥5:1.
 *
 * Los umbrales no se repiten acá: salen de `colorPuntajeHex`, así si cambian
 * cambian en las dos piezas.
 *
 * El par va como VARIABLES CSS y no como clase + hex: el fondo se pinta en
 * línea y no sigue la escala de Tailwind, así que en modo oscuro el fondo se
 * quedaba claro mientras el texto se aclaraba con la escala — texto claro
 * sobre pastel claro. Definiendo los dos juntos (`--pastel-*` en `index.css`),
 * el modo oscuro los cambia a la vez: fondo tintado oscuro + tinta clara.
 */
export interface TintaPastel {
  /** Fondo, para `style={{ background }}`. */
  fondo: string
  /** Tinta (texto e icono), para `style={{ color }}`. */
  tinta: string
}

const PASTEL_POR_UMBRAL: Record<string, TintaPastel> = {
  [HEX_CUMPLE]: { fondo: 'var(--pastel-verde-fondo)', tinta: 'var(--pastel-verde-tinta)' },
  [HEX_RIESGO]: { fondo: 'var(--pastel-ambar-fondo)', tinta: 'var(--pastel-ambar-tinta)' },
  [HEX_NO_CUMPLE]: { fondo: 'var(--pastel-rojo-fondo)', tinta: 'var(--pastel-rojo-tinta)' },
  [HEX_SIN_DATO]: { fondo: 'var(--pastel-gris-fondo)', tinta: 'var(--pastel-gris-tinta)' }
}

/** Fondo pastel + tinta que se lee sobre él (ver `PASTEL_POR_UMBRAL`). */
export function coloresTarjetaPuntaje(value: number | null): TintaPastel {
  return PASTEL_POR_UMBRAL[colorPuntajeHex(value)]
}

/**
 * Los mismos pasteles, para los CHIPS de nivel y estado del seguimiento.
 *
 * Los chips se pedían «con la temática pastel del sistema»: por eso no se
 * pinta un rojo sólido aparte sino el mismo pastel de las tarjetas de
 * puntaje, con su texto oscuro del mismo matiz (en oscuro, el par entero se
 * oscurece: ver `PASTEL_POR_UMBRAL`).
 */
export function chipPastel(umbral: 'cumple' | 'riesgo' | 'noCumple' | 'sinDato'): TintaPastel {
  const hex = umbral === 'cumple'
    ? HEX_CUMPLE
    : umbral === 'riesgo'
      ? HEX_RIESGO
      : umbral === 'noCumple'
        ? HEX_NO_CUMPLE
        : HEX_SIN_DATO
  return PASTEL_POR_UMBRAL[hex]
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

/* --- Color por serie en las donas del dashboard ---------------------------
 * Cada dona tiene una porción por sucursal / departamento / cargo: con la
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