// Ruta relativa: el proxy la resuelve del lado servidor (Vite en dev, Vercel en
// producción). Evita CORS: el navegador solo habla con el mismo origen y el
// proxy reenvía el header API_KEY a deliveryluxor.store.
const BASE_URL = '/api/pricing/samir/scan'

export interface ResultadoScan {
  nombre: string | null
  mensaje: string | null
  /**
   * `id` del producto en la API (`"id": 100006130`): el identificador del
   * producto en el sistema. NO es el código escaneado (viene en `barcode`), por
   * eso se guarda aparte del `sku`.
   */
  id?: number
  /** Cantidad teórica en sistema (soh). */
  soh?: number
  /** Última sincronización del producto reportada por la API. */
  lastSync?: string
  /**
   * Base final del producto (pricing.finalBase): precio de lista **ya
   * descontado** y **sin impuesto**. Ojo, no es el precio de venta.
   *
   * En el ejemplo real de la API, para un papel de 2,84 con 44,07% de descuento,
   * la API manda `finalBase: 1.59` (2,84 × 0,5593) y el precio que se cobra es
   * 1,84. El `percentDiscount` viene solo como dato informativo y no se vuelve a
   * aplicar: la base que manda la API ya viene descontada.
   */
  finalBase?: number
  /** Impuesto del producto (pricing.finalTax), ya calculado sobre la base descontada. */
  finalTax?: number
  /** Nombre del departamento del producto (`department.name`): LIMPIEZA, PANADERÍA, etc. */
  departamento?: string
}

export async function buscarProducto(barcode: string, shopId: string): Promise<ResultadoScan> {
  const keyLocal = import.meta.env.DEV ? import.meta.env.VITE_PRECIOS_API_KEY || null : null
  const url = new URL(BASE_URL, window.location.origin)
  url.searchParams.set('barcode', barcode)
  url.searchParams.set('shop_id', shopId)

  let res: Response
  try {
    // `no-store` es a propósito: es un GET de datos vivos (SOH, precio, última
    // sincronización) y el navegador puede cachearlo por su cuenta si el backend
    // no manda cache-control (en dev el proxy de Vite reenvía los headers que
    // mande deliveryluxor.store). Si se cachea, re-escanear devuelve la misma
    // fecha vieja aunque la API ya tenga otra, que es exactamente el síntoma que
    // motivó este fix. En Vercel el edge function ya responde `no-store`; acá se
    // pide del lado cliente para que el resultado no dependa de quien sirve.
    res = await fetch(url.toString(), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(keyLocal ? { API_KEY: keyLocal } : {})
      }
    })
  } catch {
    return { nombre: null, mensaje: 'Sin conexión para consultar el producto.' }
  }

  let body: {
    message?: string
    detail?: string
    product?: string
    producto?: string
    name?: string
    nombre?: string
    id?: number
    data?: unknown
    soh?: number
    lastSync?: string
    pricing?: { finalBase?: number; finalTax?: number }
    department?: { id?: number; name?: string }
  } | null = null
  try {
    body = (await res.json()) as {
      message?: string
      product?: string
      detail?: string
      producto?: string
      name?: string
      nombre?: string
      id?: number
      data?: unknown
      soh?: number
      lastSync?: string
      pricing?: { finalBase?: number; finalTax?: number }
      department?: { id?: number; name?: string }
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
    const numero = (n: unknown): number | undefined =>
      typeof n === 'number' && Number.isFinite(n) ? n : undefined
    const finalBase = numero(body?.pricing?.finalBase)
    const finalTax = numero(body?.pricing?.finalTax)
    // El `id` del producto en el sistema (100006130). Casi siempre viene arriba del
    // todo; si el backend lo envuelve en `data`, se busca también ahí. Un id que
    // no sea número no sirve para nada y se descarta en vez de guardarse raro.
    const id = numero(body?.id) ?? (
      data && typeof data === 'object' && !Array.isArray(data)
        ? numero((data as Record<string, unknown>).id)
        : undefined
    )
    // El departamento viene anidado y en mayúsculas ("LIMPIEZA"). Se deja tal cual
    // salvo espacios de los bordes: es un rótulo de góndola, no un dato a calcular,
    // y recortarlo más allá sería inventar formato.
    const departamento = typeof body?.department?.name === 'string' && body.department.name.trim()
      ? body.department.name.trim()
      : undefined
    if (nombre) return { nombre, mensaje: null, id, soh, lastSync, finalBase, finalTax, departamento }
    return { nombre: null, mensaje: body?.message ?? null }
  }

  return { nombre: null, mensaje: body?.message ?? body?.detail ?? `Error ${res.status} al consultar el producto.` }
}