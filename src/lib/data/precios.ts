const BASE_URL = 'https://deliveryluxor.store/api/pricing/evaluxor/scan'

export interface ResultadoScan {
  nombre: string | null
  mensaje: string | null
}

export async function buscarProducto(barcode: string, shopId: string): Promise<ResultadoScan> {
  const url = new URL(BASE_URL)
  url.searchParams.set('barcode', barcode)
  url.searchParams.set('shop_id', shopId)
  url.searchParams.set('device', 'mobile')

  let res: Response
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  } catch {
    return { nombre: null, mensaje: 'Sin conexión para consultar el producto.' }
  }

  let body: { message?: string; product?: string; producto?: string; name?: string; nombre?: string; data?: unknown } | null = null
  try {
    body = (await res.json()) as { message?: string; product?: string; producto?: string; name?: string; nombre?: string; data?: unknown }
  } catch {
    body = null
  }

  if (res.ok) {
    const data = body?.data
    const nombreDirecto = body?.product ?? body?.producto ?? body?.name ?? body?.nombre
    const nombre = String(nombreDirecto ?? (typeof data === 'string' ? data : '')) || null
    if (nombre) return { nombre, mensaje: null }
    return { nombre: null, mensaje: body?.message ?? null }
  }

  return { nombre: null, mensaje: body?.message ?? `Error ${res.status} al consultar el producto.` }
}