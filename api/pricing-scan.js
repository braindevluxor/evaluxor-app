// Proxy server-side para no exponer la clave de precios en el bundle del navegador.
export const config = { runtime: 'edge' }

const API_KEY = process.env.PRECIOS_API_KEY
const BACKEND = 'https://deliveryluxor.store/api/pricing/samir/scan'

export default async function handler(request) {
  if (request.method !== 'GET') {
    return Response.json({ message: 'Método no permitido.' }, { status: 405 })
  }

  const incoming = new URL(request.url)
  const barcode = (incoming.searchParams.get('barcode') ?? '').trim()
  const shopId = (incoming.searchParams.get('shop_id') ?? '').trim()

  if (!barcode || !shopId) {
    return Response.json({ message: 'Falta el código del producto o el shop_id.' }, { status: 400 })
  }
  if (!API_KEY) {
    return Response.json({ detail: 'Falta configurar PRECIOS_API_KEY en Vercel.' }, { status: 500 })
  }

  try {
    const destino = new URL(BACKEND)
    destino.searchParams.set('barcode', barcode)
    destino.searchParams.set('shop_id', shopId)

    const respuesta = await fetch(destino.toString(), {
      headers: { Accept: 'application/json', API_KEY }
    })

    return new Response(await respuesta.text(), {
      status: respuesta.status,
      headers: {
        'Content-Type': respuesta.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store'
      }
    })
  } catch {
    return Response.json({ message: 'Sin conexión con la API de precios.' }, { status: 502 })
  }
}