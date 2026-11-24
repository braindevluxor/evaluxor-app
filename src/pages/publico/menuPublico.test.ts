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

  it('la descripción que escribe el encargado se muestra en la carta', () => {
    expect(pagina).toContain('p.descripcion')
    expect(datos).toContain('descripcion: string | null')
  })

  it('las categorías del encargado se pegan como pestañas', () => {
    // Botones que filtran —sin campos— y la pestaña de los que no tienen
    // categoría.
    expect(pagina).toContain('setCategoriaActiva')
    expect(pagina).toContain("const SIN_CATEGORIA = 'Otros'")
    expect(pagina).toContain('<button')
  })

  it('la carta filtra por el turno del momento y lo dice en la cabecera', () => {
    // La RPC manda el turno del momento (hora de Venezuela) y cada
    // producto sus letras…
    expect(datos).toContain('turno: string')
    expect(datos).toContain('turnos: string')
    // …la lista y las pestañas salen de lo disponible en ESTE turno…
    expect(pagina).toContain('disponibles')
    expect(pagina).toContain('p.turnos')
    // …el chip de cabecera lo dice…
    expect(pagina).toContain('Ahora: {infoTurno.nombre}')
    // …y si no queda nada en el horario, un aviso con el horario en vez
    // de una carta que parezca rota.
    expect(pagina).toContain('No hay productos en este horario')
  })

  it('cuenta su apertura para el reporte del editor', () => {
    expect(pagina).toContain('registrarVisita')
    expect(datos).toContain("supabase.rpc('registrar_visita_menu'")
    // Una por hora por navegador: refrescar no infla el contador.
    expect(datos).toContain('localStorage')
  })

  it('la cabecera es mínima: logo y botón para elegir sucursal', () => {
    // El botón abre el selector, que navega a /menu/:id…
    expect(pagina).toContain('Seleccionar sucursal')
    expect(pagina).toContain('sucursalesPublicas')
    expect(datos).toContain("supabase.rpc('ver_sucursales_menu'")
    // …la tapa vieja (antetillo, nombre grande y rombo) se fue…
    expect(pagina).not.toContain('function Rombo')
    // …y el h1 sigue existiendo invisible, para el lector de pantalla.
    expect(pagina).toContain('sr-only')
  })
})
