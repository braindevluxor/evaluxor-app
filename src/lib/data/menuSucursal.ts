import { convertirImagenAWebP } from '../convertirMedia'
import { precioVentaPvp } from '../scoring'
import { buscarProducto, type ResultadoScan } from './precios'
import { supabase } from '../supabase'

/**
 * EL MENÚ DE CADA SUCURSAL
 * ------------------------
 * Cada sucursal tiene su menú y un encargado que lo llena: el Gerente de
 * Sucursal (el `profiles.sucursal_id` ES "su" sucursal — la misma invitación
 * que le da el rol ya le asigna la tienda) o el Líder, que puede con
 * cualquier tienda (la misma cerradura de todo el repo, ahora
 * `es_encargado_menu` en RLS).
 *
 * Acá se escribe con la sesión de la consola:
 *
 *  - Buscar: la API de precios (`precios.ts`) por ID o código de barra, con
 *    el `shop_id` de la sucursal. La API sólo tiene scan —no hay búsqueda
 *    por nombre—, que es justo lo que pide el encargado: escanear o pegar.
 *  - Guardar: la tabla `menu_productos`, con RLS (`es_encargado_menu`).
 *  - Fotos: bucket `menu-fotos`, PÚBLICO (la página de clientes lo ve sin
 *    sesión, igual que `gran-cosecha`), ruta `menu/<sucursal>/<sku>` — un
 *    encargado no mete manos en la carpeta de otra tienda. La imagen se
 *    CONVIERTE a WebP a resolución natural antes de subir (ver
 *    `convertirMedia`).
 *
 * Lo que lee la página pública vive en `cargarMenuPublico`: una sola RPC
 * sin sesión (`ver_menu_publico`), nunca la tabla.
 */

/** Un renglón del menú, tal como lo guarda y lo devuelve la base. */
export interface ProductoMenu {
  id: string
  sku: string
  /** El `id` del producto en la API, cuando vino en la respuesta. */
  productoId: string | null
  nombre: string
  /** Texto que escribe el encargado para la carta (opcional). */
  descripcion: string | null
  /** PVP: finalBase + finalTax (la base ya descontada más el impuesto). */
  precio: number | null
  departamento: string | null
  fotoUrl: string | null
  orden: number
}

/** Lo que devuelve `ver_menu_publico` para la página de clientes. */
export interface MenuPublicoDatos {
  sucursal: { nombre: string } | null
  productos: {
    nombre: string
    descripcion: string | null
    precio: number | null
    departamento: string | null
    foto: string | null
  }[]
}

/** Sucursal del selector del Líder (con el shop ID que pide la API). */
export interface SucursalMenu {
  id: string
  nombre: string
  shopId: string | null
}

const BUCKET = 'menu-fotos'

/** ¿Es un UUID? Para no mandar cualquier texto de la URL a la RPC. */
export function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)
}

/**
 * PVP del producto para el menú: `precioVentaPvp` de scoring, que es el que
 * usa toda la app —finalBase ya descontada + impuesto—. Sin finalBase no hay
 * PVP (devuelve null y el menú muestra el producto sin precio).
 */
export function precioDeMenu(r: ResultadoScan): number | null {
  return precioVentaPvp({ finalBase: r.finalBase ?? null, finalTax: r.finalTax ?? null })
}

/** El menú PUBLICADO de una sucursal, con sesión: lo carga el editor. */
export async function cargarMenu(sucursalId: string): Promise<ProductoMenu[]> {
  const { data, error } = await supabase
    .from('menu_productos')
    .select(
      'id, sku, productoId:producto_id, nombre, descripcion, precio, departamento, fotoUrl:foto_url, orden'
    )
    .eq('sucursal_id', sucursalId)
    // Los dados de baja quedan fuera: siguen en la base (con su foto) para
    // que una futura selección del mismo SKU los reviva.
    .eq('activo', true)
    .order('orden')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as ProductoMenu[]
}

/**
 * Agrega un producto al menú; si el SKU ya estaba —activo o dado de baja—,
 * se ACTUALIZA: nombre, precio y departamento al día de la API y
 * `activo: true`, lo que REVIVE la fila anterior… y con ella su foto y su
 * descripción: por eso quitar un producto no borra nada, sólo lo apaga
 * (ver `quitarProducto`). El orden lo manda el renglón más alto + 1.
 */
