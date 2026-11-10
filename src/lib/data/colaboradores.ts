import { claveNormalizada } from './responsables'
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
  /**
   * Estado del trabajador. La API no es uniforme: en algunas respuestas es
   * booleano, en otras número o string, y el flag puede llamarse `is_active`
   * (ver `esActivo`, que es el único lugar donde se interpreta).
   */
  active?: boolean | number | string
  is_active?: unknown
  /** Departamento de la persona en la nómina: `department_name` en el JSON. */
  department_name?: string
  /** Otras formas en las que puede venir el área: la API no es uniforme. */
  departamento?: string
  department?: unknown
  area?: unknown
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
 * ¿Está ACTIVO el trabajador? Es la puerta de todo lo que se cuenta o se paga.
 *
 * La API no es uniforme: manda `active`, pero puede venir como booleano,
 * número (0/1) o string ("true"/"false"), y en algunas respuestas el flag es
 * `is_active`. Cualquier forma de «no» cuenta como inactivo, y SIN flag no se
 * cuenta: para plata no se paga a alguien cuyo estado no se sabe.
 */
export function esActivo(c: ColaboradorAPI): boolean {
  const registro = c as unknown as Record<string, unknown>
  const valor = registro.active !== undefined && registro.active !== null ? registro.active : registro.is_active
  if (valor === undefined || valor === null) return false
  if (typeof valor === 'string') {
    const t = valor.trim().toLowerCase()
    return !(t === '' || t === 'false' || t === '0' || t === 'no' || t === 'inactivo' || t === 'inactive')
  }
  if (typeof valor === 'number') return valor !== 0
  return Boolean(valor)
}

/**
 * Los trabajadores de UN cargo, para notificarles un llamado o una amonestación.
 *
 * Sólo los ACTIVOS y sólo los que ENCAJAN con el cargo: no todos los cargos
 * aplican en todas las sucursales, y si «Cajero integral» no figura en la
 * nómina de esa tienda, listar a los demás invita a notificar a la persona
 * equivocada. En ese caso la lista sale VACÍA y la pantalla ofrece registrar
 * contra el cargo, que es lo que corresponde.
 *
 * El cruce es DELIBERADAMENTE difuso en los DOS sentidos («Cajero integral»
 * alcanza a quien en la nómina figura como «Cajero», y al revés): para
 * NOTIFICAR conviene llegar de más que quedarse corto. Para contar o PAGAR
 * no —ahí está `trabajadoresDeCargoExacto`.
 */
export function trabajadoresParaCargo(
  colaboradores: readonly ColaboradorAPI[],
  cargo: string
): { trabajadores: ColaboradorAPI[]; porCargo: boolean } {
  const activos = colaboradores.filter(esActivo)
  const objetivo = raizCargo(cargo)
  const delCargo = activos.filter((c) => {
    const rol = raizCargo(c.role_name ?? '')
    if (!rol || !objetivo) return false
    return rol.includes(objetivo) || objetivo.includes(rol)
  })
  return { trabajadores: delCargo, porCargo: delCargo.length > 0 }
}

/**
 * El departamento de la persona, como venga en el JSON: `department_name`
 * (la forma real que trae la API), `department` (string u objeto con `name`),
 * `departamento` o `area`. Vacío si no trae ninguno.
 *
 * Vacío importa: sin departamento en la nómina no se puede acotar un bono a
 * un área, y para plata eso significa NO contarlo (ver
 * `trabajadoresDeCargoExacto`) en vez de contar a alguien de otra área.
 */
export function departamentoDeColaborador(c: ColaboradorAPI): string {
  const r = c as unknown as Record<string, unknown>
  for (const clave of ['department_name', 'departamento', 'department', 'area']) {
    const valor = r[clave]
    if (typeof valor === 'string' && valor.trim()) return valor.trim()
    if (valor && typeof valor === 'object') {
      const nombre = (valor as Record<string, unknown>).name
      if (typeof nombre === 'string' && nombre.trim()) return nombre.trim()
    }
  }
  return ''
}

/**
 * Los activos cuyo cargo es EXACTAMENTE el indicado: el mismo puesto, con la
 * tolerancia de género y número que ya trae `raizCargo` («Cajero integral» y
 * «Cajera Integral» son lo mismo).
 *
 * POR QUÉ NO EL CRUCE DIFUSO DE `trabajadoresParaCargo`
 * -----------------------------------------------------
 * Ése está pensado para notificar: si el panel dice «Cajero integral» y en la
 * nómina figura «Cajero», conviene alcanzarlo. Contar y PAGAR un bono pide lo
 * contrario: con el cruce difuso, «Gerente de mercado» —un cargo ÚNICO por
 * tienda— terminaría cobrando a cualquier «Gerente» o a un «Gerente de
 * Mercado Regional» que pasa por cuatro tiendas, y el gasto se dispara sin
 * que nadie lo haya decidido.
 *
 * EL DEPARTAMENTO (opcional)
 * --------------------------
 * Con `departamento`, el mismo cargo en áreas distintas son cuentas
 * distintas: «Comprador/a» de Compras no se junta con «Comprador/a» de
 * Servicios Generales. Sólo cuenta quien se pueda IDENTIFICAR en ese área —
 * si la nómina no trae `department_name` de esa persona, no se le paga un
 * bono acotado a un área en la que no se pudo comprobar que está.
 */
export function trabajadoresDeCargoExacto(
  colaboradores: readonly ColaboradorAPI[],
  cargo: string,
  departamento?: string | null
): ColaboradorAPI[] {
  const objetivo = raizCargo(cargo)
  if (!objetivo) return []
  const area = departamento ? claveNormalizada(departamento) : ''
  return colaboradores.filter((c) => {
    if (!esActivo(c)) return false
    if (raizCargo(c.role_name ?? '') !== objetivo) return false
    if (!area) return true
    return claveNormalizada(departamentoDeColaborador(c)) === area
  })
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