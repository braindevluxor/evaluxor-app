import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * El editor del menú: la ruta es de Líder o Gerente de Sucursal, pero el
 * Gerente la abre en SÓLO LECTURA —quien altera la carta es el Líder, y la
 * RLS (`menu_productos_gestion`, `menu_fotos_encargado`) lo dice desde la
 * base—; el módulo de datos escribe en la tabla y sube fotos convertidas,
 * y la pantalla hace lo que pide el Líder: escanear, agregar, reordenar y
 * fotografiar.
 */
function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const pagina = fuente('./MenuEditor.tsx')
const app = fuente('../App.tsx')
const consola = fuente('../components/layouts/ConsoleLayout.tsx')
const datos = fuente('../lib/data/menuSucursal.ts')
const componente = fuente('../components/VisitasMenu.tsx')

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

  it('el Gerente de Sucursal entra en SÓLO LECTURA', () => {
    // La pantalla sabe quién es: el que no es Líder no altera nada.
    expect(pagina).toContain('const soloLectura = !esLider')
    expect(pagina).toContain('Vista de sólo lectura: el menú lo carga y lo modifica el Líder.')
    // Sin escaneo (no hay a dónde agregar), sin importar y sin las
    // acciones por fila: reordenar, fotografiar y quitar no existen.
    expect(pagina).toContain('{soloLectura ? null : (')
    expect(pagina).toContain('if (soloLectura)')
    // Lo que SÍ se mira se pinta como texto, no como campo editable.
    expect(pagina).toContain('Descripción:</span>')
    expect(pagina).toContain('Categoría:</span>')
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

  it('la categoría organiza la carta y la escribe el encargado', () => {
    // El upsert la trae al agregar…
    expect(datos).toContain('categoria: categoria.trim() || null')
    // …y se mueve por renglón, como la descripción.
    expect(datos).toContain('export async function guardarCategoria')
    expect(pagina).toContain('Categoría de la carta (ej. Entradas)')
    expect(pagina).toContain('list="categorias-menu"')
  })

  it('los TURNOS se marcan con un toque y no se pueden dejar vacíos', () => {
    // M, T y N como botones (aria-pressed) con su horario en el title: la
    // carta pública sólo muestra el producto si le toca en esa hora.
    expect(pagina).toContain('marcarTurno')
    expect(pagina).toContain('aria-pressed')
    expect(pagina).toContain('title={`${t.nombre} · ${t.horario}`}')
    // La cadena se arma canónica (orden M, T, sin repetir) y SIN letras no
    // se guarda: el producto se escondería de toda la carta.
    expect(datos).toContain('export function turnosDe')
    expect(datos).toContain('export async function guardarTurnos')
    expect(datos).toContain('El producto necesita al menos un turno disponible.')
    // Al agregar, el producto nace para todo el día (default de la columna).
    expect(datos).toContain('nace en \'MTN\'')
  })

  it('la carta se importa desde un Excel con ID, comentario y configuración', () => {
    // El archivo se lee, se CONFIRMA lo destructivo y recién ahí se corre.
    expect(datos).toContain('export async function leerFilasMenuExcel')
    expect(datos).toContain('export async function importarMenuExcel')
    expect(pagina).toContain('leerFilasMenuExcel')
    expect(pagina).toContain('Importar desde Excel')
    expect(pagina).toContain('accept=".xlsx"')
    // El botón está en la BARRA y todo el flujo vive en un modal: las
    // instrucciones, la plantilla, el archivo, el avance y el resumen.
    expect(pagina).toContain('setImportAbierto(true)')
    expect(pagina).toContain('title="Importar desde Excel"')
    expect(pagina).toContain('Las tres columnas')
    expect(pagina).toContain('Qué hace con el menú actual')
    // La plantilla baja desde public/ con los mismos encabezados que lee
    // el importador (los verifica plantillaMenu.test.ts contra el archivo).
    expect(pagina).toContain('href="/plantilla-menu.xlsx"')
    expect(pagina).toContain('Descargar plantilla')
    expect(pagina).toContain('ProgressBar')
    // La pregunta exacta, con la salida que NO borra nada.
    expect(pagina).toContain(
      '¿Desea crear lo que no existe, actualizar lo que existe y eliminar lo que no esté en el archivo de importación?'
    )
    expect(pagina).toContain('Sólo crear y actualizar')
    // Lo que no está en el archivo se da de BAJA, nunca se borra: la fila
    // y su foto sobreviven para la próxima selección (mismo criterio que
    // el botón de quitar).
    expect(datos).toContain('update({ activo: false })')
    expect(datos).not.toContain(".from('menu_productos').delete(")
    // Lo que la API de precios no conoce se salta y se lista al final.
    expect(datos).toContain('noEncontrados.push(id)')
    // Y las bajas van AL FINAL: si la consulta falla, no se elimina nada.
    expect(datos).toContain('LAS BAJAS, al final')
  })

  it('las visitas son un modal: la curva de 7 días y el detalle por hora al elegir uno', () => {
    // El reporte vive en SU componente: el botón se cuelga de la BARRA de
    // la consola y el pedido lo hace el modal recién al abrirse.
    expect(pagina).toContain('VisitasMenu')
    expect(componente).toContain('PortalCabecera')
    expect(componente).toContain('Ver visitas')
    expect(componente).toContain('Visitas al menú')
    expect(componente).toContain('Últimos 7 días · hora de Venezuela')
    expect(componente).toContain('if (!abierto || !sucursalId || visitas !== null) return')
    // La curva: una línea con un punto por día…
    expect(componente).toContain('<Line')
    // …y el clic en un día —punto de la curva o chip— abre sus 24 horas
    // en barras, con las horas futuras de hoy atenuadas.
    expect(componente).toContain('setDia')
    expect(componente).toContain('<Bar')
    expect(componente).toContain('futuro: esHoy && h > horaAhora')
    // El dato sigue saliendo de la RPC de siempre.
    expect(datos).toContain("supabase.rpc('ver_visitas_menu'")
  })
})
