// Ruta relativa: el proxy la resuelve del lado servidor (Vite en dev, Vercel en
// producción). Evita CORS: el navegador solo habla con el mismo origen y el
// proxy reenvía el header Authorization al API de flota (dev-logix).
const BASE_URL = '/api/flota/vehicles/'
const API_KEY = import.meta.env.VITE_VEHICLES_API_KEY

if (!API_KEY) throw new Error('Falta VITE_VEHICLES_API_KEY en el entorno.')

/** Vehículo normalizado de la flota (consulta por placa). */
export interface Vehiculo {
  id: number
  /** Placa del vehículo (identifier de la API). */
  placa: string
  marca: string | null
  modelo: string | null
  /** Color en formato hex (ej. #FFFFFF). */
  color: string | null
  anio: number | null
  capacidad: number | null
  /** Estado crudo: ACTIVE | MAINTENANCE | ... */
  status: string
  statusDisplay: string | null
  /** Tipo de flota: EJECUTIVA | S_GENERALES | ... */
  fleetType: string
  fleetTypeDisplay: string | null
  /** Kilometraje actual reportado. */
  kilometraje: number | null
  motivoInactividad: string | null
  activo: boolean
}

export interface ResultadoVehiculo {
  vehiculo: Vehiculo | null
  mensaje: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizarVehiculo(r: Record<string, unknown>): Vehiculo {
  return {
    id: typeof r.id === 'number' ? r.id : 0,
    placa: str(r.identifier) ?? '',
    marca: str(r.brand),
    modelo: str(r.model),
    color: str(r.color),
    anio: num(r.year),
    capacidad: num(r.capacity),
    status: str(r.status) ?? '',
    statusDisplay: str(r.status_display),
    fleetType: str(r.fleet_type) ?? '',
    fleetTypeDisplay: str(r.fleet_type_display),
    kilometraje: num(r.current_mileage),
    motivoInactividad: str(r.inactive_reason),
    activo: r.is_active === true
  }
}

/** Consulta un vehículo por placa. La búsqueda es insensible a mayúsculas y acepta texto parcial. */
export async function buscarVehiculo(placa: string): Promise<ResultadoVehiculo> {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const url = new URL(BASE_URL, base)
  url.searchParams.set('search', placa.trim())

  let res: Response
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json', Authorization: `Api-Key ${API_KEY}` } })
  } catch {
    return { vehiculo: null, mensaje: 'Sin conexión para consultar el vehículo.' }
  }

  let body: { count?: number; results?: unknown[]; detail?: string } | null = null
  try {
    body = (await res.json()) as { count?: number; results?: unknown[]; detail?: string }
  } catch {
    body = null
  }

  if (res.ok) {
    const primero = Array.isArray(body?.results) ? body.results[0] : undefined
    if (primero && typeof primero === 'object' && primero !== null) {
      return { vehiculo: normalizarVehiculo(primero as Record<string, unknown>), mensaje: null }
    }
    return { vehiculo: null, mensaje: 'Placa no encontrada en la flota.' }
  }

  return {
    vehiculo: null,
    mensaje: typeof body?.detail === 'string' && body.detail.trim()
      ? body.detail
      : `Error ${res.status} al consultar el vehículo.`
  }
}