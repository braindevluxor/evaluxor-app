import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Cerrar sesión dejaba la app clavada en el skeleton y sólo un F5 la sacaba de
 * ahí. `RequireAuth` pinta el skeleton mientras `loading || !perfilListo` y
 * recién DESPUÉS redirige a /login, así que mientras ese flag quede apagado no
 * se llega nunca al `<Navigate>`.
 */
describe('salir de la sesión llega al login sin recargar', () => {
  const auth = fuente('./AuthContext.tsx')
  const guards = fuente('../components/guards.tsx')

  it('sin sesión el perfil se da por listo: no hay rol que averiguar ni TOTP que pedir', () => {
    const inicio = auth.indexOf('const procesarSesion')
    const fin = auth.indexOf('useEffect(() => {', inicio)
    const bloque = auth.slice(inicio, fin)
    expect(inicio).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(inicio)
    // Este era el bug: el arranque corre una sola vez, así que nada volvía a
    // encender el flag y el guard se quedaba en el skeleton para siempre.
    expect(bloque).not.toContain('setPerfilListo(false)')
    expect(bloque).toContain('setPerfilListo(true)')
  })

  it('el guard pinta el skeleton antes de redirigir, así que ese flag es el único camino', () => {
    const esqueleto = guards.indexOf('if (loading || !perfilListo)')
    const login = guards.indexOf('return <Navigate to="/login"')
    expect(esqueleto).toBeGreaterThan(-1)
    expect(login).toBeGreaterThan(esqueleto)
  })

  it('al recargar se ve el cargador de cajas (el del login), no un esqueleto', () => {
    // Se pidió que el F5 se sienta como entrar a la app: misma animación, y el
    // fondo pintado por el propio cargador para que siga el tema (pintado en un
    // div sin fondo salía el blanco del navegador con tarjetas oscuras).
    const app = fuente('../App.tsx')
    expect(app).toContain('<CargadorPantalla />')
    expect(app).toContain('loadingFallback={<CargadorPantalla completa />}')
    expect(guards).toContain('<CargadorPantalla completa />')
    expect(guards).not.toContain('SkeletonPantalla')

    const ui = fuente('../components/ui.tsx')
    expect(ui).toContain('export function CargadorPantalla')
    expect(ui).toContain('bg-slate-100 px-4')
    expect(ui).toContain('<Spinner size={44} />')
  })

  it('salir pinta el estado él mismo, sin depender del evento ni de la red', () => {
    const inicio = auth.indexOf('async signOut()')
    const fin = auth.indexOf('async refreshProfile()', inicio)
    const salir = auth.slice(inicio, fin)
    expect(inicio).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(inicio)
    // Sin señal el scope global no se completa: se limpia igual en local.
    expect(salir).toContain("scope: 'local'")
    expect(salir).toContain('setSession(null)')
    expect(salir).toContain('setPerfilListo(true)')
  })
})
