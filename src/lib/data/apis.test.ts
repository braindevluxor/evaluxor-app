import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APIS_DISPONIBLES,
  apiDisponible,
  etiquetaDeCampo,
  encontrarColaboradorPorDocumento,
  formatearValorConsulta,
  seleccionarValores,
  valoresDeColaborador,
  valoresDeProducto,
  valoresDeVehiculo
} from './apis'
import { vehiculoDePrueba, productoDePrueba, colaboradorDePrueba, colaboradoresDePrueba as colabs, vehiculoCrudo } from './apis.test.fixtures'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }))

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  )
}

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ data: { ok: true, data: { data: colabs } }, error: null })
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiDisponible', () => {
  it('expone las tres APIs (trabajadores, vehículos, productos)', () => {
    const ids = APIS_DISPONIBLES.map((a) => a.id)
    expect(ids).toEqual(['vehiculos', 'productos', 'trabajadores'])
    expect(apiDisponible('vehiculos')?.nombre).toContain('Vehículos')
    expect(apiDisponible('productos')?.nombre).toContain('Productos')
    expect(apiDisponible('trabajadores')?.nombre).toContain('Trabajadores')
  })

  it('devuelve undefined para un id desconocido o vacío', () => {
    expect(apiDisponible('otra')).toBeUndefined()
    expect(apiDisponible('')).toBeUndefined()
    expect(apiDisponible(null)).toBeUndefined()
    expect(apiDisponible(undefined)).toBeUndefined()
  })

  it('cada API tiene campos únicos con etiqueta', () => {
    for (const api of APIS_DISPONIBLES) {
      const ids = api.campos.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(api.campos.length).toBeGreaterThan(0)
    }
  })
})

describe('seleccionarValores', () => {
  it('filtra por los campos elegidos en la configuración del ítem', () => {
    const todo = { placa: 'ABC123', marca: 'renault', modelo: 'clio', color: '#FFF' }
    expect(seleccionarValores(['placa', 'modelo'], todo)).toEqual({ placa: 'ABC123', modelo: 'clio' })
    expect(seleccionarValores([], todo)).toEqual({})
  })

  it('ignora campos que la API no devolvió', () => {
    expect(seleccionarValores(['marca', 'km'], { marca: 'x' })).toEqual({ marca: 'x' })
  })
})

describe('etiquetaDeCampo', () => {
  it('devuelve la etiqueta legible del campo según la API', () => {
    expect(etiquetaDeCampo('vehiculos', 'kilometraje')).toBe('Kilometraje (km)')
    expect(etiquetaDeCampo('trabajadores', 'nombre')).toBe('Nombre y apellido')
  })

  it('devuelve el id crudo si no hay API o campo conocido', () => {
    expect(etiquetaDeCampo('vehiculos', 'otro')).toBe('otro')
    expect(etiquetaDeCampo(null, 'marca')).toBe('marca')
  })
})

describe('formatearValorConsulta', () => {
  it('formatea números, fechas ISO cortas y vacíos', () => {
    expect(formatearValorConsulta(10000000)).toBe('10000000')
    expect(formatearValorConsulta(5.25)).toBe('5.25')
    expect(formatearValorConsulta('2025-01-10T14:30:00Z')).toMatch(/10 ene|ene\.? 2025/i)
    expect(formatearValorConsulta('2025-01-10')).toMatch(/2025/)
    expect(formatearValorConsulta(null)).toBe('—')
    expect(formatearValorConsulta('')).toBe('—')
    expect(formatearValorConsulta(true)).toBe('Sí')
  })
})

describe('valoresDeVehiculo', () => {
  it('mapea los campos del vehículo con su estado legible', () => {
    const v = valoresDeVehiculo(vehiculoDePrueba)
    expect(v.placa).toBe('AA579AC')
    expect(v.marca).toBe('renault')
    expect(v.estado).toBe('En Mantenimiento')
    expect(v.flota).toBe('Ejecutiva')
    expect(v.kilometraje).toBe(10000000)
    expect(v.motivo).toBe('motor dañao')
    expect(v.anio).toBeNull()
  })
})

describe('valoresDeProducto', () => {
  it('mapea nombre, soh, lastSync y precio base', () => {
    const v = valoresDeProducto(productoDePrueba)
    expect(v).toEqual({
      nombre: 'Aceite 1L',
      soh: 42,
      lastSync: '2025-01-10T14:30:00Z',
      finalBase: 12990.5
    })
  })
})

describe('valoresDeColaborador / encontrarColaboradorPorDocumento', () => {
  it('mapea nombre completo, rol y estado legible', () => {
    const v = valoresDeColaborador(colaboradorDePrueba)
    expect(v.nombre).toBe('Juan Pérez')
    expect(v.rol).toBe('Cajero')
    expect(v.estado).toBe('Activo')
  })

  it('busca por documento exacto ignorando ceros a la izquierda', () => {
    expect(encontrarColaboradorPorDocumento(colabs, '04231309')?.dni).toBe(4231309)
    expect(encontrarColaboradorPorDocumento(colabs, '4231309')?.dni).toBe(4231309)
  })

  it('hace fallback a coincidencia parcial', () => {
    expect(encontrarColaboradorPorDocumento(colabs, '231309')?.dni).toBe(4231309)
  })

  it('devuelve null cuando no hay coincidencia o el código está vacío', () => {
    expect(encontrarColaboradorPorDocumento(colabs, '000000')).toBeNull()
    expect(encontrarColaboradorPorDocumento(colabs, '  ')).toBeNull()
    expect(encontrarColaboradorPorDocumento([], '4231309')).toBeNull()
  })
})

describe('consultar de cada API', () => {
  it('vehiculos (encontrado): la etiqueta es la placa y devuelve los datos completos', async () => {
    mockFetch({ count: 1, results: [vehiculoCrudo] })
    const api = apiDisponible('vehiculos')!
    const r = await api.consultar('aa579ac', {})
    expect(r.mensaje).toBeNull()
    expect(r.etiqueta).toBe('AA579AC')
    expect(r.datos.marca).toBe('renault')
  })

  it('productos (encontrado): etiqueta = código, datos mapeados', async () => {
    mockFetch({ product: 'Aceite 1L', soh: 42, lastSync: '2025-01-10T14:30:00Z', pricing: { finalBase: 12990.5 } })
    const api = apiDisponible('productos')!
    const r = await api.consultar('7790001', { shopId: '198' })
    expect(r.mensaje).toBeNull()
    expect(r.etiqueta).toBe('7790001')
    expect(r.datos.nombre).toBe('Aceite 1L')
    expect(r.datos.soh).toBe(42)
  })

  it('productos sin shop_id → mensaje de configuración', async () => {
    const api = apiDisponible('productos')!
    const r = await api.consultar('7790001', {})
    expect(r.mensaje).toContain('shop ID')
  })

  it('trabajadores (encontrado): etiqueta = nombre y apellido', async () => {
    const api = apiDisponible('trabajadores')!
    const r = await api.consultar('04231309', { branchId: 'b1' })
    expect(r.mensaje).toBeNull()
    expect(r.etiqueta).toBe('Juan Pérez')
    expect(r.datos.rol).toBe('Cajero')
  })

  it('trabajadores sin branch → mensaje de configuración', async () => {
    const api = apiDisponible('trabajadores')!
    const r = await api.consultar('04231309', {})
    expect(r.mensaje).toContain('branchID')
  })
})