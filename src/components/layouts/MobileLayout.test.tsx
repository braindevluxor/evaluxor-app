import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VersionEnMenu } from './MobileLayout'
import { APP_VERSION, versionCorta } from '../../lib/version'

// Los tres contextos que consume el layout, resueltos a mano: acá se prueba el
// render del menú, no la lógica de cada proveedor.
const mocks = vi.hoisted(() => ({
  version: {
    hayActualizacion: false,
    versionRemota: null as { version: string } | null,
    actualizando: false,
    actualizarAhora: async () => undefined
  }
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { nombre: 'Ana' }, signOut: () => undefined })
}))
vi.mock('../../context/OfflineContext', () => ({
  useOffline: () => ({ online: true, pendientes: 0, sincronizando: false, ultimoResultado: null, sync: async () => ({ ok: 0, fail: 0 }) })
}))
vi.mock('../../context/VersionContext', () => ({ useVersion: () => mocks.version }))

function menu(): string {
  return renderToStaticMarkup(<VersionEnMenu />)
}

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('menú lateral · versión de la app', () => {
  it('muestra la build en el panel de menú, sin obligar a ir a Perfil', () => {
    mocks.version.hayActualizacion = false
    mocks.version.versionRemota = null
    const html = menu()
    // La línea tiene que llevar la versión y el build de esta compilación.
    expect(html).toContain(APP_VERSION)
    expect(html).toContain(versionCorta())
    expect(html).toContain('font-mono')
    expect(html).not.toContain('Actualizar a')
  })

  it('ofrece actualizarse desde el menú cuando hay versión nueva', () => {
    mocks.version.hayActualizacion = true
    mocks.version.versionRemota = { version: '0.3.0' }
    const html = menu()
    expect(html).toContain('Actualizar a 0.3.0')
    mocks.version.hayActualizacion = false
    mocks.version.versionRemota = null
  })

  it('está montado en el panel del menú, arriba de "Cerrar sesión"', () => {
    const src = fuente('./MobileLayout.tsx')
    const menu = src.slice(src.indexOf('<aside'), src.indexOf('</aside>'))
    expect(menu).toContain('<VersionEnMenu />')
    expect(menu.indexOf('<VersionEnMenu />')).toBeLessThan(menu.indexOf('Cerrar sesión'))
  })
})