export async function agregarProducto(
  sucursalId: string,
  sku: string,
  r: ResultadoScan
): Promise<void> {
  if (!r.nombre) {
    throw new Error(r.mensaje ?? 'El producto no se encontró en la API de precios.')
  }
  const { data: ultimo, error: e1 } = await supabase
    .from('menu_productos')
    .select('orden')
    .eq('sucursal_id', sucursalId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (e1) throw e1

  const { error } = await supabase.from('menu_productos').upsert(
    {
      sucursal_id: sucursalId,
      sku,
      producto_id: r.id !== undefined ? String(r.id) : null,
      nombre: r.nombre,
      precio: precioDeMenu(r),
      departamento: r.departamento ?? null,
      activo: true,
      orden: ((ultimo as { orden: number } | null)?.orden ?? 0) + 1
    },
    { onConflict: 'sucursal_id,sku' }
  )
  if (error) throw error
}

/**
 * Da de baja el producto del menú SIN borrar la fila: la foto y la
 * descripción que ya se cargaron quedan guardadas para la PRÓXIMA selección
 * de ese SKU —al re-agregarlo, `agregarProducto` la reactiva con todo
 * adentro—. La página pública no lo muestra (`activo` lo filtra la RPC).
 */
export async function quitarProducto(id: string): Promise<void> {
  const { error } = await supabase.from('menu_productos').update({ activo: false }).eq('id', id)
  if (error) throw error
}

/** La descripción que escribe el encargado para su carta. */
export async function guardarDescripcion(id: string, descripcion: string): Promise<void> {
  const { error } = await supabase
    .from('menu_productos')
    .update({ descripcion: descripcion.trim() || null })
    .eq('id', id)
  if (error) throw error
}

/**
 * Reordena todo el menú con UNA llamada: sólo toca `orden`, así que un
 * upsert parcial por id no pisa ningún otro campo.
 */
export async function reordenarMenu(productos: ProductoMenu[]): Promise<void> {
  const { error } = await supabase
    .from('menu_productos')
    .upsert(
      productos.map((p, i) => ({ id: p.id, orden: i })),
      { onConflict: 'id' }
    )
  if (error) throw error
}

/**
 * Sube la foto del producto y la anota en su renglón: WebP a resolución
 * natural (el criterio del repo) y la ruta por sucursal + SKU — el mismo
 * SKU reemplaza su foto, no acumula copias. El `?v=` rompe la caché del
 * CDN cuando se cambia la foto.
 */
export async function subirFotoMenu(
  sucursalId: string,
  sku: string,
  archivo: File
): Promise<string> {
  const webp = await convertirImagenAWebP(archivo)
  const ruta = `menu/${sucursalId}/${sku.replace(/[^A-Za-z0-9._-]/g, '_')}.webp`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, webp, { contentType: 'image/webp', upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
  const url = `${data.publicUrl}?v=${Date.now()}`
  const { error: e2 } = await supabase
    .from('menu_productos')
    .update({ foto_url: url })
    .eq('sucursal_id', sucursalId)
    .eq('sku', sku)
  if (e2) throw e2
  return url
}

/** Las sucursales activas: de donde elige el Líder y dónde busca su shop ID. */
export async function sucursalesActivas(): Promise<SucursalMenu[]> {
  const { data, error } = await supabase
    .from('sucursales')
    .select('id, nombre, shop_id')
    .eq('activa', true)
    .order('nombre')
  if (error) throw error
  return ((data ?? []) as { id: string; nombre: string; shop_id: string | null }[]).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    shopId: s.shop_id
  }))
}

/**
 * La página pública: una sola llamada SIN sesión. Sucursal inexistente o
 * inactiva viene con `sucursal: null` — la RPC no filtra ni expone nada
 * que la propia página no muestre a cualquiera.
 */
export async function cargarMenuPublico(sucursalId: string): Promise<MenuPublicoDatos> {
  const { data, error } = await supabase.rpc('ver_menu_publico', { p_sucursal: sucursalId })
  if (error) throw error
  return (data ?? { sucursal: null, productos: [] }) as MenuPublicoDatos
}

/** La misma búsqueda que usa la conciliación: scan por ID o código de barra. */
export { buscarProducto }
