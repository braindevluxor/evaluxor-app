import readXlsxFile from 'read-excel-file/browser'
import { convertirImagenAWebP } from '../convertirMedia'
import { precioVentaPvp } from '../scoring'
import { buscarProducto, type ResultadoScan } from './precios'
import { supabase } from '../supabase'

/**
 * EL MENÚ DE CADA SUCURSAL
 * ------------------------
 * Cada sucursal tiene su menú. Quien lo VE es el Gerente de Sucursal (el
 * `profiles.sucursal_id` ES "su" sucursal — la misma invitación que le da
 * el rol ya le asigna la tienda) o el Líder, que puede ver cualquier tienda;
 * quien lo ALTERA es SÓLO el Líder (`es_encargado_menu` abre la lectura,
 * `menu_productos_gestion` y `menu_fotos_encargado` la escritura). El
 * Gerente de Sucursal entra en sólo lectura y esta pantalla esconde los
 * controles para que no haya un botón que RLS rechace.
 *
 * Acá se escribe con la sesión de la consola:
 *
 *  - Buscar: la API de precios (`precios.ts`) por ID o código de barra, con
 *    el `shop_id` de la sucursal. La API sólo tiene scan —no hay búsqueda
 *    por nombre—, que es justo lo que pide el Líder: escanear o pegar.
 *  - Guardar: la tabla `menu_productos`, con RLS (escritura del Líder).
 *  - Fotos: bucket `menu-fotos`, PÚBLICO (la página de clientes lo ve sin
 *    sesión, igual que `gran-cosecha`), ruta `menu/<sucursal>/<sku>`. La
 *    imagen se CONVIERTE a WebP a resolución natural antes de subir (ver
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
  /** La pestaña de la carta donde cae (ej. "Entradas"); opcional. */
  categoria: string | null
  /** PVP: finalBase + finalTax (la base ya descontada más el impuesto). */
  precio: number | null
  departamento: string | null
  fotoUrl: string | null
  orden: number
  /**
   * Los TURNOS en los que está disponible: letras en el orden M, T, N —
   * 'MTN' (todo el día, con lo que nacen las filas ya cargadas), 'TN',
   * 'M'… La carta pública sólo muestra el producto si su cadena contiene
   * el turno del momento (ver `ver_menu_publico`).
   */
  turnos: string
}

/** Los tres turnos de la carta, en el orden en que se pintan. */
export interface TurnoInfo {
  letra: 'M' | 'T' | 'N'
  nombre: string
  /** El horario que cubre, en hora de Venezuela. */
  horario: string
}

export const TURNOS: TurnoInfo[] = [
  { letra: 'M', nombre: 'Mañana', horario: '06:00 a 11:59' },
  { letra: 'T', nombre: 'Tarde', horario: '12:00 a 17:59' },
  { letra: 'N', nombre: 'Noche', horario: '18:00 a 05:59' }
]

/** Lo que devuelve `ver_menu_publico` para la página de clientes. */
export interface MenuPublicoDatos {
  /**
   * El turno del momento según la hora de VENEZUELA (lo calcula la base,
   * no el reloj del celular): 'M', 'T' o 'N'. La página filtra con él.
   */
  turno: string
  sucursal: { nombre: string } | null
  productos: {
    nombre: string
    descripcion: string | null
    categoria: string | null
    precio: number | null
    departamento: string | null
    foto: string | null
    /** Las letras de los turnos en los que aparece ('MTN' = todo el día). */
    turnos: string
  }[]
}

