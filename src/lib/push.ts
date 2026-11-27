/**
 * SUSCRIPCIÓN A NOTIFICACIONES PUSH (LADO CLIENTE)
 * ------------------------------------------------
 * Pide permiso, se suscribe al push service del navegador y guarda la
 * suscripción en `push_suscripciones` para que el servidor sepa a dónde
 * mandar.
 *
 * POR QUÉ SEPARADO EN DOS CAPAS
 * -----------------------------
 * Lo que se puede probar sin red —decodificar la clave, armar el payload,
 * decir si el equipo soporta push— vive en funciones puras. Lo que toca
 * IndexedDB/PushManager/Supabase vive aparte. Los tests cubren las puras, que
 * son las que tienen lógica; las impuras son de más o menos cinco líneas cada
 * una y se prueban contra el navegador real.
 *
 * NO SE SUSCRIBE SOLO: el permiso se pide cuando el usuario lo pide (hay un
 * botón en la pantalla de cuenta). Pedir permiso al entrar, sin que nadie lo
 * haya pedido, es la mejor manera de que la gente lo rechace de entrada y
 * después no haya forma de volver a preguntar.
 */
import { supabase } from './supabase'

/** Soporta push: el navegador, el permiso y el SW tienen que estar. */
export function soportaPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'PushManager' in window &&
    'serviceWorker' in navigator
  )
}

/** El estado del permiso, o `null` si el equipo no soporta push. */
export function estadoPermiso(): NotificationPermission | null {
  if (!soportaPush()) return null
  return Notification.permission
}

/**
 * `base64url` → `Uint8Array`, que es lo que pide `applicationServerKey`.
 *
 * El push service recibe la clave pública en base64url (RFC 7515) y la API
 * del navegador pide los bytes crudos. Sin decodificarla, `subscribe`
 * devuelve un error de formato que no dice nada.
 */
