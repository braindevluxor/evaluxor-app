// Registro de APIs disponibles para las secciones (CONTENEDOR) repetibles.
// Al agregar un registro (ej. un vehículo, un trabajador, un producto) la app
// consulta la API elegida y guarda los valores seleccionados en la configuración
// del ítem (items.api_id + items.api_campos). Los valores son informativos: no
// afectan el puntaje (lo definen los ítems hijos de la sección).
import { buscarVehiculo, type Vehiculo } from './vehicles'
import { buscarProducto, type ResultadoScan } from './precios'
import { listarColaboradores, type ColaboradorAPI } from './colaboradores'

export type ApiId = 'vehiculos' | 'productos' | 'trabajadores'

export interface ApiCampo {
  id: string
  etiqueta: string
}

export interface ApiConsultaContext {
  /** Nº de tienda (shop_id) de la sucursal, para la API de productos. */
  shopId?: string | null
  /** ID de trabajadores (branch_id), para la API de trabajadores. */
  branchId?: string | null
}

/** Resultado de consultar un código (placa / documento / SKU) contra una API. */
export interface ResultadoConsulta {
  /** Identificador que queda como etiqueta del registro (ej. la placa). */
  etiqueta: string
  /** Valores devueltos por la API (todavía sin filtrar por api_campos). */
  datos: Record<string, unknown>
  /** Mensaje de error o «no encontrado»; null si la consulta fue exitosa. */
  mensaje: string | null
}

export interface ApiDisponible {
  id: ApiId
  nombre: string
  descripcion: string
  /** Valores que pueden traerse al agregar un registro. */
  campos: ApiCampo[]
  consultar: (codigo: string, ctx: ApiConsultaContext) => Promise<ResultadoConsulta>
}

export const APIS_DISPONIBLES: ApiDisponible[] = [
  {
    id: 'vehiculos',
    nombre: 'Vehículos (flota)',
    descripcion: 'Consulta por placa en la flota de vehículos.',
    campos: [
      { id: 'placa', etiqueta: 'Placa' },
      { id: 'marca', etiqueta: 'Marca' },
      { id: 'modelo', etiqueta: 'Modelo' },
      { id: 'color', etiqueta: 'Color' },
      { id: 'anio', etiqueta: 'Año' },
      { id: 'capacidad', etiqueta: 'Capacidad' },
      { id: 'estado', etiqueta: 'Estado' },
      { id: 'flota', etiqueta: 'Tipo de flota' },
      { id: 'kilometraje', etiqueta: 'Kilometraje (km)' },
      { id: 'motivo', etiqueta: 'Motivo inactividad' }
    ],
    consultar: async (codigo) => {
      const r = await buscarVehiculo(codigo)
      if (!r.vehiculo) return { etiqueta: codigo.trim(), datos: {}, mensaje: r.mensaje }
      return { etiqueta: r.vehiculo.placa || codigo.trim(), datos: valoresDeVehiculo(r.vehiculo), mensaje: null }
    }
  },
  {
    id: 'productos',
    nombre: 'Productos (precios/SOH)',
    descripcion: 'Consulta por código/SKU en el catálogo de la tienda (shop_id).',
    campos: [
      { id: 'nombre', etiqueta: 'Nombre' },
      { id: 'soh', etiqueta: 'Stock teórico (SOH)' },
      { id: 'lastSync', etiqueta: 'Última sincronización' },
      { id: 'finalBase', etiqueta: 'Precio base' }
    ],
    consultar: async (codigo, ctx) => {
      if (!ctx.shopId) {
        return { etiqueta: codigo.trim(), datos: {}, mensaje: 'La sucursal no tiene Nº de tienda (shop ID) configurado para consultar productos.' }
      }
      const r = await buscarProducto(codigo, ctx.shopId)
      if (!r.nombre) {
        return { etiqueta: codigo.trim(), datos: {}, mensaje: r.mensaje ?? 'Producto no encontrado.' }
      }
      return { etiqueta: codigo.trim(), datos: valoresDeProducto(r), mensaje: null }
    }
  },
  {
    id: 'trabajadores',
    nombre: 'Trabajadores (talento humano)',
    descripcion: 'Consulta por documento (C.I.) en los colaboradores de la sucursal.',
    campos: [
      { id: 'dni', etiqueta: 'Documento' },
      { id: 'nombre', etiqueta: 'Nombre y apellido' },
      { id: 'rol', etiqueta: 'Rol' },
      { id: 'sucursal', etiqueta: 'Sucursal' },
      { id: 'estado', etiqueta: 'Estado' }
    ],
    consultar: async (codigo, ctx) => {
      const branch = ctx.branchId ?? ctx.shopId
      if (!branch) {
        return { etiqueta: codigo.trim(), datos: {}, mensaje: 'La sucursal no tiene ID de trabajadores (branchID) configurado para consultar.' }
      }
      const r = await listarColaboradores(branch)
      if (r.mensaje) return { etiqueta: codigo.trim(), datos: {}, mensaje: r.mensaje }
      const c = encontrarColaboradorPorDocumento(r.colaboradores, codigo)
      if (!c) return { etiqueta: codigo.trim(), datos: {}, mensaje: 'No se encontró un trabajador con ese documento en la sucursal.' }
      const nombre = nombreColaborador(c)
      return { etiqueta: nombre || String(c.dni ?? codigo.trim()), datos: valoresDeColaborador(c), mensaje: null }
    }
  }
]

