import { supabase } from '../supabase'
import type { Periodicidad } from './bonos'

/**
 * PROGRAMAS DE BONIFICACIÓN: DE DÓNDE SALE LA NOTA DEL BONO
 * ---------------------------------------------------------
 * Está SEPARADO DE LOS MÓDULOS a propósito: los módulos miden evaluaciones y
 * viven en Configuración > Módulos; un programa es otra cosa —una regla de
 * bono— que puede MIRAR un módulo sin serlo.
 *
 * El modelo (bloque `bonos-programas.sql`) tiene tres piezas:
 *
 *  * `bonos_programa`      → el programa (nombre, descripción, activo).
 *  * `bonos_programa_fuente` → de dónde sale la nota: O un MÓDULO de
 *    evaluación O una ACTIVIDAD propia, cada una con su peso.
 *  * `bonos_programa_nota` → la nota de una ACTIVIDAD por persona y período.
 *    La de los módulos NO se carga acá: esa la calculan las evaluaciones.
 *
 * Todo lo de acá pasa por la RLS `puede_bonos` (LÍDER y GERENTE TH): la
 * segunda cerradura, después del `RequireRol` de la ruta.
 */

/** De dónde sale la nota de una fuente. */
export type TipoFuente = 'MODULO' | 'ACTIVIDAD'

export interface BonoProgramaFuente {
  id: string
  bono_programa_id: string
  tipo: TipoFuente
  /**
   * El módulo de evaluación al que apunta. `null` DESPUÉS de haber existido
   * = el módulo se borró (`on delete set null`): la fuente queda «sin
   * módulo» con su `nombre` de respaldo y hay que volver a elegirlo.
   */
  modulo_id: string | null
  /** Lo que se muestra: el nombre de la actividad o el del módulo copiado. */
  nombre: string
  /** Peso en el promedio ponderado del programa. */
  peso: number
  orden: number
}

export interface BonoPrograma {
  id: string
  nombre: string
  descripcion: string
  activo: boolean
  /**
   * Cada cuánto se paga: define el FORMATO del período en el que se cargan
   * las notas de sus actividades (`2026-11` o `2026-T1`…`2026-T4`), la misma
   * pareja que usan los cargos.
   */
  periodicidad: Periodicidad
  /** Las fuentes de la nota, en orden. */
  fuentes: BonoProgramaFuente[]
  created_at: string
  updated_at: string
}

/** La nota de UNA ACTIVIDAD para una persona en un período. */
export interface NotaActividad {
  bono_programa_fuente_id: string
  periodo: string
  nacionalidad: string
  dni: number
  /** Congelado al cargarlo, igual que en `bonos_pago`. */
  nombre: string
  nota: number
}

/** Lo que se guarda al crear o editar un programa. */
export interface ProgramaEntrada {
  id?: string
  nombre: string
  descripcion: string
  activo: boolean
  periodicidad: Periodicidad
}

/** Un módulo, tal como se ofrece para elegirlo como fuente. */
export interface ModuloFuente {
  id: string
  nombre: string
}

/* --- La regla de negocio (pura) ------------------------------------------- */

/**
 * El peso total de las fuentes: el denominador del promedio ponderado.
 * Sólo cuentan las fuentes con peso (todas lo tienen: la base lo exige).
 */
export function pesoTotal(fuentes: readonly { peso: number }[]): number {
  return fuentes.reduce((suma, f) => suma + (f.peso > 0 ? f.peso : 0), 0)
}

/**
 * La nota del programa: promedio PONDERADO de las fuentes que TRAEN nota.
 *
 * `notas` es `fuente_id → nota`; una fuente sin nota (un módulo cuya
 * evaluación aún no se hizo, una actividad sin cargar) queda FUERA del
 * cálculo en vez de contar como cero — promediar con faltantes hundiría la
 * nota de todos. Si no hay NI UNA nota, el resultado es `null`: «todavía no
 * se puede calcular», que es distinto de «sacó cero».
 */