/** Una hora con visitas, tal como la devuelve `ver_visitas_menu`. */
export interface VisitaPorHora {
  /** Día en la zona de la empresa, 'YYYY-MM-DD'. */
  fecha: string
  /** 0 a 23, hora de Caracas. */
  hora: number
  visitas: number
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
      'id, sku, productoId:producto_id, nombre, descripcion, categoria, precio, departamento, fotoUrl:foto_url, orden, turnos'
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
  r: ResultadoScan,
  categoria: string
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
      // Sin `descripcion` acá a propósito: en una fila NUEVA nace en null y
      // en una EXISTENTE (re-selección) conserva lo que ya se escribió.
      // Lo MISMO con `turnos`: una fila NUEVA nace en 'MTN' (todo el día,
      // el default de la columna) y una EXISTENTE conserva sus marcas.
      categoria: categoria.trim() || null,
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

/** La categoría (pestaña) a la que mueve el encargado el producto. */
export async function guardarCategoria(id: string, categoria: string): Promise<void> {
  const { error } = await supabase
    .from('menu_productos')
    .update({ categoria: categoria.trim() || null })
    .eq('id', id)
  if (error) throw error
}

/**
 * La cadena de turnos a partir de las letras que el encargado marcó:
 * SIEMPRE en el orden M, T, N y sin repetir — la forma canónica que
 * acepta el `check` de la tabla (`^M?T?N?$`).
 *
 * Sin letras tira error: un producto sin turnos no aparecería en ninguna
 * parte de la carta, que es peor que no haberlo cargado.
 */
export function turnosDe(letras: Iterable<string>): string {
  const set = new Set([...letras].filter((c) => 'MTN'.includes(c)))
  const cadena = TURNOS.filter((t) => set.has(t.letra)).map((t) => t.letra).join('')
  if (!cadena) throw new Error('El producto necesita al menos un turno disponible.')
  return cadena
}

/**
 * Los TURNOS en los que el producto está disponible, por renglón — igual
 * que la descripción y la categoría. El que filtra la carta pública es
 * `ver_menu_publico` con la hora de Venezuela; acá sólo se guarda lo que
 * el encargado marcó.
 */
export async function guardarTurnos(id: string, turnos: string): Promise<void> {
  const { error } = await supabase
    .from('menu_productos')
    .update({ turnos: turnosDe(turnos) })
    .eq('id', id)
  if (error) throw error
}

/**
 * Cuenta la apertura de la página pública: UNA por hora por navegador
 * (localStorage), así que un refresco no infla el contador. Se registra
 * DESPUÉS de contar bien, así que si falla la próxima visita reintenta.
 * Lo que mide la base son aperturas, no usuarios únicos — y si falla, la
 * carta no se cae: el contador nunca es motivo de error para el cliente.
 */
export async function registrarVisita(sucursalId: string): Promise<void> {
  const ahora = new Date()
  const hora = `${ahora.getFullYear()}-${ahora.getMonth() + 1}-${ahora.getDate()}-${ahora.getHours()}`
  const clave = `evaluxor:menu-visita:${sucursalId}:${hora}`
  try {
    if (localStorage.getItem(clave)) return
    const { error } = await supabase.rpc('registrar_visita_menu', { p_sucursal: sucursalId })
    if (error) return
    localStorage.setItem(clave, '1')
  } catch {
    // Sin storage o sin red: el contador se saltea, la carta sigue.
  }
}

/**
 * Las aperturas por día y por hora (hora de Caracas) entre dos fechas
 * 'YYYY-MM-DD'. Sólo con sesión y sólo del encargado de esa sucursal o el
 * Líder — sin permiso la RPC devuelve lista vacía.
 */
export async function visitasMenu(
  sucursalId: string,
  desde: string,
  hasta: string
): Promise<VisitaPorHora[]> {
  const { data, error } = await supabase.rpc('ver_visitas_menu', {
    p_sucursal: sucursalId,
    p_desde: desde,
    p_hasta: hasta
  })
  if (error) throw error
  return (data ?? []) as VisitaPorHora[]
}

/**
 * Las sucursales activas (id + nombre) para el selector de la cabecera
 * pública: cambiar de tienda sin un QR nuevo. RPC sin sesión — la lista
 * sólo expone lo que un cliente necesita para elegir.
 */
export async function sucursalesPublicas(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase.rpc('ver_sucursales_menu')
  if (error) throw error
  return (data ?? []) as { id: string; nombre: string }[]
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

/* ==========================================================================
 * IMPORTAR LA CARTA DESDE UN ARCHIVO EXCEL
 * ========================================================================= */

/**
 * Una fila del archivo de importación: las TRES columnas que pide la hoja
 * —ID del producto, comentario y configuración— tal como vienen en la celda.
 */
export interface FilaImportMenu {
  /** El ID / código de barra: se busca en la API y queda como SKU. */
  id: string
  /** El comentario que muestra la carta (columna «comentario»). */
  comentario: string
  /** La celda de configuración: 'MTN', 'M, N', 'Noche'… (ver `turnosDeCelda`). */
  configuracion: string
}

/** Lo que pasó en una importación, para el resumen que ve el encargado. */
export interface ResumenImportMenu {
  /** IDs que no estaban en el menú y entraron. */
  creados: number
  /** IDs que ya estaban y se refrescaron con los datos de la API. */
  actualizados: number
  /** Filas activas que no estaban en el archivo y se dieron de baja. */
  dadosDeBaja: number
  /** Filas sin ID en su primera columna. */
  sinId: number
  /** IDs que la API de precios no conoce: se saltaron, se listan. */
  noEncontrados: string[]
}

/** Minúsculas y sin acentos: los encabezados vienen como los escribió el usuario. */
function normalizarCelda(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Las letras de la celda de configuración: 'M, N' → 'MN' y 'Mañana' → 'M'.
 *
 * Las PALABRAS se leen antes que las letras sueltas, para que «Mañana» no
 * se convierta en M+N por la N que trae adentro. Sin ninguna letra → todo
 * el día ('MTN'), que es con lo que nacen las filas nuevas: un producto
 * sin turnos no aparecería en ninguna parte de la carta.
 */
export function turnosDeCelda(configuracion: string): string {
  const texto = normalizarCelda(configuracion)
  // "Todo el día" y "siempre" son las tres letras, y así no queda en 'T'
  // por la T de «todo».
  if (texto.includes('todo') || texto.includes('siempre')) return 'MTN'
  const porPalabra: string[] = []
  if (texto.includes('manana')) porPalabra.push('M')
  if (texto.includes('tarde')) porPalabra.push('T')
  if (texto.includes('noche')) porPalabra.push('N')
  const letras = porPalabra.length
    ? porPalabra
    : configuracion.toUpperCase().split('').filter((c) => 'MTN'.includes(c))
  try {
    return turnosDe(letras)
  } catch {
    return 'MTN'
  }
}

/**
 * Las columnas de la hoja.
 *
 * Si la PRIMERA fila trae encabezados —coincide con el término del ID, que
 * es el ancla— se usan ESAS posiciones y esa fila no es dato; si no, se
 * asume el orden fijo A, B, C y la primera fila ya es producto. El ID no
 * se puede deducir de otra forma: sin él no hay nada que buscar.
 */
function columnasDeLaHoja(primera: unknown[]): {
  id: number
  comentario: number
  configuracion: number
  conEncabezado: boolean
} {
  const celdas = primera.map(normalizarCelda)
  // El ID es el ancla del encabezado: palabra entera (`id`, `codigo`,
  // `sku`), y «producto» sólo si EMPIEZA la celda — así «NOMBRE DEL
  // PRODUCTO», que es otra columna, no se roba el lugar del ID.
  let id = celdas.findIndex((c) => /\b(id|codigo|sku)\b/.test(c))
  if (id < 0) id = celdas.findIndex((c) => /^producto\b/.test(c))
  // Sin encabezado de ID se asume el orden fijo: A, B, C.
  if (id < 0) return { id: 0, comentario: 1, configuracion: 2, conEncabezado: false }
  // Subcadena a propósito, sin `\b` al final: «COMENTARIOS» (plural) tiene
  // que entrar igual que «comentario».
  const comentario = celdas.findIndex((c) => /(comentario|descripcion|nota|observacion)/.test(c))
  const configuracion = celdas.findIndex((c) => /(configuracion|turno|horario)/.test(c))
  return { id, comentario, configuracion, conEncabezado: true }
}

/**
 * La matriz de la hoja → las filas que entiende el importador.
 *
 * Se separa acá de la lectura del archivo para poder probarlo sin un .xlsx
 * en mano: mapea encabezados, tira las filas completamente vacías y deja
 * pasar las que vienen sin ID (las cuenta `importarMenuExcel` como `sinId`).
 */
export function filasDesdeMatriz(matriz: unknown[][]): FilaImportMenu[] {
  if (!matriz.length) throw new Error('El archivo está vacío.')
  const col = columnasDeLaHoja(matriz[0])
  const datos = col.conEncabezado ? matriz.slice(1) : matriz
  const leer = (fila: unknown[], i: number) => (i >= 0 ? String(fila[i] ?? '').trim() : '')
  return datos
    .map((fila) => ({
      id: leer(fila, col.id),
      comentario: leer(fila, col.comentario),
      configuracion: leer(fila, col.configuracion)
    }))
    // Las filas en blanco de abajo de todo son ruido de Excel, no datos.
    .filter((f) => f.id || f.comentario || f.configuracion)
}

/**
 * Lee el archivo (.xlsx) y devuelve las filas de la carta.
 *
 * La primera hoja es la que importa: el encargado exporta la planilla y
 * sube el mismo archivo. Un archivo que no es Excel, o que no tiene
 * columnas reconocibles, se explica acá y no llega ni a la confirmación.
 */
export async function leerFilasMenuExcel(archivo: File): Promise<FilaImportMenu[]> {
  let hojas: Awaited<ReturnType<typeof readXlsxFile>>
  try {
    hojas = await readXlsxFile(archivo)
  } catch {
    throw new Error('No se pudo leer el archivo: tiene que ser un Excel (.xlsx) con la carta.')
  }
  // La hoja que importa es la que trae encabezado de ID: un libro puede
  // abrir con una hoja de instrucciones o de firmas adelante. Si ninguna
  // lo trae, manda la primera — un archivo sin encabezados entra por el
  // orden fijo A, B, C.
  const hoja =
    hojas.find((h) => h.data?.[0] && columnasDeLaHoja(h.data[0]).conEncabezado) ?? hojas[0]
  const datos = hoja?.data
  if (!datos?.length) throw new Error('El archivo está vacío.')
  return filasDesdeMatriz(datos)
}

/** Lo que pide `importarMenuExcel`, con todo lo que necesita para correr. */
export interface OpcionesImportMenu {
  sucursalId: string
  /** El shop ID de la sucursal: lo pide la API de precios. */
  shopId: string
  filas: FilaImportMenu[]
  /** ¿Dar de baja los activos que no aparezcan en el archivo? La pantalla lo pregunta. */
  eliminarFaltantes: boolean
  /** Avance para la barra: cuántos IDs ya se procesaron. */
  alAvanzar?: (hecho: number, total: number) => void
}

/**
 * Importa la carta.
 *
 * Por cada fila busca el ID en la API de precios —el mismo scan que el
 * formulario de la consola— y hace upsert por `(sucursal_id, sku)`:
 *
 *  - lo que NO estaba, entra CREADO;
 *  - lo que YA estaba, se ACTUALIZA con los datos frescos de la API y con
 *    el comentario/configuración de la hoja. `categoria` y `foto_url` NO
 *    se mandan: lo que el producto ya tenía se conserva;
 *  - lo que NO está en el archivo se da de BAJA (`activo: false`, nunca
 *    `delete`: la fila y su foto sobreviven para la próxima selección),
 *    y SÓLO si el llamador lo pidió.
 *
 * Los IDs que la API no conoce se saltan y se listan en el resumen. Si una
 * consulta FALLA (red, API caída) se corta TODO en el acto — y por eso las
 * bajas van al final: nunca se elimina por un problema de lectura.
 */
export async function importarMenuExcel(opciones: OpcionesImportMenu): Promise<ResumenImportMenu> {
  const { sucursalId, shopId, filas, eliminarFaltantes, alAvanzar } = opciones

  // Sin repetir —el último renglón del mismo ID manda— y en el orden del
  // archivo, que es el que queda en `orden`.
  const porId = new Map<string, FilaImportMenu>()
  let sinId = 0
  for (const fila of filas) {
    const id = fila.id.trim()
    if (!id) {
      sinId++
      continue
    }
    porId.set(id, fila)
  }
  const entradas = [...porId.entries()]

  // Qué había: para contar creados/actualizados y para cruzar las bajas.
  const { data: previos, error } = await supabase
    .from('menu_productos')
    .select('id, sku, activo')
    .eq('sucursal_id', sucursalId)
  if (error) throw error
  const estaba = new Set((previos ?? []).map((p) => p.sku))

  // Lo que el ARCHIVO dice que existe: con eso se cruza la baja, aunque la
  // API no conozca un ID — si la hoja lo trae, no se borra.
  const enElArchivo = new Set(entradas.map(([id]) => id))

  const resumen: ResumenImportMenu = {
    creados: 0,
    actualizados: 0,
    dadosDeBaja: 0,
    sinId,
    noEncontrados: []
  }

  for (let i = 0; i < entradas.length; i++) {
    const [id, fila] = entradas[i]
    // La consulta FALLA (no "no existe"): se corta acá, antes de las bajas.
    const r = await buscarProducto(id, shopId)
    if (r.nombre) {
      const comentario = fila.comentario.trim()
      const { error: e2 } = await supabase.from('menu_productos').upsert(
        {
          sucursal_id: sucursalId,
          sku: id,
          producto_id: r.id !== undefined ? String(r.id) : null,
          nombre: r.nombre,
          precio: precioDeMenu(r),
          departamento: r.departamento ?? null,
          orden: i + 1,
          activo: true,
          // Sin `categoria` ni `foto_url` a propósito: lo que ya tenía se
          // conserva. El comentario sólo se escribe si la hoja trae uno:
          // una celda vacía no borra lo que se escribió a mano.
          ...(comentario ? { descripcion: comentario } : {}),
          turnos: turnosDeCelda(fila.configuracion)
        },
        { onConflict: 'sucursal_id,sku' }
      )
      if (e2) throw e2
      if (estaba.has(id)) resumen.actualizados++
      else resumen.creados++
    } else {
      resumen.noEncontrados.push(id)
    }
    alAvanzar?.(i + 1, entradas.length)
  }

  // LAS BAJAS, al final y sólo con lo que el archivo no trae: si la
  // importación se cortó arriba, esto no se ejecuta.
  if (eliminarFaltantes) {
    const porBajar = (previos ?? [])
      .filter((p) => p.activo && !enElArchivo.has(p.sku))
      .map((p) => p.id)
    if (porBajar.length) {
      const { data: bajas, error: e3 } = await supabase
        .from('menu_productos')
        .update({ activo: false })
        .eq('sucursal_id', sucursalId)
        .in('id', porBajar)
        .select('id')
      if (e3) throw e3
      resumen.dadosDeBaja = bajas?.length ?? 0
    }
  }

  return resumen
}
