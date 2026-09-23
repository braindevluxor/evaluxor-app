import { supabase } from '../supabase'

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

interface RespuestaFuncion {
  ok?: boolean
  status?: number
  data?: unknown
}

export async function listarColaboradores(shopId: string): Promise<ResultadoColaboradores> {
  let respuesta: { data: unknown; error: unknown }
  try {
    respuesta = await supabase.functions.invoke('listar-colaboradores', {
      body: { branchID: shopId }
    })
  } catch {
    return { colaboradores: [], mensaje: 'Sin conexión para consultar los colaboradores.' }
  }

  const cuerpo = (respuesta?.data ?? null) as RespuestaFuncion | null

  if (respuesta?.error || !cuerpo || cuerpo.ok === false) {
    const status = cuerpo?.status
    return {
      colaboradores: [],
      mensaje: status ? `Error ${status} al consultar los colaboradores.` : 'No se pudo consultar los colaboradores.'
    }
  }

  const arr = Array.isArray(cuerpo.data)
    ? cuerpo.data
    : Array.isArray((cuerpo.data as { data?: unknown } | null)?.data)
      ? (cuerpo.data as { data: unknown }).data
      : null

  if (!arr) {
    return { colaboradores: [], mensaje: 'La API no devolvió el listado de colaboradores.' }
  }

  const colaboradores = (arr as ColaboradorAPI[]).filter(
    (c) => c && typeof c === 'object' && c.dni != null && (c.name != null || c.lastname != null)
  )
  return { colaboradores, mensaje: null }
}