/** Devuelve la API registrada con ese id, o undefined si no está disponible. */
export function apiDisponible(id?: string | null): ApiDisponible | undefined {
  return APIS_DISPONIBLES.find((a) => a.id === id)
}

/** Filtra los valores devueltos por la API quedándose solo con los campos elegidos en la configuración del ítem. */
export function seleccionarValores(campos: string[], valores: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of campos) if (c in valores) out[c] = valores[c]
  return out
}

/** Etiqueta legible de un campo según la API (ej. 'kilometraje' → 'Kilometraje (km)'). */
export function etiquetaDeCampo(apiId: string | null | undefined, campoId: string): string {
  return apiDisponible(apiId)?.campos.find((c) => c.id === campoId)?.etiqueta ?? campoId
}

/** Formatea un valor traído de la API para mostrarlo (fechas ISO → fecha corta, números sin decimales de más…). */
export function formatearValorConsulta(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  if (typeof v === 'string') {
    const t = v.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      const d = new Date(t)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
      }
    }
    return t || '—'
  }
  if (v == null || v === false) return '—'
  if (v === true) return 'Sí'
  return String(v)
}

/** Valores disponibles de un vehículo (subset completo; se filtra por api_campos al guardar). */
export function valoresDeVehiculo(v: Vehiculo): Record<string, unknown> {
  return {
    placa: v.placa || null,
    marca: v.marca,
    modelo: v.modelo,
    color: v.color,
    anio: v.anio,
    capacidad: v.capacidad,
    estado: (v.statusDisplay ?? v.status) || null,
    flota: (v.fleetTypeDisplay ?? v.fleetType) || null,
    kilometraje: v.kilometraje,
    motivo: v.motivoInactividad
  }
}

/** Valores disponibles de un producto (subset completo; se filtra por api_campos al guardar). */
export function valoresDeProducto(r: ResultadoScan): Record<string, unknown> {
  return {
    nombre: r.nombre,
    soh: r.soh ?? null,
    lastSync: r.lastSync ?? null,
    finalBase: r.finalBase ?? null
  }
}

function nombreColaborador(c: ColaboradorAPI): string {
  return [c.name, c.lastname].filter((x) => typeof x === 'string' && x.trim()).join(' ')
}

/** Valores disponibles de un colaborador (subset completo; se filtra por api_campos al guardar). */
export function valoresDeColaborador(c: ColaboradorAPI): Record<string, unknown> {
  return {
    dni: typeof c.dni === 'number' ? c.dni : (c.dni ?? null),
    nombre: nombreColaborador(c) || null,
    rol: c.role_name ?? null,
    sucursal: c.branch_name ?? null,
    estado: typeof c.active === 'boolean' ? (c.active ? 'Activo' : 'Inactivo') : null
  }
}

/** Busca un colaborador por documento: primero coincidencia exacta (ignorando ceros a la izquierda), luego parcial. */
export function encontrarColaboradorPorDocumento(colaboradores: ColaboradorAPI[], codigo: string): ColaboradorAPI | null {
  const q = String(codigo ?? '').trim().replace(/^0+/, '')
  if (!q) return null
  const exacto = colaboradores.find((c) => c.dni != null && String(c.dni).replace(/^0+/, '') === q)
  if (exacto) return exacto
  return colaboradores.find((c) => c.dni != null && String(c.dni).includes(q)) ?? null
}