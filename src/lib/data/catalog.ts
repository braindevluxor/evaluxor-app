import { supabase } from '../supabase'
import { getCache, putCache, type CacheData } from '../offline/db'
import type { Modulo, Item, Sucursal, Departamento } from '../types'

export async function obtenerCacheLocal(): Promise<CacheData | undefined> {
  return getCache()
}

export async function refrescarCatalogo(evaluadorId: string): Promise<CacheData> {
  const [modulos, items, sucursales, departamentos, asignaciones] = await Promise.all([
    supabase.from('modulos').select('*').eq('activo', true).order('orden').order('nombre'),
    supabase.from('items').select('*').eq('activo', true),
    supabase.from('sucursales').select('*').eq('activa', true).order('nombre'),
    supabase.from('departamentos').select('*').eq('activo', true).order('nombre'),
    supabase.from('asignaciones').select('*').eq('evaluador_id', evaluadorId).eq('activa', true)
  ])

  const data: CacheData = {
    modulos: (modulos.data ?? []) as Modulo[],
    items: (items.data ?? []) as Item[],
    sucursales: (sucursales.data ?? []) as Sucursal[],
    departamentos: (departamentos.data ?? []) as Departamento[],
    asignaciones: (asignaciones.data ?? []) as CacheData['asignaciones'],
    updated_at: Date.now()
  }
  await putCache(data)
  return data
}

export async function listarSucursalesAdmin(): Promise<Sucursal[]> {
  const { data } = await supabase.from('sucursales').select('*').order('nombre')
  return (data ?? []) as Sucursal[]
}

export async function guardarSucursal(s: Partial<Sucursal> & { nombre: string }): Promise<void> {
  if (s.id) {
    const { id, ...rest } = s
    await supabase.from('sucursales').update(rest).eq('id', id)
  } else {
    await supabase.from('sucursales').insert({
      nombre: s.nombre,
      shop_id: s.shop_id ?? null,
      ciudad: s.ciudad,
      direccion: s.direccion
    })
  }
}

export async function listarModulosAdmin(): Promise<(Modulo & { _items: Item[] })[]> {
  const { data: mods } = await supabase.from('modulos').select('*').order('orden').order('created_at')
  const { data: items } = await supabase.from('items').select('*').order('orden')
  const modsArr = (mods ?? []) as Modulo[]
  const itemsArr = (items ?? []) as Item[]
  return modsArr.map((m) => ({
    ...m,
    _items: itemsArr
      .filter((i) => i.modulo_id === m.id)
      .sort((a, b) => a.orden - b.orden)
  }))
}

export async function guardarModulo(m: Partial<Modulo> & { nombre: string }): Promise<void> {
  if (m.id) {
    const { id, ...rest } = m
    await supabase.from('modulos').update(rest).eq('id', id)
  } else {
    const { data } = await supabase.from('modulos').insert({ nombre: m.nombre, descripcion: m.descripcion ?? '', orden: m.orden ?? 0 }).select('id').single()
    void data
  }
}

export async function eliminarModulo(id: string): Promise<void> {
  await supabase.from('modulos').delete().eq('id', id)
}

export async function listarDepartamentosAdmin(): Promise<Departamento[]> {
  const { data } = await supabase.from('departamentos').select('*').order('nombre')
  return (data ?? []) as Departamento[]
}

export async function guardarDepartamento(d: Partial<Departamento> & { nombre: string; codigo: string }): Promise<void> {
  if (d.id) {
    const { id, ...rest } = d
    await supabase.from('departamentos').update(rest).eq('id', id)
  } else {
    await supabase.from('departamentos').insert({
      nombre: d.nombre,
      codigo: d.codigo,
      tolerancia: d.tolerancia ?? null
    })
  }
}

export async function eliminarDepartamento(id: string): Promise<void> {
  await supabase.from('departamentos').delete().eq('id', id)
}

export async function guardarItem(i: Partial<Item> & { modulo_id: string; tipo: Item['tipo']; texto: string }): Promise<void> {
  if (i.id) {
    const { id, ...rest } = i
    await supabase.from('items').update(rest).eq('id', id)
  } else {
    await supabase.from('items').insert({
      modulo_id: i.modulo_id,
      tipo: i.tipo,
      texto: i.texto,
      opciones: i.opciones ?? [],
      orden: i.orden ?? 0,
      requerido: i.requerido ?? false
    })
  }
}

export async function eliminarItem(id: string): Promise<void> {
  await supabase.from('items').delete().eq('id', id)
}