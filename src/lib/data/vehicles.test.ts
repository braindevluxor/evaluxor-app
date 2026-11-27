import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// La clave sale del entorno. La lectura es perezosa (al momento de consultar),
// así que se fija antes de importar y de nuevo en cada test, porque el
// afterEach limpia los stubs de entorno.
const { buscarVehiculo } = await import('./vehicles')

beforeEach(() => {
  vi.stubEnv('VITE_VEHICLES_API_KEY', 'clave-de-prueba')
})

const vehiculoCrudo = {
  id: 3,
  identifier: 'AA579AC',
  brand: 'renault',
  model: 'clio',
  color: '#FFFFFF',
  year: null,
  capacity: 5,
  status: 'MAINTENANCE',
  status_display: 'En Mantenimiento',
  fleet_type: 'EJECUTIVA',
  fleet_type_display: 'Ejecutiva',
  current_mileage: 10000000,
  inactive_reason: 'motor dañao',
  is_active: true
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  )
}

describe('buscarVehiculo', () => {
  it('encuentra el vehículo por placa y lo normaliza', async () => {
    mockFetch({ count: 1, results: [vehiculoCrudo] })
    const r = await buscarVehiculo('aa579ac')

    expect(r.mensaje).toBeNull()
    expect(r.vehiculo?.placa).toBe('AA579AC')
    expect(r.vehiculo?.marca).toBe('renault')
    expect(r.vehiculo?.modelo).toBe('clio')
    expect(r.vehiculo?.color).toBe('#FFFFFF')
    expect(r.vehiculo?.anio).toBeNull()
    expect(r.vehiculo?.capacidad).toBe(5)
    expect(r.vehiculo?.status).toBe('MAINTENANCE')
    expect(r.vehiculo?.statusDisplay).toBe('En Mantenimiento')
    expect(r.vehiculo?.fleetTypeDisplay).toBe('Ejecutiva')
    expect(r.vehiculo?.kilometraje).toBe(10000000)
    expect(r.vehiculo?.motivoInactividad).toBe('motor dañao')
    expect(r.vehiculo?.activo).toBe(true)

    // El request sale por el proxy (mismo origen) con el header Authorization.
    const call = vi.mocked(fetch).mock.calls[0]
    expect(String(call[0])).toMatch(/\/api\/flota\/vehicles\/\?search=aa579ac$/)
    expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: 'Api-Key clave-de-prueba' })
  })

  it('placa inexistente → mensaje de no encontrada', async () => {
    mockFetch({ count: 0, results: [] })
    const r = await buscarVehiculo('zzz999')
    expect(r.vehiculo).toBeNull()
    expect(r.mensaje).toBe('Placa no encontrada en la flota.')
  })

  it('error HTTP → mensaje con el detalle de la API', async () => {
    mockFetch({ detail: 'Credenciales inválidas.' }, 401)
    const r = await buscarVehiculo('AA579AC')
    expect(r.vehiculo).toBeNull()
    expect(r.mensaje).toBe('Credenciales inválidas.')
  })

  it('sin conexión → mensaje de conexión', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const r = await buscarVehiculo('AA579AC')
    expect(r.vehiculo).toBeNull()
    expect(r.mensaje).toBe('Sin conexión para consultar el vehículo.')
  })

  it('sin clave configurada → mensaje claro sin romper la app', async () => {
    vi.stubEnv('VITE_VEHICLES_API_KEY', '')
    const r = await buscarVehiculo('AA579AC')
    expect(r.vehiculo).toBeNull()
    expect(r.mensaje).toBe('API de vehículos no configurada en el entorno.')
  })
})