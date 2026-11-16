import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * El menú de clientes: una pantalla pública que lee por RPC y no trae ni un
 * control de edición — lo que se ve lo cargó el encargado desde la consola.
 */
function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const pagina = fuente('./MenuPublico.tsx')
const app = fuente('../../App.tsx')
const datos = fuente('../../lib/data/menuSucursal.ts')

describe('menú público · la ruta', () => {
  it('está fuera de RequireAuth: es el QR que escanea el cliente', () => {
    // La línea entera, sin envoltorio de sesión: la autorización es la RPC.
    expect(app).toContain('path="/menu/:sucursalId" element={<MenuPublico />}')
  })

  it('lee por la RPC pública y no por la tabla', () => {
    expect(datos).toContain("supabase.rpc('ver_menu_publico'")
    // El uuid de la URL se valida antes de mandarlo a la RPC.
    expect(datos).toContain('export function esUuid')
    expect(pagina).toContain('esUuid(sucursalId)')
  })
})

describe('menú público · la pantalla', () => {
  it('no trae controles de edición', () => {
    expect(pagina).not.toContain('<input')
    expect(pagina).not.toContain('<select')
    expect(pagina).not.toContain('<textarea')
  })

  it('usa la identidad corporativa de Supermercados Luxor', () => {
    expect(pagina).toContain('/supermercados-luxor.png')
    // Navy, amarillo y rojo de la marca.
    expect(pagina).toContain('#0a1e5e')
    expect(pagina).toContain('#facc15')
    expect(pagina).toContain('#dc2626')
  })

  it('maneja sus cuatro estados: cargando, no existe, falla y vacío', () => {
    expect(pagina).toContain("'cargando'")
    expect(pagina).toContain("'no-existe'")
    expect(pagina).toContain("'fallo'")
    expect(pagina).toContain('Este menú no existe')
    expect(pagina).toContain('Este menú todavía no tiene productos')
    expect(pagina).toContain('Reintentar')
  })

  it('el precio sale del PVP de siempre (formatearPrecioBase)', () => {
    expect(pagina).toContain('formatearPrecioBase')
  })
})
