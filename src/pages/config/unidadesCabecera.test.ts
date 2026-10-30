import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Unidades: el selector de Sucursales/Departamentos y el botón «+ Nueva»
 * viven en la barra superior de la consola, no en el cuerpo de la vista.
 *
 * Los tres elementos están en archivos distintos (el selector en `Unidades`,
 * el alta en cada pestaña), así que los tres se cuelgan del mismo hueco por
 * portal. Ésta cubre ese cableado: lo que sólo se rompe con un cambio de una
 * línea del fuente, porque montar la pantalla exige router, catálogo y
 * Supabase.
 */
describe('unidades · selector y alta en la barra superior', () => {
  it('el selector de pestañas se cuelga de la cabecera, no del cuerpo', () => {
    const pagina = fuente('./Unidades.tsx')
    expect(pagina).toContain("from '../../components/PortalCabecera'")
    expect(pagina).toContain('<PortalCabecera>')
    // Cada pestaña sigue siendo un botón conmutador, con su icono y su rótulo.
    expect(pagina).toContain("onClick={() => setTab('sucursales')}")
    expect(pagina).toContain("onClick={() => setTab('departamentos')}")
    expect(pagina).toContain('aria-pressed={tab === ')
    // En el teléfono sólo el icono: la barra ya lleva menú, título y «Nueva».
    expect(pagina).toContain('<span className="hidden sm:inline">Sucursales</span>')
    // El título ya lo pinta la cabecera de la consola (`titulosVista`).
    expect(pagina).not.toContain('<h1')
    // Sigue montando una u otra pestaña debajo.
    expect(pagina).toContain('{tab === \'sucursales\' ? <SucursalesPage /> : <DepartamentosPage />}')
  })

  it('cada pestaña lleva su botón de alta al mismo hueco', () => {
    const sucursales = fuente('./Sucursales.tsx')
    expect(sucursales).toContain('<PortalCabecera>')
    expect(sucursales).toContain('title="Nueva sucursal"')
    expect(sucursales).toContain('+ Nueva')
    // Sigue abriendo su propio modal, con su propio formulario.
    expect(sucursales).toContain("setEditando(null); setModal(true)")
    expect(sucursales).toContain("title={editando ? 'Editar sucursal' : 'Nueva sucursal'}")

    const departamentos = fuente('./Departamentos.tsx')
    expect(departamentos).toContain('<PortalCabecera>')
    expect(departamentos).toContain('title="Nuevo departamento"')
    expect(departamentos).toContain('+ Nuevo')
    expect(departamentos).toContain('abrir(null)')
    // La nota que explica qué es un departamento se queda en la página.
    expect(departamentos).toContain('Central no es una')
  })

  it('la barra deja el hueco para TODAS las vistas, no sólo el dashboard', () => {
    const consola = fuente('../../components/layouts/ConsoleLayout.tsx')
    // Sin esta línea el portal de Unidades no encontraría destino y el
    // selector no aparecería en /config/unidades.
    expect(consola).toContain('id="acciones-vista"')
    // El grupo derecho empuja el título a la izquierda con o sin «Filtros».
    expect(consola).toContain('ml-auto flex shrink-0 items-center gap-2')
  })
})
