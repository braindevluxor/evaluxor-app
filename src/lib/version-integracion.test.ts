/**
 * Integración del control de versiones. La lógica pura ya está cubierta en
 * `version.test.ts` y `subida.test.ts`; acá se comprueba que las piezas queden
 * enganchadas donde importan (build, service worker, base local, perfil).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const db = fuente('./offline/db.ts')
const restore = fuente('./restore.ts')
const vite = fuente('../../vite.config.ts')
const version = fuente('./version.ts')
const versionCtx = fuente('../context/VersionContext.tsx')
const card = fuente('../components/VersionApp.tsx')

describe('guardado local · higiene al cambiar de versión', () => {
  it('el upgrade de la base nunca borra la cola, los borradores ni las fotos', () => {
    const upgrade = db.slice(db.indexOf('upgrade(db, oldVersion)'), db.indexOf('export async function cerrarDB()'))
    // Solo el catálogo cacheado puede quedar incompatible con el código nuevo.
    expect(upgrade).toContain("db.deleteObjectStore('cache')")
    expect(upgrade).not.toContain("deleteObjectStore('queue')")
    expect(upgrade).not.toContain("deleteObjectStore('drafts')")
    expect(upgrade).not.toContain("deleteObjectStore('photos')")
  })

  it('tiene las piezas que necesita "Restaurar app"', () => {
    expect(db).toContain('export async function cerrarDB()')
    expect(db).toContain('export async function limpiarCacheCatalogo()')
    expect(db).toContain('export async function resumenAlmacenamiento()')
  })
})

describe('restaurar app', () => {
  it('borra service worker, cachés y base local, pero no la sesión', () => {
    expect(restore).toContain('navigator.serviceWorker?.getRegistrations?.()')
    expect(restore).toContain('r.unregister()')
    expect(restore).toContain('caches.delete(k)')
    expect(restore).toContain("indexedDB.deleteDatabase('evaluxor-db')")
    // Cierra la conexión antes de borrar, o el navegador la bloquea.
    expect(restore).toContain('await cerrarDB()')
    // Solo toca claves propias de la app: la sesión de Supabase queda viva.
    expect(restore).toContain('k.startsWith(PREFIJO_PROPIO)')
    expect(restore).not.toContain('localStorage.clear()')
  })

  it('informa si queda trabajo sin subir antes de borrar nada', () => {
    expect(restore).toContain('export async function hayTrabajoSinSubir()')
    expect(restore).toContain('r.cola > 0 || r.borradores > 0')
  })
})

describe('identidad del build', () => {
  it('el build publica su identidad en /version.json y la inyecta en el bundle', () => {
    expect(vite).toContain('__APP_VERSION__: JSON.stringify(build.version)')
    expect(vite).toContain('__BUILD_ID__: JSON.stringify(build.buildId)')
    expect(vite).toContain("fileName: 'version.json'")
    // El id de build ordena por fecha y termina con el commit corto de git.
    expect(vite).toContain('git rev-parse --short HEAD')
  })

  it('el service worker no precachea /version.json (si lo cacheara, nunca se vería el deploy nuevo)', () => {
    const glob = vite.slice(vite.indexOf('globPatterns'), vite.indexOf('navigateFallback'))
    expect(glob).not.toContain('json')
  })

  it('consulta version.json sin caché', () => {
    expect(version).toContain('`/version.json?t=${Date.now()}`')
    expect(version).toContain("cache: 'no-store'")
  })
})

describe('actualización de versión', () => {
  it('solo se actualiza sola si no hay pendientes ni evaluación en curso', () => {
    expect(versionCtx).toContain('pendientes === 0 && !trabajando')
    expect(versionCtx).toContain('esPantallaDeTrabajo(pathname)')
  })

  it('pregunta la versión al abrir, al volver a la app y cada 10 minutos', () => {
    expect(versionCtx).toContain('INTERVALO_CHECQUEO = 10 * 60_000')
    expect(versionCtx).toContain("document.addEventListener('visibilitychange', alVolver)")
  })

  it('limpia el catálogo cacheado antes de recargar, sin tocar borradores ni cola', () => {
    expect(versionCtx).toContain('await limpiarCacheCatalogo()')
    expect(db).toMatch(/export async function limpiarCacheCatalogo\(\)[\s\S]{0,200}delete\('cache', 'data'\)/)
    const limpiar = db.slice(db.indexOf('export async function limpiarCacheCatalogo()'), db.indexOf('export async function resumenAlmacenamiento()'))
    expect(limpiar).not.toContain("delete('drafts'")
    expect(limpiar).not.toContain("delete('queue'")
  })

  it('el perfil muestra la build y el botón de restaurar', () => {
    expect(fuente('../pages/PerfilPage.tsx')).toContain('<TarjetaVersionApp />')
    expect(card).toContain('versionCorta()')
    expect(card).toContain('Restaurar app')
    // Avisa antes de borrar si hay algo sin subir.
    expect(card).toContain('Hay avance guardado en este teléfono que todavía no llegó a la nube')
  })

  it('la presencia anuncia la versión del build de cada dispositivo', () => {
    const presencia = fuente('../context/PresenciaContext.tsx')
    expect(presencia).toContain('version: APP_VERSION')
    expect(presencia).toContain('build_id: BUILD_ID')
  })
})