export function notaDePrograma(
  fuentes: readonly { id: string; peso: number }[],
  notas: Readonly<Record<string, number | null | undefined>>
): number | null {
  let suma = 0
  let peso = 0
  for (const f of fuentes) {
    const nota = notas[f.id]
    // Fuera de rango o no numérica: no entra. Un dato corrupto no debería
    // poder dejar la nota del programa en negativo ni en 500.
    if (nota == null || !Number.isFinite(nota) || nota < 0 || nota > 100 || !(f.peso > 0)) continue
    suma += nota * f.peso
    peso += f.peso
  }
  if (!peso) return null
  return Math.round((suma / peso) * 100) / 100
}

/* --- Errores --------------------------------------------------------------- */

/** Traduce el error crudo a algo que se pueda leer en un cartel. */
function mensajeDeError(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === '42P01' || /bonos_programa/.test(error.message ?? '')) {
    return 'El bloque bonos-programas.sql todavía no está aplicado en la base. Pegalo en el SQL Editor de Supabase y recargá.'
  }
  if (error.code === '42501') {
    return 'Tu rol no puede gestionar programas de bonificación: hace falta ser Líder o Gerente de Talento Humano.'
  }
  return error.message || fallback
}

/* --- Consultas ------------------------------------------------------------- */

