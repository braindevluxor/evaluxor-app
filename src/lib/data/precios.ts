const BASE_URL = 'https://deliveryluxor.store/api/pricing/evaluxor/scan'

interface ScanBody {
  message?: string
  product?: string
  producto?: string
  name?: string
  nombre?: string
  data?: unknown
  department?: string | number
  departamento?: string | number
  department_id?: string | number
  departamento_id?: string | number
  depto?: string | number
  group?: string | number
}

export interface ResultadoScan {
  nombre: string | null
  departamentoId: string | null
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
    return { nombre: null, departamentoId: null, mensaje: 'Sin conexión para consultar el producto.' }
  }

  let body: ScanBody | null = null
  try {
    body = (await res.json()) as ScanBody
  } catch {
    body = null
  }

  if (res.ok) {
    const data = body?.data
    const nombreDirecto = body?.product ?? body?.producto ?? body?.name ?? body?.nombre
    const nombre = String(nombreDirecto ?? (typeof data === 'string' ? data : '')) || null
    const deptoRaw = body?.department_id ?? body?.departamento_id ?? body?.department ?? body?.departamento ?? body?.depto ?? body?.group
    const departamentoId = deptoRaw != null ? String(deptoRaw) : null
    return { nombre, departamentoId, mensaje: null }
  }

  return { nombre: null, departamentoId: null, mensaje: body?.message ?? `Error ${res.status} al consultar el producto.` }
}