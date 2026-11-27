import { supabase } from '../supabase'
import { colorLibre } from '../acuerdos'

/**
 * ACUERDOS COMERCIALES: LA CAPA DE DATOS
 * --------------------------------------
 * Traduce la forma de la pantalla ↔ la de las tablas (ver
 * `acuerdos-comerciales.sql` en schema.sql). Todo lo que se escribe pasa por
 * RLS: el Coordinador gestiona espacios/proveedores/acuerdos, el Auditor
 * registra cobros y el Líder sólo lee.
 *
 * Dos cosas que NO se guardan acá y se calculan en el cliente:
 *  - las FECHAS de cobro (`fechasDeCobro` en `lib/acuerdos.ts`), porque el
 *    calendario se deriva de `fecha_inicio + frecuencia`;
 *  - la MORA, que es sólo `fecha < hoy` sin cobro registrado.
 */

export type ClaseCatalogo = 'FRECUENCIA' | 'TIPO_PAGO'

export interface TipoEspacio {
  id: string
  nombre: string
}

export interface OpcionCatalogo {
  id: string
  valor: string
}

export interface Proveedor {
  id: string
  nombre: string
  /** RIF o cédula del proveedor (texto, puede venir vacío). */
  rif: string
  /** Persona de contacto. */
  contacto: string
  telefono: string
  correo: string
  color: string
  activo: boolean
}

export interface Espacio {
  id: string
  sucursal_id: string
  tipo_id: string
  codigo: string
  detalle: string
  /** Posición sobre el plano, en % del ancho (x) y del alto (y) de la imagen. */
  x: number
  y: number
  /**
   * Cómo se pinta sobre el plano: un `punto` (marcador redondo), un
   * `rectangulo` o un `circulo` dibujados arrastrando sobre la imagen.
   */
  forma: 'punto' | 'rectangulo' | 'circulo'
  /** Tamaño en % del ancho de la imagen (0 en un punto). */
  ancho: number
  /** Tamaño en % del alto de la imagen (0 en un punto). */
  alto: number
  activo: boolean
}

export interface Acuerdo {
  id: string
  espacio_id: string
  proveedor_id: string
  /** ISO `YYYY-MM-DD`. */
  fecha_inicio: string
  /** ISO `YYYY-MM-DD`. */
  fecha_fin: string
  monto_usd: number
  frecuencia: string
  tipo_pago: string
  /** Ruta del contrato adjunto en el bucket (`contratos/…`), si hay. */
  contrato: string | null
  /**
   * Cuándo se CARGÓ el acuerdo (no cuándo vence): es lo que dice «negociado
   * EN este mes» en el dashboard, y por eso viaja con el resto.
   */
  created_at: string
  activo: boolean
}

export interface Cobro {
  id: string
  acuerdo_id: string
  /** ISO `YYYY-MM-DD`: la fecha de cobro que se registró. */
  fecha: string
  monto: number
  pagado_en: string | null
  comprobante: string | null
  comprobante_tipo: 'pdf' | 'imagen' | null
}

/** Una sucursal para el selector del plano (id + nombre, nada más). */
export interface SucursalAcuerdo {
  id: string
  nombre: string
}

export interface PlanoSucursal {
  sucursal_id: string
  /** Ruta en el bucket `acuerdos` (`planos/<sucursal>/<archivo>`). */
  imagen: string
}

/* --- Catálogos y sucursales ------------------------------------------------ */

/**
 * Las sucursales con su plano: pasa por la RPC pública `ver_sucursales_menu`
 * (devuelve sólo id y nombre), porque `sucursales` es de sólo-Líder en RLS
 * y este módulo lo ven también el Coordinador y el Auditor.
 */
export async function listarSucursalesAcuerdos(): Promise<SucursalAcuerdo[]> {
  const { data, error } = await supabase.rpc('ver_sucursales_menu')
  if (error) throw error
  return (data ?? []) as SucursalAcuerdo[]
}

export async function listarTiposEspacio(): Promise<TipoEspacio[]> {
  const { data, error } = await supabase
    .from('acuerdo_tipo_espacio')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre')
  if (error) throw error
  return (data ?? []) as TipoEspacio[]
}