/** Los programas con sus fuentes, del más nuevo al más viejo. */
export async function listarProgramas(): Promise<BonoPrograma[]> {
  const { data, error } = await supabase
    .from('bonos_programa')
    .select('*, fuentes:bonos_programa_fuente(*)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(mensajeDeError(error, 'No se pudieron cargar los programas.'))
  const filas = (data ?? []) as (Omit<BonoPrograma, 'fuentes'> & {
    fuentes: BonoProgramaFuente[] | null
  })[]
  return filas.map((p) => ({ ...p, fuentes: (p.fuentes ?? []).sort((a, b) => a.orden - b.orden) }))
}

/**
 * Crea o edita un programa y devuelve su id.
 *
 * El nombre es lo único obligatorio: sin él la fila no se lee en la lista ni
 * en el selector del cargo.
 */
export async function guardarPrograma(entrada: ProgramaEntrada): Promise<string> {
  const nombre = entrada.nombre.trim()
  if (!nombre) throw new Error('Escribí el nombre del programa.')
  const campos = {
    nombre,
    descripcion: entrada.descripcion.trim(),
    activo: entrada.activo,
    periodicidad: entrada.periodicidad,
    updated_at: new Date().toISOString()
  }
  if (entrada.id) {
    const { error } = await supabase.from('bonos_programa').update(campos).eq('id', entrada.id)
    if (error) throw new Error(mensajeDeError(error, 'No se pudo guardar el programa.'))
    return entrada.id
  }
  const { data, error } = await supabase.from('bonos_programa').insert(campos).select('id').single()
  if (error) throw new Error(mensajeDeError(error, 'No se pudo crear el programa.'))
  return data.id as string
}

/**
 * Borra el programa. En cascada salen sus fuentes y sus notas
 * (`on delete cascade`), y los cargos que apuntaban a él quedan SIN
 * programa (`on delete set null`): borrar la configuración no borra el bono.
 */
export async function eliminarPrograma(id: string): Promise<void> {
  const { error } = await supabase.from('bonos_programa').delete().eq('id', id)
  if (error) throw new Error(mensajeDeError(error, 'No se pudo eliminar el programa.'))
}

/**
 * Agrega una fuente de nota al programa.
 *
 * La base ya garantiza el nombre y que una ACTIVIDAD no apunte a un módulo;
 * lo que NO puede garantizar (y sí esta función) es que una fuente MODULO
 * traiga módulo: ese check no existe a propósito, porque después de borrar
 * el módulo la fuente queda legítimamente sin él.
 */
export async function agregarFuente(
  programaId: string,
  entrada: { tipo: TipoFuente; modulo_id?: string | null; nombre: string; peso: number }
): Promise<void> {
  const nombre = entrada.nombre.trim()
  if (!nombre) throw new Error('Escribí el nombre de la fuente.')
  if (!(entrada.peso > 0)) throw new Error('El peso tiene que ser mayor que cero.')
  if (entrada.tipo === 'MODULO' && !entrada.modulo_id) {
    throw new Error('Elegí el módulo del que sale la nota.')
  }
  if (entrada.tipo === 'ACTIVIDAD' && entrada.modulo_id) {
    throw new Error('Una actividad no puede apuntar a un módulo: son dos formas distintas de la nota.')
  }
  const { error } = await supabase.from('bonos_programa_fuente').insert({
    bono_programa_id: programaId,
    tipo: entrada.tipo,
    modulo_id: entrada.tipo === 'MODULO' ? entrada.modulo_id : null,
    nombre,
    peso: entrada.peso
  })
  if (error) throw new Error(mensajeDeError(error, 'No se pudo agregar la fuente.'))
}

/** Quita una fuente y, en cascada, sus notas. El programa no se toca. */
export async function quitarFuente(id: string): Promise<void> {
  const { error } = await supabase.from('bonos_programa_fuente').delete().eq('id', id)
  if (error) throw new Error(mensajeDeError(error, 'No se pudo quitar la fuente.'))
}

/**
 * Los módulos disponibles para elegirlos como fuente.
 *
 * Sólo `id` y `nombre`: este picker no necesita los ítems (para eso está la
 * pantalla de Módulos). Un `[]` puede ser «no hay módulos» o un error de
 * permisos — el llamador lo muestra como «no se pudieron cargar».
 */
export async function listarModulosFuente(): Promise<ModuloFuente[]> {
  const { data, error } = await supabase.from('modulos').select('id, nombre').order('nombre')
  if (error) throw new Error(mensajeDeError(error, 'No se pudieron cargar los módulos.'))
  return (data ?? []) as ModuloFuente[]
}

/**
 * Las notas de ACTIVIDAD de un programa en un período, con el nombre de la
 * fuente para poder mostrarlas sin cruzar nada en la pantalla.
 */
export async function notasDePrograma(programaId: string, periodo: string): Promise<NotaActividad[]> {
  // Sin `join` con la fuente: la pantalla ya sabe cuál actividad está
  // mirando (la eligió en el selector) y sólo filtra por sus ids.
  const ids = await fuentesDePrograma(programaId)
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('bonos_programa_nota')
    .select('bono_programa_fuente_id, periodo, nacionalidad, dni, nombre, nota')
    .eq('periodo', periodo)
    .in('bono_programa_fuente_id', ids)
    .order('nombre')
  if (error) throw new Error(mensajeDeError(error, 'No se pudieron cargar las notas.'))
  return (data ?? []) as NotaActividad[]
}

/** Los ids de las fuentes de un programa. */
async function fuentesDePrograma(programaId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('bonos_programa_fuente')
    .select('id')
    .eq('bono_programa_id', programaId)
  if (error) throw new Error(mensajeDeError(error, 'No se pudieron cargar las fuentes.'))
  return ((data ?? []) as { id: string }[]).map((f) => f.id)
}

/** Guarda (o reemplaza) la nota de una actividad para una persona y período. */
export async function guardarNota(nota: NotaActividad): Promise<void> {
  if (!Number.isFinite(nota.nota) || nota.nota < 0 || nota.nota > 100) {
    throw new Error('La nota va de 0 a 100.')
  }
  const { error } = await supabase.from('bonos_programa_nota').upsert(
    {
      bono_programa_fuente_id: nota.bono_programa_fuente_id,
      periodo: nota.periodo,
      nacionalidad: nota.nacionalidad,
      dni: nota.dni,
      nombre: nota.nombre,
      nota: nota.nota,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'bono_programa_fuente_id,periodo,nacionalidad,dni' }
  )
  if (error) throw new Error(mensajeDeError(error, 'No se pudo guardar la nota.'))
}

/** Quita la nota de esa persona en esa actividad y período. */
export async function quitarNota(nota: NotaActividad): Promise<void> {
  const { error } = await supabase
    .from('bonos_programa_nota')
    .delete()
    .eq('bono_programa_fuente_id', nota.bono_programa_fuente_id)
    .eq('periodo', nota.periodo)
    .eq('nacionalidad', nota.nacionalidad)
    .eq('dni', nota.dni)
  if (error) throw new Error(mensajeDeError(error, 'No se pudo quitar la nota.'))
}
