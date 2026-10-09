import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buscarProducto } from './precios'

beforeEach(() => {
  vi.stubEnv('VITE_PRECIOS_API_KEY', 'clave-local')
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buscarProducto', () => {
  it('consulta el proxy local y normaliza los datos del producto', async () => {
    // Respuesta real de la API: la base ya viene descontada (2.84 con 44.07% de
    // descuento) y el impuesto va aparte. El precio de venta es la suma.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      product: 'Producto de prueba',
      soh: 12,
      lastSync: '2026-10-05 16:51:37',
      pricing: { originalBase: 2.84, finalTax: 3.1, finalBase: 19.5, percentDiscount: 44.07 },
      department: { id: 17, name: 'LIMPIEZA' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await buscarProducto('7790001', '198')

    expect(resultado).toEqual({
      nombre: 'Producto de prueba',
      mensaje: null,
      soh: 12,
      lastSync: '2026-10-05 16:51:37',
      finalBase: 19.5,
      finalTax: 3.1,
      departamento: 'LIMPIEZA'
    })
    // `percentDiscount` se ignora a propósito: la base ya viene descontada y
    // aplicarlo otra vez bajaría el precio de 22,60 a 12,59.
    expect(resultado).not.toHaveProperty('percentDiscount')
  const llamada = fetchMock.mock.calls[0]
  expect(String(llamada?.[0])).toContain('barcode=7790001')
  expect(String(llamada?.[0])).toContain('shop_id=198')
  const headers = new Headers(llamada?.[1]?.headers)
  expect(headers.get('API_KEY')).toBe('clave-local')
  })

  it('le pide al navegador que no cachee la consulta, para que el lastSync nunca envejezca', async () => {
    // Es un GET de datos vivos. Sin `no-store`, el navegador puede responder del
    // caché si el backend no manda cache-control (en dev el proxy de Vite
    // reenvía lo que mande deliveryluxor.store) y el escaneo posterior devolvería
    // el mismo lastSync de antes aunque la API ya tenga otro.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ product: 'P' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await buscarProducto('7790001', '198')

    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('no-store')
  })

  it('trae el `id` del producto en la API, que no es el código escaneado', async () => {
    // Respuesta real del scan. El `id` (100006130) es el identificador del
    // producto en el sistema; el código escaneado va en `barcode` y se guarda
    // como sku, así que son dos cosas distintas.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 100006130,
      name: 'Harina De Maiz Pan 1 Kg',
      barcode: '7591002000011',
      soh: 0,
      lastSync: '2026-10-07 22:55:04',
      pricing: { finalBase: 1.69, finalTax: 0 },
      department: { id: 6, name: 'PRIMERA NECESIDAD' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const resultado = await buscarProducto('7591002000011', '1')

    expect(resultado.id).toBe(100006130)
    expect(resultado.nombre).toBe('Harina De Maiz Pan 1 Kg')
    expect(resultado.departamento).toBe('PRIMERA NECESIDAD')
  })

  it('un `id` que no sea número se descarta en vez de guardarse raro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'mil',
      name: 'Producto raro'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    expect((await buscarProducto('7790001', '1')).id).toBeUndefined()
  })

  it('trae el nombre del departamento, no solo su id', async () => {
    // El id (17) no sirve para mostrar ni para ordenar; el rótulo de góndola sí.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      product: 'Papel Rosal Plus',
      department: { id: 17, name: 'LIMPIEZA' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    expect((await buscarProducto('7591098170278', '1')).departamento).toBe('LIMPIEZA')
  })

  it('un producto sin departamento no inventa uno', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      product: 'Producto sin clasificar',
      department: { id: 999 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    expect((await buscarProducto('7790001', '1')).departamento).toBeUndefined()
  })

  it('ignora un departamento que viene en blanco', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      product: 'Producto con espacio',
      department: { id: 3, name: '   ' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    expect((await buscarProducto('7790001', '1')).departamento).toBeUndefined()
  })

  it('muestra el detalle del proxy cuando falta configurar el secreto de Vercel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Falta configurar PRECIOS_API_KEY en Vercel.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )))

    const resultado = await buscarProducto('7790001', '198')

    expect(resultado.mensaje).toBe('Falta configurar PRECIOS_API_KEY en Vercel.')
  })

  it('no bloquea la consulta en dev si no hay clave local y deja que responda el proxy', async () => {
    vi.stubEnv('VITE_PRECIOS_API_KEY', '')
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Falta configurar PRECIOS_API_KEY en Vercel.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await buscarProducto('7790001', '198')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resultado.mensaje).toBe('Falta configurar PRECIOS_API_KEY en Vercel.')
  })
})
