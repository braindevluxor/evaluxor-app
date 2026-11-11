/**
 * Identidad de la build que está corriendo el dispositivo.
 *
 * Los valores vienen de `vite.config.ts` (inyectados con `define`); en los tests
 * no existen, por eso se leen con `typeof`. `version.json` es el mismo dato
 * publicado en la raíz del sitio: la app lo consulta para detectar despliegues
 * nuevos y decidir si se actualiza sola o le avisa al usuario.
 */

export interface VersionBuild {
  version: string
  buildId: string
  commit: string
  fecha: string
}

const SIN_DEFINE = '0.0.0-dev'

function constante(nombre: string, respaldo: string): string {
  // `typeof` sobre un identificador no declarado no lanza: los tests corren sin
  // el `define` de Vite.
  try {
    if (nombre === '__APP_VERSION__') return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : respaldo
    if (nombre === '__BUILD_ID__') return typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : respaldo
    return typeof __BUILD_FECHA__ === 'string' ? __BUILD_FECHA__ : respaldo
  } catch {
    return respaldo
  }
}

/** Versión de negocio declarada en package.json (p. ej. "0.1.0"). */
export const APP_VERSION = constante('__APP_VERSION__', SIN_DEFINE)

/** Identidad única de esta build: "20260929-1912-a1b2c3" (fecha + commit). */
export const BUILD_ID = constante('__BUILD_ID__', SIN_DEFINE)

/** Momento del build en ISO. */
export const BUILD_FECHA = constante('__BUILD_FECHA__', '')

export const BUILD_ACTUAL: VersionBuild = {
  version: APP_VERSION,
  buildId: BUILD_ID,
  commit: BUILD_ID.split('-').pop() ?? '',
  fecha: BUILD_FECHA
}

/** "0.1.0 · 29/09 19:12 · a1b2c3" — para pantalla y para reportes. */
export function versionCorta(b: Pick<VersionBuild, 'version' | 'buildId' | 'commit'> = BUILD_ACTUAL): string {
  const [fecha, hora] = b.buildId.split('-')
  const dia = fecha && /^\d{8}$/.test(fecha) ? `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}` : null
  // El buildId lleva la hora sin dos puntos ("1912") para que sea ordenable.
  const hs = hora && /^\d{4}$/.test(hora) ? `${hora.slice(0, 2)}:${hora.slice(2, 4)}` : null
  const momento = dia && hs ? `${dia} ${hs}` : null
  return [b.version, momento, b.commit].filter(Boolean).join(' · ')
}

/** Dos builds son distintos si cambia el buildId (o el commit si no hay fecha). */
export function esBuildDistinta(a: Pick<VersionBuild, 'buildId'> | null, b: Pick<VersionBuild, 'buildId'> = BUILD_ACTUAL): boolean {
  if (!a || !a.buildId) return false
  return a.buildId !== b.buildId
}

/**
 * ¿Está la persona trabajando en una evaluación? Ahí no se recarga solo: una
 * recarga automática cortaría lo que está completando. Son las pantallas de
 * sucursal y el resumen (donde se envía).
 */
export function esPantallaDeTrabajo(pathname: string): boolean {
  const partes = pathname.split('/').filter(Boolean)
  if (partes[0] !== 'evaluar') return false
  if (partes.length < 2) return false
  // `/evaluar/historial` es solo una lista: recargarla no pierde nada.
  return partes[1] !== 'historial'
}

function esVersionBuild(v: unknown): v is VersionBuild {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.buildId === 'string' && o.buildId.length > 0
}

/**
 * Lee `/version.json` del servidor. Nunca lanza: si no hay red, el archivo no
 * existe o tiene otra forma, devuelve null y la app sigue con lo que tiene.
 */
export async function consultarVersionRemota(): Promise<VersionBuild | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j: unknown = await r.json()
    return esVersionBuild(j) ? j : null
  } catch {
    return null
  }
}