/** Un tipo de espacio nuevo («otros» siempre puede crearse desde la pantalla). */
export async function crearTipoEspacio(nombre: string): Promise<TipoEspacio> {
  const limpio = nombre.trim()
  if (!limpio) throw new Error('Escribí el tipo de espacio.')
  const { data, error } = await supabase
    .from('acuerdo_tipo_espacio')
    .insert({ nombre: limpio })
    .select('id, nombre')
    .single()
  if (error) throw error
  return data as TipoEspacio
}

export async function listarCatalogo(clase: ClaseCatalogo): Promise<OpcionCatalogo[]> {
  const { data, error } = await supabase
    .from('acuerdo_catalogo')
    .select('id, valor')
    .eq('clase', clase)
    .eq('activo', true)
    .order('valor')
  if (error) throw error
  return (data ?? []) as OpcionCatalogo[]
}

/** Una opción nueva del formulario (frecuencia o tipo de pago). */
export async function crearOpcionCatalogo(clase: ClaseCatalogo, valor: string): Promise<OpcionCatalogo> {
  const limpio = valor.trim()
  if (!limpio) throw new Error('Escribí la opción.')
  const { data, error } = await supabase
    .from('acuerdo_catalogo')
    .insert({ clase, valor: limpio })
    .select('id, valor')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Esa opción ya existe en la lista.')
    throw error
  }
  return data as OpcionCatalogo
}

/* --- Proveedores ----------------------------------------------------------- */

export async function listarProveedores(): Promise<Proveedor[]> {
  const { data, error } = await supabase
    .from('acuerdo_proveedor')
    .select('id, nombre, rif, contacto, telefono, correo, color, activo')
    .eq('activo', true)
    .order('nombre')
  if (error) throw error
  return (data ?? []) as Proveedor[]
}

/**
 * Crea o edita un proveedor. El COLOR se asigna solo con la primera paleta
 * libre —es el que lo pinta en la lista y a su espacio en el plano— salvo
 * que venga uno explícito.
 */
export async function guardarProveedor(entrada: {
  id?: string
  nombre: string
  rif?: string
  contacto?: string
  telefono?: string
  correo?: string
  color?: string
}): Promise<void> {
  const nombre = entrada.nombre.trim().toUpperCase()
  if (!nombre) throw new Error('Escribí el nombre del proveedor.')
  // Todo lo del proveedor se guarda en MAYÚSCULAS (decisión de la pantalla).
  const cuerpo = {
    nombre,
    rif: (entrada.rif ?? '').trim().toUpperCase(),
    contacto: (entrada.contacto ?? '').trim().toUpperCase(),
    telefono: (entrada.telefono ?? '').trim().toUpperCase(),
    correo: (entrada.correo ?? '').trim().toUpperCase(),
    updated_at: new Date().toISOString()
  }

  if (entrada.id) {
    const { error } = await supabase.from('acuerdo_proveedor').update(cuerpo).eq('id', entrada.id)
    if (error) throw error
    return
  }

  const existentes = await listarProveedores()
  const { error } = await supabase
    .from('acuerdo_proveedor')
    .insert({ ...cuerpo, color: entrada.color ?? colorLibre(existentes.map((p) => p.color)) })
  if (error) {
    if (error.code === '23505') throw new Error('Ya existe un proveedor con ese nombre.')
    throw error
  }
}

/**
 * Baja lógica: el proveedor desaparece de las listas pero sus acuerdos y
 * cobros siguen intactos (el RLS y los `join` no se tocan).
 */
export async function eliminarProveedor(id: string): Promise<void> {
  const { error } = await supabase.from('acuerdo_proveedor').update({ activo: false }).eq('id', id)
  if (error) throw error
}

/* --- El plano y sus espacios ------------------------------------------------ */

export async function listarPlanos(): Promise<PlanoSucursal[]> {
  const { data, error } = await supabase.from('acuerdo_plano').select('sucursal_id, imagen')
  if (error) throw error
  return (data ?? []) as PlanoSucursal[]
}

