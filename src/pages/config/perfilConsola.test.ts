import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * La cuenta se configura DESDE la consola.
 *
 * `/perfil` vivía suelto, fuera del layout: se veía sin barra superior ni
 * menú lateral, y —al no tener la página fondo propio— se pintaba sobre el
 * fondo del documento. En modo oscuro ese fondo quedaba claro (ver el test de
 * `tema.test.ts` sobre `html.dark`) y la pantalla salía ilegible.
 *
 * Montar la pantalla exige router, auth y Supabase, así que ésta cubre lo que
 * sólo se rompe con un cambio de una línea del fuente.
 */
describe('configuración de la cuenta · vive dentro de la consola', () => {
  const app = fuente('../../App.tsx')
  const consola = fuente('../../components/layouts/ConsoleLayout.tsx')
  const pagina = fuente('../PerfilPage.tsx')

  it('la ruta está dentro del grupo que renderiza ConsoleLayout', () => {
    // El grupo es el `<Route element={…<ConsoleLayout />…}>`; todo lo que está
    // adentro se ve con barra y menú. Si la ruta se mueve afuera, la pantalla
    // vuelve a salir pelada.
    const grupo = app.indexOf('<ConsoleLayout />')
    const perfil = app.indexOf('<Route path="/perfil"')
    expect(grupo).toBeGreaterThan(-1)
    expect(perfil).toBeGreaterThan(grupo)
    // Y sin `RequireRol`: es la cuenta de cualquiera que haya entrado, y
    // `RequireAuth` ya lo pone el propio grupo.
    expect(app).toContain('<Route path="/perfil" element={<PerfilPage />} />')
  })

  it('la cabecera de la consola trae el título, y la página ya no lo repite', () => {
    expect(consola).toContain("'/perfil': { titulo: 'Configuración'")
    expect(consola).toContain('Administra tus datos personales y la seguridad de tu cuenta')
    // Título y «Volver» duplicados: los pone la barra, no la página.
    expect(pagina).not.toContain('← Volver')
    expect(pagina).not.toContain('<h1')
    // Tampoco padding ni ancho propio: ya los trae el `<main>` del layout.
    expect(pagina).not.toContain('max-w-5xl px-4 py-6')
  })
})
