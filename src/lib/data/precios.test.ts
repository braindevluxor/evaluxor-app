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
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      product: 'Producto de prueba',
      soh: 12,
      pricing: { finalBase: 19.5 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await buscarProducto('7790001', '198')

    expect(resultado).toEqual({ nombre: 'Producto de prueba', mensaje: null, soh: 12, finalBase: 19.5 })
  const llamada = fetchMock.mock.calls[0]
  expect(String(llamada?.[0])).toContain('barcode=7790001')
  expect(String(llamada?.[0])).toContain('shop_id=198')
  const headers = new Headers(llamada?.[1]?.headers)
  expect(headers.get('API_KEY')).toBe('clave-local')
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