/** Tipos de archivo que se aceptan: PDF o imagen (el comprobante y el plano). */
const TIPOS_IMAGEN = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

function extension(file: File): string {
  if (file.type === 'application/pdf') return 'pdf'
  if (TIPOS_IMAGEN.includes(file.type)) return file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1]
  throw new Error('Sólo se aceptan PDF o imágenes (PNG, JPG, WebP o GIF).')
}

/**
 * Sube el plano de una sucursal y lo deja guardado. La imagen queda en el
 * bucket privado `acuerdos` y se lee con URL firmada.
 */
export async function subirPlano(sucursalId: string, file: File): Promise<string> {
  const ext = extension(file)
  const ruta = `planos/${sucursalId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('acuerdos').upload(ruta, file, { upsert: true })
  if (error) throw error
  const { error: errPlano } = await supabase
    .from('acuerdo_plano')
    .upsert({ sucursal_id: sucursalId, imagen: ruta, updated_at: new Date().toISOString() })
  if (errPlano) throw errPlano
  return ruta
}

/** Una URL firmada (1 hora) para el bucket privado: planos y comprobantes. */
export async function urlFirmada(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from('acuerdos').createSignedUrl(ruta, 3600)
  if (error || !data?.signedUrl) throw new Error('No se pudo abrir el archivo.')
  return data.signedUrl
}

/** Todos los espacios de TODAS las sucursales (los usa el dashboard). */
export async function listarEspaciosTodos(): Promise<Espacio[]> {
  const { data, error } = await supabase
    .from('acuerdo_espacio')
    .select('id, sucursal_id, tipo_id, codigo, detalle, x, y, forma, ancho, alto, activo')
    .eq('activo', true)
    .order('codigo')
  if (error) throw error
  return (data ?? []) as Espacio[]
}

export async function listarEspacios(sucursalId: string): Promise<Espacio[]> {
  const { data, error } = await supabase
    .from('acuerdo_espacio')
    .select('id, sucursal_id, tipo_id, codigo, detalle, x, y, forma, ancho, alto, activo')
    .eq('sucursal_id', sucursalId)
    .eq('activo', true)
    .order('codigo')
  if (error) throw error
  return (data ?? []) as Espacio[]
}

export async function guardarEspacio(entrada: {
  id?: string
  sucursal_id: string
  tipo_id: string
  codigo: string
  detalle?: string
  x: number
  y: number
  forma?: 'punto' | 'rectangulo' | 'circulo'
  ancho?: number
  alto?: number
}): Promise<void> {
  const codigo = entrada.codigo.trim()
  if (!codigo) throw new Error('Escribí el código del espacio (su ubicación exacta).')
  if (!(entrada.x >= 0 && entrada.x <= 100 && entrada.y >= 0 && entrada.y <= 100)) {
    throw new Error('La posición tiene que estar dentro del plano (0 a 100).')
  }
  const forma = entrada.forma ?? 'punto'
  if (forma !== 'punto') {
    if (!(entrada.ancho! > 0 && entrada.alto! > 0)) {
      throw new Error('Dibujá el tamaño del espacio sobre el plano (o cargá ancho y alto).')
    }
    if (!(entrada.ancho! <= 100 && entrada.alto! <= 100)) {
      throw new Error('El tamaño tiene que estar dentro del plano (0 a 100).')
    }
  }
  const cuerpo = {
    sucursal_id: entrada.sucursal_id,
    tipo_id: entrada.tipo_id,
    codigo,
    detalle: (entrada.detalle ?? '').trim(),
    x: entrada.x,
    y: entrada.y,
    forma,
    ancho: forma === 'punto' ? 0 : entrada.ancho,
    alto: forma === 'punto' ? 0 : entrada.alto,
    updated_at: new Date().toISOString()
  }
  const consulta = entrada.id
    ? supabase.from('acuerdo_espacio').update(cuerpo).eq('id', entrada.id)
    : supabase.from('acuerdo_espacio').insert(cuerpo)
  const { error } = await consulta
  if (error) {
    if (error.code === '23505') throw new Error('Ya existe un espacio con ese código en esta sucursal.')
    throw error
  }
}

/** Baja lógica: el espacio queda fuera del plano pero su historial sigue. */
export async function eliminarEspacio(id: string): Promise<void> {
  const { error } = await supabase.from('acuerdo_espacio').update({ activo: false }).eq('id', id)
  if (error) throw error
}

/* --- Acuerdos --------------------------------------------------------------- */

export type AcuerdoConRelacion = Acuerdo & {
  espacio: Pick<Espacio, 'id' | 'codigo' | 'detalle' | 'sucursal_id' | 'tipo_id'> | null
  proveedor: Pick<Proveedor, 'id' | 'nombre' | 'color'> | null
}

export async function listarAcuerdos(): Promise<AcuerdoConRelacion[]> {
  const { data, error } = await supabase
    .from('acuerdo_comercial')
    .select(
      'id, espacio_id, proveedor_id, fecha_inicio, fecha_fin, monto_usd, frecuencia, tipo_pago, contrato, created_at, activo, espacio:acuerdo_espacio(id, codigo, detalle, sucursal_id, tipo_id), proveedor:acuerdo_proveedor(id, nombre, color)'
    )
    .order('fecha_inicio', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as AcuerdoConRelacion[]
}

export async function guardarAcuerdo(entrada: {
  id?: string
  espacio_id: string
  proveedor_id: string
  fecha_inicio: string
  fecha_fin: string
  monto_usd: number
  frecuencia: string
  tipo_pago: string
}): Promise<string> {
  if (!entrada.espacio_id) throw new Error('Elegí el espacio del piso de venta.')
  if (!entrada.proveedor_id) throw new Error('Elegí el proveedor.')
  if (!entrada.fecha_inicio || !entrada.fecha_fin) throw new Error('Completá las fechas del acuerdo.')
  if (entrada.fecha_fin < entrada.fecha_inicio) {
    throw new Error('La fecha final no puede ser anterior a la inicial.')
  }
  if (!(entrada.monto_usd > 0)) throw new Error('El monto de renta tiene que ser mayor que cero.')
  if (!entrada.frecuencia) throw new Error('Elegí la frecuencia de pago.')
  if (!entrada.tipo_pago) throw new Error('Elegí el tipo de pago.')

  const cuerpo = {
    espacio_id: entrada.espacio_id,
    proveedor_id: entrada.proveedor_id,
    fecha_inicio: entrada.fecha_inicio,
    fecha_fin: entrada.fecha_fin,
    monto_usd: entrada.monto_usd,
    frecuencia: entrada.frecuencia,
    tipo_pago: entrada.tipo_pago,
    updated_at: new Date().toISOString()
  }

  if (entrada.id) {
    const { error } = await supabase.from('acuerdo_comercial').update(cuerpo).eq('id', entrada.id)
    if (error) throw error
    return entrada.id
  }

  const usuario = (await supabase.auth.getUser()).data.user?.id ?? null
  const { data, error } = await supabase
    .from('acuerdo_comercial')
    .insert({ ...cuerpo, created_by: usuario })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

/**
 * Adjunta el CONTRATO al acuerdo: el archivo queda en `contratos/<id>/…`
 * del bucket privado y la RUTA se guarda en la fila. Se sube DESPUÉS de
 * guardar el acuerdo (el id tiene que existir); si falla, el acuerdo queda
 * igual — sin contrato — y la pantalla lo avisa.
 */
export async function subirContrato(acuerdoId: string, archivo: File): Promise<string> {
  const ext = extension(archivo)
  const ruta = `contratos/${acuerdoId}/${Date.now()}.${ext}`
  const { error: errSubida } = await supabase.storage.from('acuerdos').upload(ruta, archivo, { upsert: true })
  if (errSubida) throw errSubida
  const { error } = await supabase
    .from('acuerdo_comercial')
    .update({ contrato: ruta, updated_at: new Date().toISOString() })
    .eq('id', acuerdoId)
  if (error) throw error
  return ruta
}

/** Saca el contrato adjunto del acuerdo (el archivo queda huérfano, inofensivo). */
export async function quitarContrato(acuerdoId: string): Promise<void> {
  const { error } = await supabase
    .from('acuerdo_comercial')
    .update({ contrato: null, updated_at: new Date().toISOString() })
    .eq('id', acuerdoId)
  if (error) throw error
}

/** Baja lógica: el acuerdo deja de estar vigente pero queda en el historial. */
export async function darDeBajaAcuerdo(id: string): Promise<void> {
  const { error } = await supabase.from('acuerdo_comercial').update({ activo: false }).eq('id', id)
  if (error) throw error
}

/**
 * Borrado REAL del acuerdo: se va él y, por el `on delete cascade`, también
 * sus cobros y comprobantes (los archivos del bucket quedan huérfanos,
 * inofensivos). A diferencia de `darDeBajaAcuerdo`, esto NO se puede
 * deshacer — por eso la pantalla lo confirma con el detalle de lo que se
 * pierde. Sólo lo hace el Coordinador (RLS `acuerdo_comercial_gestion`).
 */
export async function eliminarAcuerdo(id: string): Promise<void> {
  const { error } = await supabase.from('acuerdo_comercial').delete().eq('id', id)
  if (error) throw error
}

/* --- Cobros (lo que se registró como pagado) -------------------------------- */

export type CobroConAcuerdo = Cobro & {
  acuerdo: (Acuerdo & {
    espacio: Pick<Espacio, 'codigo' | 'detalle' | 'sucursal_id' | 'tipo_id'> | null
    proveedor: Pick<Proveedor, 'id' | 'nombre' | 'color'> | null
  }) | null
}

export async function listarCobros(): Promise<CobroConAcuerdo[]> {
  const { data, error } = await supabase
    .from('acuerdo_cobro')
    .select(
      'id, acuerdo_id, fecha, monto, pagado_en, comprobante, comprobante_tipo, acuerdo:acuerdo_comercial(id, espacio_id, proveedor_id, fecha_inicio, fecha_fin, monto_usd, frecuencia, tipo_pago, contrato, created_at, activo, espacio:acuerdo_espacio(codigo, detalle, sucursal_id, tipo_id), proveedor:acuerdo_proveedor(id, nombre, color))'
    )
    .order('fecha', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as CobroConAcuerdo[]
}

/**
 * Registra un cobro: la fecha queda COMO PAGADA, con el archivo si trae uno
 * (PDF o imagen). Si ya existía la misma fecha, se reemplaza —así se puede
 * corregir un monto o subir el comprobante después—.
 */
export async function registrarCobro(entrada: {
  acuerdo_id: string
  fecha: string
  monto: number
  archivo?: File
}): Promise<void> {
  if (!(entrada.monto >= 0)) throw new Error('El monto no puede ser negativo.')
  const usuario = (await supabase.auth.getUser()).data.user?.id ?? null

  let comprobante: string | null = null
  let comprobanteTipo: 'pdf' | 'imagen' | null = null
  if (entrada.archivo) {
    const tipo = entrada.archivo.type === 'application/pdf' ? 'pdf' : 'imagen'
    const ext = tipo === 'pdf' ? 'pdf' : entrada.archivo.type.split('/')[1] || 'png'
    comprobante = `comprobantes/${entrada.acuerdo_id}/${Date.now()}.${ext}`
    const { error: errSubida } = await supabase.storage
      .from('acuerdos')
      .upload(comprobante, entrada.archivo, { upsert: true })
    if (errSubida) throw errSubida
    comprobanteTipo = tipo
  }

  const { error } = await supabase.from('acuerdo_cobro').upsert(
    {
      acuerdo_id: entrada.acuerdo_id,
      fecha: entrada.fecha,
      monto: entrada.monto,
      pagado_en: hoy(),
      comprobante,
      comprobante_tipo: comprobanteTipo,
      registrado_por: usuario
    },
    { onConflict: 'acuerdo_id,fecha' }
  )
  if (error) throw error
}

/** Deshace un cobro (y su archivo queda huérfano en el bucket, inofensivo). */
export async function deshacerCobro(id: string): Promise<void> {
  const { error } = await supabase.from('acuerdo_cobro').delete().eq('id', id)
  if (error) throw error
}

function hoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
