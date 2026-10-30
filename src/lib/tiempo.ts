/**
 * Utilidades de tiempo para la "última sincronización" de cada usuario.
 * Todo tolera null/undefined: sin marca se muestra "Sin datos".
 */

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

/** Antigüedad de una marca ISO, en milisegundos (0 si no hay marca). */
export function antiguedadMs(iso: string | null | undefined, ahora = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, ahora - t)
}

/** "hace 3 min" · "hace 2 h" · "hace 4 días" · "Sin datos". */
export function desdeAhora(iso: string | null | undefined, ahora = Date.now()): string {
  const ms = antiguedadMs(iso, ahora)
  if (ms === null) return 'Sin datos'
  if (ms < MIN) return 'recién'
  if (ms < HORA) return `hace ${Math.floor(ms / MIN)} min`
  if (ms < DIA) return `hace ${Math.floor(ms / HORA)} h`
  const dias = Math.floor(ms / DIA)
  return dias === 1 ? 'ayer' : `hace ${dias} días`
}

/** Fecha y hora cortas "29/09 18:40" (o "Sin datos"). Formato manual a propósito:
 *  `toLocaleString` depende de la versión de ICU y en Node devolvía "29/9, 18:40". */
export function formatearFechaHora(iso: string | null | undefined): string {
  if (!iso) return 'Sin datos'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Sin datos'
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`
}

/**
 * Semáforo de la última subida a la nube:
 * - `nunca`   → nunca subió (o la marca es inválida)
 * - `reciente`→ dentro de los últimos 30 min
 * - `medio`   → entre 30 min y 24 h
 * - `viejo`   → hace más de un día
 */
export type EstadoSync = 'nunca' | 'reciente' | 'medio' | 'viejo'

export function estadoSync(iso: string | null | undefined, ahora = Date.now()): EstadoSync {
  const ms = antiguedadMs(iso, ahora)
  if (ms === null) return 'nunca'
  if (ms < 30 * MIN) return 'reciente'
  if (ms < DIA) return 'medio'
  return 'viejo'
}

/** Texto de la etiqueta del semáforo (para titles/tooltips). */
export const TEXTO_ESTADO_SYNC: Record<EstadoSync, string> = {
  nunca: 'Nunca subió datos a la nube',
  reciente: 'Subió datos hace poco',
  medio: 'Última subida hace más de 30 min',
  viejo: 'Sin subir datos hace más de un día'
}

/** Clases del punto de color del semáforo. */
export const COLOR_ESTADO_SYNC: Record<EstadoSync, string> = {
  nunca: 'bg-slate-300',
  reciente: 'bg-green-500',
  medio: 'bg-amber-400',
  viejo: 'bg-red-500'
}
