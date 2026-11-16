import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * El editor del menú: la ruta es de Líder o Gerente de Sucursal (la misma
 * cerradura que RLS), el módulo de datos escribe en la tabla y sube fotos
 * convertidas, y la pantalla hace lo que pide el encargado: escanear,
 * agregar, reordenar y fotografiar.
 */
function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const pagina = fuente('./MenuEditor.tsx')
const app = fuente('../App.tsx')
const consola = fuente('../components/layouts/ConsoleLayout.tsx')
const datos = fuente('../lib/data/menuSucursal.ts')

describe('editor del menú · rutas y consola', () => {
  it('la ruta pide Líder o Gerente de Sucursal, con su guard', () => {
    expect(app).toMatch(/path="\/menu-editor"[\s\S]{0,200}roles={\['LIDER', 'GERENTE_S'\]}/)
  })

  it('aparece en el menú de la consola y tiene su título', () => {
    // El Líder lo ve en «Gestión» y el encargado en «Mi sucursal».
    expect(consola).toContain("to: '/menu-editor'")
    expect(consola).toContain("'/menu-editor': {")
    expect(consola).toContain('Menú de la sucursal')
  })
})

describe('editor del menú · el módulo de datos', () => {
  it('busca en la API de precios y guarda en la tabla', () => {
    expect(datos).toContain('buscarProducto')
    expect(datos).toContain(".from('menu_productos')")
    // Sólo la página pública pasa por RPC; el editor lee con sesión.
    expect(datos).toContain("supabase.rpc('ver_menu_publico'")
    // El precio es el PVP del repo (finalBase + finalTax), no una suma a mano.
    expect(datos).toContain('precioVentaPvp')
  })

  it('las fotos suben convertidas al bucket público, por sucursal y SKU', () => {
    expect(datos).toContain("const BUCKET = 'menu-fotos'")
    expect(datos).toContain('convertirImagenAWebP')
    // La ruta ES la sucursal: con eso RLS acota al encargado a su tienda.
    expect(datos).toContain('`menu/${sucursalId}/')
  })
})

describe('editor del menú · la pantalla', () => {
  it('hace todo lo que pide el encargado', () => {
    // Buscar por escaneo o ID contra la API…
    expect(pagina).toContain('Código de barra o ID del producto')
    expect(pagina).toContain('buscarProducto')
    // …agregar, reordenar, quitar y fotografiar.
    expect(pagina).toContain('agregarProducto')
    expect(pagina).toContain('reordenarMenu')
    expect(pagina).toContain('subirFotoMenu')
    expect(pagina).toContain('quitarProducto')
    expect(pagina).toContain('accept="image/*"')
  })

  it('explica los dos frenos: sin sucursal y sin shop ID', () => {
    expect(pagina).toContain('Tu perfil no tiene una sucursal asignada.')
    expect(pagina).toContain('shop ID) configurado')
  })

  it('el Líder elige la sucursal y el encargado ve la suya', () => {
    expect(pagina).toContain('esLider')
    expect(pagina).toContain('sucursalPropia')
    // Y desde ahí se salta al menú público de clientes.
    expect(pagina).toContain('Ver menú público')
  })

  it('la descripción se escribe en la carta y se guarda al salir del campo', () => {
    expect(pagina).toContain('Descripción para la carta (opcional)')
    expect(pagina).toContain('guardarDescripcion')
    expect(pagina).toContain('onBlur')
  })

  it('las fotos perduran: quitar es una baja, no un borrado', () => {
    // quitarProducto APAGA la fila (y su foto) en vez de borrarla…
    expect(datos).toContain('update({ activo: false })')
    expect(datos).not.toContain(".from('menu_productos').delete(")
    // …cargarMenu sólo lista las activas…
    expect(datos).toContain(".eq('activo', true)")
    // …y re-agregar el mismo SKU la revive con todo adentro: el upsert
    // trae activo: true y no menciona foto_url (que por eso perdura).
    expect(datos).toContain('activo: true')
    expect(datos).toContain('export async function guardarDescripcion')
  })
})
