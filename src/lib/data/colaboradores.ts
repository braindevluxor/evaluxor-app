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

/** El nombre completo, con el orden con el que se firma: apellido, nombre. */
export function nombreCompleto(c: Pick<ColaboradorAPI, 'name' | 'lastname'>): string {
  return `${(c.name ?? '').trim()} ${(c.lastname ?? '').trim()}`.replace(/\s+/g, ' ').trim()
}

/** La cédula como se escribe en papel: «V-12345678». Sin puntos de miles. */
export function cedula(c: Pick<ColaboradorAPI, 'nationality' | 'dni'>): string {
  if (c.dni == null) return '—'
  const pais = (c.nationality ?? 'V').trim() || 'V'
  return `${pais}-${c.dni}`
}

/**
 * La raíz de un cargo, para comparar cargos entre fuentes: normalizada y sin
 * la terminación de género.
 *
 * El mismo puesto aparece escrito distinto según de dónde salga —«Cajero
 * integral» en la evaluación y «Cajera Integral» en la nómina—, y comparar los
 * textos tal cual deja a media tienda sin poder notificar. Quitarle la última
 * «o»/«a» a cada palabra iguala las dos formas sin inventar un diccionario de
 * sinónimos.
 */
function raizCargo(texto: string): string {
  // Sin pasar por `claveNormalizada`: ésa junta todo y borra los espacios, y
  // acá hacen falta las palabras para quitarle la terminación a cada una.
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((palabra) => palabra.replace(/[ao]$/, ''))
    .join('')
}

/**
 * Los trabajadores de UN cargo, para notificarles un llamado o una amonestación.
 *
 * Sólo los ACTIVOS: noificar a alguien que ya no está en la tienda no arregla
 * nada y deja un documento sin destinatario. El cruce es por raíz del cargo
 * (ver `raizCargo`), y cuando no hay ninguna coincidencia se devuelven todos
 * coincidencia se devuelven todos los activos con `porCargo: false` para que la
 * pantalla lo avise: un cargo mal escrito en la evaluación no debe volver
 * imposible notificar a nadie.
 */
export function trabajadoresParaCargo(
  colaboradores: readonly ColaboradorAPI[],
  cargo: string
): { trabajadores: ColaboradorAPI[]; porCargo: boolean } {
  const activos = colaboradores.filter((c) => c.active)
  const objetivo = raizCargo(cargo)
  const delCargo = activos.filter((c) => {
    const rol = raizCargo(c.role_name ?? '')
    if (!rol || !objetivo) return false
    return rol.includes(objetivo) || objetivo.includes(rol)
  })
  return { trabajadores: delCargo.length ? delCargo : activos, porCargo: delCargo.length > 0 }
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