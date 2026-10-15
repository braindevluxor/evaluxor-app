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
  admission_date?: string | null
}

export interface ResultadoColaboradores {
  colaboradores: ColaboradorAPI[]
  mensaje: string | null
}

const ORDEN_ES = new Intl.Collator('es', { sensitivity: 'base' })

/** Ordena por apellido, luego nombre y por DNI como desempate estable. */
export function ordenarTrabajadores<T extends Pick<ColaboradorAPI, 'lastname' | 'name' | 'dni'>>(
  trabajadores: readonly T[]
): T[] {
  return [...trabajadores].sort((a, b) =>
    ORDEN_ES.compare((a.lastname ?? '').trim(), (b.lastname ?? '').trim()) ||
    ORDEN_ES.compare((a.name ?? '').trim(), (b.name ?? '').trim()) ||
    Number(a.dni ?? 0) - Number(b.dni ?? 0)
  )
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
    return { colaboradores: [], mensaje: 'Sin conexión para consultar a los trabajadores.' }
  }

  const cuerpo = (respuesta?.data ?? null) as RespuestaFuncion | null

  if (respuesta?.error || !cuerpo || cuerpo.ok === false) {
    const status = cuerpo?.status
    return {
      colaboradores: [],
      mensaje: status ? `Error ${status} al consultar a los trabajadores.` : 'No se pudo consultar a los trabajadores.'
    }
  }

  const arr = Array.isArray(cuerpo.data)
    ? cuerpo.data
    : Array.isArray((cuerpo.data as { data?: unknown } | null)?.data)
      ? (cuerpo.data as { data: unknown }).data
      : null

  if (!arr) {
    return { colaboradores: [], mensaje: 'La API no devolvió el listado de trabajadores.' }
  }

  const colaboradores = ordenarTrabajadores((arr as ColaboradorAPI[])
    .filter((c) => c && typeof c === 'object' && c.dni != null && (c.name != null || c.lastname != null))
  )

  return { colaboradores, mensaje: null }
}