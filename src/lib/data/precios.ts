// Ruta relativa: el proxy la resuelve del lado servidor (Vite en dev, Vercel en
// producción). Evita CORS: el navegador solo habla con el mismo origen y el
// proxy reenvía el header API_KEY a deliveryluxor.store.
const BASE_URL = '/api/pricing/samir/scan'
const API_KEY = import.meta.env.VITE_PRECIOS_API_KEY

if (!API_KEY) throw new Error('Falta VITE_PRECIOS_API_KEY en el entorno.')

export interface ResultadoScan {
  nombre: string | null
  mensaje: string | null
  /** Cantidad teórica en sistema (soh). */
  soh?: number
  /** Última sincronización del producto reportada por la API. */
  lastSync?: string
  /** Precio base final del producto (pricing.finalBase). */
  finalBase?: number
}

export async function buscarProducto(barcode: string, shopId: string): Promise<ResultadoScan> {
  const url = new URL(BASE_URL, window.location.origin)
  url.searchParams.set('barcode', barcode)
  url.searchParams.set('shop_id', shopId)

  let res: Response
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json', API_KEY } })
  } catch {
    return { nombre: null, mensaje: 'Sin conexión para consultar el producto.' }
  }

  let body: {
    message?: string
    product?: string
    producto?: string
    name?: string
    nombre?: string
    data?: unknown
    soh?: number
    lastSync?: string
    pricing?: { finalBase?: number }
  } | null = null
  try {
    body = (await res.json()) as {
      message?: string
      product?: string
      producto?: string
      name?: string
      nombre?: string
      data?: unknown
      soh?: number
      lastSync?: string
      pricing?: { finalBase?: number }
    }
  } catch {
    body = null
  }

  if (res.ok) {
    const data = body?.data
    const nombreDirecto = body?.product ?? body?.producto ?? body?.name ?? body?.nombre
    const nombre = String(nombreDirecto ?? (typeof data === 'string' ? data : '')) || null
    const soh = typeof body?.soh === 'number' && Number.isFinite(body.soh) ? body.soh : undefined
    const lastSync = typeof body?.lastSync === 'string' && body.lastSync.trim() ? body.lastSync : undefined
    const finalBase =
      body?.pricing && typeof body.pricing.finalBase === 'number' && Number.isFinite(body.pricing.finalBase)
        ? body.pricing.finalBase
        : undefined
    if (nombre) return { nombre, mensaje: null, soh, lastSync, finalBase }
    return { nombre: null, mensaje: body?.message ?? null }
  }

  return { nombre: null, mensaje: body?.message ?? `Error ${res.status} al consultar el producto.` }
}