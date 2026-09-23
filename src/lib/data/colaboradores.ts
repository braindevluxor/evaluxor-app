const BASE_URL = 'https://desarrolloluxor.lat/api/talentohumano/employee/samir'
const API_KEY = 'PBDFeysVkGLa0zRfq5bYEUtNbmV0akhtN3hFakRES3E2cU82TVE9PQ=='

export interface ColaboradorAPI {
  nationality?: string
  dni?: number
  name?: string
  lastname?: string
  role_id?: string
  role_name?: string
  branch_id?: number
  branch_name?: string
  active?: boolean
}

export interface ResultadoColaboradores {
  colaboradores: ColaboradorAPI[]
  mensaje: string | null
}

export async function listarColaboradores(shopId: string): Promise<ResultadoColaboradores> {
  const url = new URL(BASE_URL)
  url.searchParams.set('branchID', shopId)

  let res: Response
  try {
    res = await fetch(url.toString(), { headers: { API_KEY } })
  } catch {
    return { colaboradores: [], mensaje: 'Sin conexión para consultar los colaboradores.' }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    return { colaboradores: [], mensaje: `Error ${res.status} al consultar los colaboradores.` }
  }

  const arr = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown } | null)?.data)
      ? (body as { data: unknown }).data
      : null

  if (!arr) {
    return { colaboradores: [], mensaje: 'La API no devolvió el listado de colaboradores.' }
  }

  const colaboradores = (arr as ColaboradorAPI[]).filter(
    (c) => c && typeof c === 'object' && c.dni != null && (c.name != null || c.lastname != null)
  )
  return { colaboradores, mensaje: null }
}