import { supabase } from '../supabase'
import type { EstadoEvaluacion, Item, Modulo } from '../types'

/**
 * Enlace público de una evaluación (pantalla de invitado).
 *
 * El coordinador de inventario quiere ver cómo va la conciliación sin tener
 * cuenta. El backend está cerrado a `anon` a propósito, así que esto NO es
 * leer una tabla: es llamar a `ver_conciliacion_compartida(p_token)`, la
 * única función abierta a sesión anónima además de las del login. Ver
 * `supabase/compartir-evaluacion.sql`.
 *
 * Todo lo que hace este módulo es: generar un token, guardarlo, apagarlo y
 * leer el paquete que devuelve el RPC. Nada de edición: la pantalla pública no
 * tiene permiso de creación, edición ni borrado.
 */
export interface EnlaceCompartido {
  evaluacion_id: string
  token: string
  activo: boolean
  creado_at: string
}

/** Evaluación tal como la devuelve el RPC: sólo las columnas que pinta la pantalla pública. */
export interface EvaluacionPublica {
  id: string
  sucursal_id: string | null
  departamento_id: string | null
  fecha: string
  estado: EstadoEvaluacion
  puntuacion: number | null
  comentario_general: string | null
  cerrada_en: string | null
  sucursal: { id: string; nombre: string } | null
  departamento: { id: string; nombre: string } | null
}

/**
 * Respuesta sin `id` ni `created_at`: el RPC no los devuelve porque la
 * pantalla pública no los necesita y cuanto menos cruza la base mejor.
 */
export interface RespuestaPublica {
  evaluacion_id: string
  item_id: string
  instancia_id: string | null
  valor: unknown
  respondido_por: string | null
}

export interface ConciliacionPublica {
  evaluacion: EvaluacionPublica
  respuestas: RespuestaPublica[]
  items: Item[]
  modulos: Modulo[]
}

/**
 * 32 bytes aleatorios en hex: 64 caracteres, URL-safe, imposible de derivar
 * de la evaluación ni de adivinar probando tokens.
 *
 * El token se genera en el cliente a propósito: así no hace falta `pgcrypto`
 * ni una segunda función en la base, y el mismo generador sirve para el
 * botón de "generar enlace nuevo".
 */
export function generarToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** El enlace tal como se le pega al coordinador. En el navegador sale del origen actual. */
export function urlCompartida(token: string): string {
  const base = typeof location !== 'undefined' ? location.origin : ''
  return `${base}/compartir/${token}`
}

export async function obtenerEnlace(evaluacionId: string): Promise<EnlaceCompartido | null> {
  const { data } = await supabase
    .from('evaluaciones_compartidas')
    .select('evaluacion_id, token, activo, creado_at')
    .eq('evaluacion_id', evaluacionId)
    .maybeSingle()
  return (data as EnlaceCompartido | null) ?? null
}

/**
 * Genera (o regenera) el enlace de una evaluación y lo deja activo.
 *
 * Siempre reemplaza el token: la PK de la tabla es la evaluación, así que
 * "compartir" otra vez revoca el enlace anterior en lugar de acumular links
 * viejos que nadie puede apagar. Por eso compartir es reversible con un
 * solo `activo = false`.
 */
export async function compartirEvaluacion(
  evaluacionId: string,
  creadoPor: string | null
): Promise<EnlaceCompartido> {
  const { data, error } = await supabase
    .from('evaluaciones_compartidas')
    .upsert(
      { evaluacion_id: evaluacionId, token: generarToken(), activo: true, creado_por: creadoPor },
      { onConflict: 'evaluacion_id' }
    )
    .select('evaluacion_id, token, activo, creado_at')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'No se pudo generar el enlace')
  return data as EnlaceCompartido
}

/**
 * Apaga el enlace. No borra nada: la evaluación queda intacta y el token
 * deja de servir desde el próximo intento de lectura.
 */
export async function apagarEnlace(evaluacionId: string): Promise<void> {
  const { error } = await supabase
    .from('evaluaciones_compartidas')
    .update({ activo: false })
    .eq('evaluacion_id', evaluacionId)
  if (error) throw new Error(error.message)
}

/**
 * Lee la conciliación que corresponde a un token.
 *
 * Devuelve `null` en dos casos que la pantalla no debe distinguir: el token no
 * existe y el enlace está apagado. Si los distinguiera, habría que adivinar
 * tokens comparando respuestas.
 */
export async function obtenerConciliacionPublica(token: string): Promise<ConciliacionPublica | null> {
  const { data, error } = await supabase.rpc('ver_conciliacion_compartida', { p_token: token })
  if (error) throw new Error(error.message)
  const paquete = data as { evaluacion?: EvaluacionPublica | null } | null
  if (!paquete?.evaluacion) return null
  return paquete as unknown as ConciliacionPublica
}
