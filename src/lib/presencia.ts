/**
 * Datos de presencia: quién tiene la app abierta con señal y en qué pantalla está.
 *
 * La presencia usa el canal de Realtime de Supabase (el mismo que ya mueve el
 * "EN VIVO" de las evaluaciones), así que no necesita tabla ni SQL: cada cliente
 * se anuncia con `track` y el servidor lo saca solo si deja de responder (~30 s).
 */

import type { Rol } from './types'

/** Lo que cada cliente anuncia al canal de presencia. */
export interface PresenciaUsuario {
  id: string
  nombre: string
  usuario: string
  rol: Rol
  /** Ruta donde está (p. ej. `/evaluar/<id>`). */
  ruta: string
  /** Nombre legible de esa pantalla ("Evaluando · Sucursal Norte"). */
  pantalla: string
  /** 'Celular' | 'Tablet' | 'Notebook' */
  dispositivo: string
  /** Versión de la app que corre en ese dispositivo ("0.1.0"). */
  version: string
  /** Build exacta ("20260929-1912-a1b2c3"): lo que distingue dos despliegues. */
  build_id: string
  sucursal_id: string | null
  /** Marca de tiempo del último anuncio (Date.now). */
  visto: number
}

export interface CatalogoNombres {
  sucursales?: { id: string; nombre: string }[]
  modulos?: { id: string; nombre: string }[]
}

/** Nombre de un id del catálogo, o null si no está (aún no cargó, o no existe). */
function nombreDe(lista: { id: string; nombre: string }[] | undefined, id: string | undefined): string | null {
  if (!id) return null
  return lista?.find((x) => x.id === id)?.nombre ?? null
}

/**
 * Nombre legible de una pantalla a partir de la ruta. Las coincidencias se prueban
 * de la más específica a la más general (los sufijos van primero: `/evaluar/x/resumen`
 * antes que `/evaluar/x`). Si la ruta no se reconoce devuelve 'En la app', para no
 * mostrar un path crudo al líder.
 */
export function etiquetaPantalla(ruta: string, catalogo: CatalogoNombres = {}): string {
  const p = ruta.split('?')[0].split('#')[0]
  const partes = p.split('/').filter(Boolean)

  if (!partes.length) return 'Inicio'

  if (partes[0] === 'login') return 'Ingreso'
  if (partes[0] === 'registro') return 'Registro'
  if (partes[0] === 'perfil') return 'Mi perfil'
  if (partes[0] === 'pendiente') return 'Pendiente de sincronizar'
  if (partes[0] === 'biblioteca') return 'Biblioteca'

  if (partes[0] === 'evaluar') {
    // /evaluar (la lista de sucursales) no lleva id: es "Mis evaluaciones".
    if (partes.length === 1) return 'Mis evaluaciones'
    if (partes[1] === 'historial') return 'Historial de evaluaciones'
    // /evaluar/:sucursalId[/resumen]
    const suc = nombreDe(catalogo.sucursales, partes[1])
    const base = suc ? `Sucursal ${suc}` : 'una sucursal'
    if (partes[2] === 'resumen') return `Resumen · ${base}`
    return suc ? `Evaluando · Sucursal ${suc}` : 'Evaluando'
  }

  if (partes[0] === 'evaluaciones') {
    if (partes[2] === 'conciliacion') return 'Conciliación'
    return 'Detalle de evaluación'
  }

  if (partes[0] === 'dashboard') {
    if (partes[1] === 'historial') return 'Historial'
    if (partes[1] === 'comparativas') return 'Comparativas'
    if (partes[1] === 'modulo') {
      const mod = nombreDe(catalogo.modulos, partes[2])
      return mod ? `Módulo ${mod}` : 'Módulo'
    }
    return 'Dashboard'
  }

  if (partes[0] === 'config') {
    if (partes[1] === 'sucursales') return 'Sucursales'
    if (partes[1] === 'modulos') return 'Módulos'
    if (partes[1] === 'items') return 'Ítems'
    if (partes[1] === 'usuarios') return 'Usuarios'
    return 'Configuración'
  }

  if (partes[0] === 'proyectos') {
    if (partes[1] === 'biometrico') return 'Biométrico'
    return 'Proyectos'
  }

  return 'En la app'
}

/** Tipo de dispositivo, a partir del user agent (por defecto, el del navegador). */
export function etiquetaDispositivo(ua: string | undefined = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const s = (ua ?? '').toLowerCase()
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return 'Tablet'
  if (/mobi|iphone|ipod|android|blackberry|windows phone/.test(s)) return 'Celular'
  return 'Notebook'
}

/** Id estable del dispositivo (para no mezclar dos sesiones del mismo usuario). */
const CLAVE_DISPOSITIVO = 'evaluxor.dispositivo'

export function idDispositivo(): string {
  try {
    let id = localStorage.getItem(CLAVE_DISPOSITIVO)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(CLAVE_DISPOSITIVO, id)
    }
    return id
  } catch {
    return 'anon'
  }
}

/** Estado crudo de presencia del canal, tal cual lo devuelve Supabase. */
export type EstadoCanal = Record<string, Partial<PresenciaUsuario>[]>

function esPresenciaValida(p: Partial<PresenciaUsuario> | undefined): p is PresenciaUsuario {
  return !!p && typeof p.id === 'string' && !!p.id
}

/**
 * Agrupa el estado del canal por usuario: una persona con dos dispositivos (celu y
 * notebook) aparece una sola vez, con la pantalla del dispositivo más reciente y
 * cuántos dispositivos tiene abiertos.
 */
export function perfilesConectados(estado: EstadoCanal): Record<string, PresenciaUsuario & { dispositivos: number }> {
  const porUsuario = new Map<string, PresenciaUsuario[]>()
  for (const lista of Object.values(estado ?? {})) {
    for (const p of lista ?? []) {
      if (!esPresenciaValida(p)) continue
      const prev = porUsuario.get(p.id)
      if (prev) prev.push(p)
      else porUsuario.set(p.id, [p])
    }
  }
  const out: Record<string, PresenciaUsuario & { dispositivos: number }> = {}
  for (const [id, lista] of porUsuario) {
    // El dispositivo que se anunció más recientemente es el que define la
    // pantalla mostrada.
    const reciente = [...lista].sort((a, b) => (b.visto ?? 0) - (a.visto ?? 0))[0]
    out[id] = { ...reciente, dispositivos: lista.length }
  }
  return out
}

/** Cantidad de personas distintas conectadas ahora. */
export function totalConectados(conectados: Record<string, unknown>): number {
  return Object.keys(conectados ?? {}).length
}
