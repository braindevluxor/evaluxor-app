import { supabase } from '../supabase'
import type { RevisionPreEntrega } from '../types'

/** Lo que se manda al servidor. `id` lo genera el cliente (uuid). */
export type CargaRevisionPreEntrega = Omit<RevisionPreEntrega, 'created_at' | 'updated_at'>

/** Revisiones del servidor. El LÍDER ve todas; el evaluador, las suyas (lo decide RLS). */
export async function listarRevisionesPreEntrega(sucursalId?: string | null): Promise<RevisionPreEntrega[]> {
  let q = supabase.from('revision_pre_entrega').select('*').order('created_at', { ascending: false }).limit(100)
  if (sucursalId) q = q.eq('sucursal_id', sucursalId)
  const { data } = await q
  return (data ?? []) as RevisionPreEntrega[]
}

export async function obtenerRevisionPreEntrega(id: string): Promise<RevisionPreEntrega | null> {
  const { data } = await supabase.from('revision_pre_entrega').select('*').eq('id', id).maybeSingle()
  return (data as RevisionPreEntrega | null) ?? null
}

/**
 * Guarda la revisión como upsert sobre `id`.
 *
 * No se manda `created_at`: la columna tiene default now() y, en el conflicto,
 * omitirla conserva la de la primera creación (el server no es la fuente de la
 * hora, el teléfono lo es). Reintentar la subida no crea una revisión nueva ni
 * pisa la de otro evaluador (eso lo impide RLS).
 */
export async function guardarRevisionPreEntrega(r: CargaRevisionPreEntrega): Promise<void> {
  const { error } = await supabase
    .from('revision_pre_entrega')
    .upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) throw error
}

export async function eliminarRevisionPreEntrega(id: string): Promise<void> {
  const { error } = await supabase.from('revision_pre_entrega').delete().eq('id', id)
  if (error) throw error
}