export function clavePublicaABytes(clave: string): Uint8Array {
  const normalizada = clave.replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(normalizada)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

/** La clave pública VAPID, desde la env de build. */
export function clavePublicaVapid(): string {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''
}

/**
 * Lo que se guarda en `push_suscripciones` a partir de una suscripción.
 *
 * Es puro para poder probar el mapeo sin un PushSubscription de verdad: esa
 * clase no se puede fabricar en jsdom. `toJSON()` devuelve
 * `{ endpoint, keys: { p256dh, auth } }`, que es exactamente lo que pide la
 * tabla.
 */
export function filaDeSuscripcion(
  sub: { toJSON(): unknown },
  usuarioId: string
): {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  activa: boolean
  updated_at: string
} | null {
  // `toJSON()` en un navegador real siempre devuelve objeto, pero si algo
  // raro llega acá (un mock, una suscripción corrompida) se descarta en vez
  // de tirar una excepción que nadie va a leer.
  const crudo = sub.toJSON()
  if (!crudo || typeof crudo !== 'object') return null
  const json = crudo as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  const endpoint = typeof json.endpoint === 'string' ? json.endpoint : ''
  const p256dh = typeof json.keys?.p256dh === 'string' ? json.keys.p256dh : ''
  const auth = typeof json.keys?.auth === 'string' ? json.keys.auth : ''
  // Sin las tres piezas la suscripción no sirve para mandar: se descarta en
  // vez de guardar una fila que el servidor rechazaría al usarla.
  if (!endpoint || !p256dh || !auth) return null
  return {
    user_id: usuarioId,
    endpoint,
    p256dh,
    auth,
    activa: true,
    updated_at: new Date().toISOString()
  }
}

/**
 * El registro que se le manda al push service al suscribirse.
 *
 * `userVisibleOnly: true` es la promesa de que sólo se muestran
 * notificaciones que el usuario ve: no hay notificaciones silenciosas que
 * lleguen sin avisar. `applicationServerKey` es la clave pública VAPID, que
 * es la que permite al push service verificar que las vienen de nuestra app y
 * no de cualquiera.
 */
export function opcionesDeSuscripcion(clavePublica: string): PushSubscriptionOptionsInit {
  return {
    userVisibleOnly: true,
    applicationServerKey: clavePublicaABytes(clavePublica) as BufferSource
  }
}

/**
 * Pide el permiso y devuelve si quedó concedido.
 *
 * Devuelve `false` en los dos casos en que no hay nada que hacer: el equipo
 * no soporta push, o el usuario ya lo había rechazado antes (`denied` no se
 * puede volver a preguntar desde la app: sólo desde los ajustes del
 * navegador). En esos dos casos la pantalla lo dice en vez de dejar un botón
 * que no hace nada.
 */
export async function pedirPermiso(): Promise<boolean> {
  if (!soportaPush()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const resultado = await Notification.requestPermission()
  return resultado === 'granted'
}

/** La suscripción vigente del equipo, o null si no hay. */
export async function suscripcionActual(): Promise<PushSubscription | null> {
  if (!soportaPush()) return null
  const registro = await navigator.serviceWorker.ready
  return registro.pushManager.getSubscription()
}

/**
 * Suscribe el equipo y guarda la fila en el servidor.
 *
 * El orden importa: primero la suscripción con el navegador (que es la que
 * puede fallar por permiso o por red), y sólo si sale bien se guarda en la
 * base. Al revés se guardaría una fila que apunta a algo que el navegador
 * nunca confirmó.
 *
 * Si ya estaba suscrito, se reutiliza: `getSubscription()` devuelve la que ya
 * existe y se vuelve a guardar con `updated_at` nuevo, que es lo que alimenta
 * el podado de suscripciones viejas.
 */
export async function suscribirse(usuarioId: string): Promise<{ ok: boolean; motivo?: string }> {
  if (!soportaPush()) return { ok: false, motivo: 'sin-soporte' }
  if (!(await pedirPermiso())) return { ok: false, motivo: 'permiso-rechazado' }

  const clave = clavePublicaVapid()
  if (!clave) return { ok: false, motivo: 'sin-clave' }

  try {
    const registro = await navigator.serviceWorker.ready
    const existente = await registro.pushManager.getSubscription()
    const sub =
      existente ?? (await registro.pushManager.subscribe(opcionesDeSuscripcion(clave)))

    const fila = filaDeSuscripcion(sub, usuarioId)
    if (!fila) return { ok: false, motivo: 'suscripcion-incompleta' }

    // `endpoint` es único en la tabla: si el navegador rota la suscripción
    // llega un endpoint nuevo y el upsert crea la fila; si es la misma, sólo
    // refresca `updated_at`. Un fallo acá no deshace la suscripción local —
    // se reintenta en el próximo intento, y la suscripción sigue viva.
    const { error } = await supabase.from('push_suscripciones').upsert(fila, {
      onConflict: 'endpoint',
      ignoreDuplicates: false
    })
    if (error) return { ok: false, motivo: 'guardado-fallido' }
    return { ok: true }
  } catch {
    return { ok: false, motivo: 'error-desconocido' }
  }
}

/**
 * Apaga las notificaciones sin pedir permiso de nuevo.
 *
 * Sólo se marca `activa = false`: la suscripción con el navegador se queda,
 * así que re-encender es un update y no otra ronda de permisos. Es la
 * diferencia entre "no quiero ruido" y "no quiero la app".
 */
export async function silenciar(usuarioId: string): Promise<void> {
  await supabase
    .from('push_suscripciones')
    .update({ activa: false, updated_at: new Date().toISOString() })
    .eq('user_id', usuarioId)
    .eq('activa', true)
}

/** Vuelve a encender las notificaciones del equipo. */
export async function reactivar(usuarioId: string): Promise<void> {
  await supabase
    .from('push_suscripciones')
    .update({ activa: true, updated_at: new Date().toISOString() })
    .eq('user_id', usuarioId)
}
