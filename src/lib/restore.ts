/**
 * "Restaurar app": la salida de emergencia para un teléfono que quedó trabado con
 * una versión vieja cacheada (pantalla de "revisá la conexión" con internet, o
 * pantallas en blanco).
 *
 * Borra service worker, cachés y base local, y recarga. La sesión de Supabase se
 * respeta a propósito: quien lo usa no debería tener que volver a loguearse.
 * Antes de borrar hay que avisar cuántas cosas quedan sin subir, porque los
 * borradores y la cola son el único lugar donde vive el avance no sincronizado.
 */

import { cerrarDB, resumenAlmacenamiento } from './offline/db'

const PREFIJO_PROPIO = 'evaluxor.'

export interface ResumenAlmacenamiento {
  borradores: number
  cola: number
  fotos: number
  /** Incidencias reportadas que todavía no llegaron al servidor. */
  incidentes: number
  /** Revisiones pre-entrega todavía sin subir. */
  preentregas: number
}

/** Lo que hay en el dispositivo ahora mismo (para la pantalla de confirmación). */
export function resumenLocal(): Promise<ResumenAlmacenamiento> {
  return resumenAlmacenamiento()
}

/** ¿Quedó algo sin subir a la nube? (borradores, cola, incidencias o revisiones) */
export async function hayTrabajoSinSubir(): Promise<boolean> {
  const r = await resumenAlmacenamiento()
  return r.cola > 0 || r.borradores > 0 || r.incidentes > 0 || r.preentregas > 0
}

export interface ResultadoRestore {
  caches: number
  workers: number
  claves: number
}

/**
 * Deja el dispositivo como recién instalado: borra cachés del service worker,
 * desregistra los workers, elimina la base local y limpia las claves propias de
 * la app (perfil cacheado, id de dispositivo). NO toca la sesión de Supabase.
 */
export async function restaurarApp(): Promise<ResultadoRestore> {
  // 1. Cerrar la base antes de borrarla: con una conexión abierta, el navegador
  //    bloquea `deleteDatabase` y la app queda igual.
  await cerrarDB()

  // 2. Cachés del service worker (precache de la build anterior).
  let cachesBorradas = 0
  if (typeof caches !== 'undefined') {
    try {
      const claves = await caches.keys()
      await Promise.all(claves.map((k) => caches.delete(k)))
      cachesBorradas = claves.length
    } catch {
      // Sin Permissions API de storage: se sigue igual.
    }
  }

  // 3. Service workers: la app tiene que volver a registrar el nuevo.
  let workers = 0
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    if (regs?.length) {
      await Promise.all(regs.map((r) => r.unregister()))
      workers = regs.length
    }
  } catch {
    // Sin soporte de service worker: nada que desregistrar.
  }

  // 4. Base local completa (catálogo, borradores, fotos y cola).
  await borrarBaseLocal()

  // 5. Claves propias en localStorage. La sesión de Supabase vive con prefijo
  //    `sb-`, así que nunca se toca.
  let claves = 0
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIJO_PROPIO)) {
        localStorage.removeItem(k)
        claves++
      }
    }
  } catch {
    // localStorage bloqueado: no es motivo para cortar la restauración.
  }

  return { caches: cachesBorradas, workers, claves }
}

/** Borra la base local esperando a que termine. */
export function borrarBaseLocal(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase('evaluxor-db')
      req.onsuccess = () => resolve()
      // Si algo la tiene abierta, se reintenta una vez y se sigue igual.
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Recarga la app pidiendo la versión fresca (agrega el parámetro al service worker). */
export function recargarApp(): void {
  window.location.reload()
}
