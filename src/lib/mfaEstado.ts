/**
 * Cache de "¿esta cuenta necesita verificación en dos pasos?".
 *
 * Esa pregunta se responde con `getAuthenticatorAssuranceLevel`, que internamente
 * hace un `GET /auth/v1/user`. Es un dato que no cambia en cada carga: depende
 * de si la cuenta tiene un factor TOTP verificado, no de la sesión ni del reloj.
 *
 * El problema es que ese endpoint es el más lento de los que toca la app (se ha
 * medido con TTFB de 9 s y sin respuesta nunca, frente a ~0.2 s en /auth/v1/health).
 * Como el arranque lo esperaba en cadena antes de pintar, cada recarga pagaba esa
 * espera. Cachearlo lo deja sin red en el camino normal.
 *
 * Se invalida explícitamente en los tres momentos en que el dato puede cambiar
 * desde este dispositivo (enrolar, verificar y desactivar el TOTP) y al cerrar
 * sesión. El TTL acota el caso restante: enrolar o desactivar MFA desde OTRO
 * dispositivo no se puede detectar aquí, así que el valor caduca a las 4 h.
 */

const KEY = 'evaluxor.mfa'
const TTL_MS = 4 * 60 * 60_000

/**
 * Generación de la caché: sube en cada `limpiarMfaCache`.
 *
 * Sirve para descartar RESPUESTAS VIEJAS. Un `procesarSesion` que arrancó
 * ANTES de que se tire la caché (los eventos de auth que dispara el
 * `challengeAndVerify`, p. ej.) termina DESPUÉS, con un veredicto calculado
 * sobre datos que ya no existen: aplicarlo reabría el paso de dos factores
 * con la sesión ya verificada. Quien captura la generación al arrancar y la
 * vuelve a mirar al aplicar sabe que su resultado quedó viejo y lo tira.
 */
let generacion = 0

/** La generación actual de la caché, para comparar con la capturada al arrancar. */
export function generacionMfa(): number {
  return generacion
}

interface EntradaMfa {
  /** Id del usuario al que pertenece la respuesta. */
  usuario: string
  /** true = la sesión está en aal1 y la cuenta exige aal2 (falta el TOTP). */
  pendiente: boolean
  /** Cuándo se guardó, para aplicar el TTL. */
  t: number
}

/**
 * Devuelve el estado cacheado de la cuenta, o `null` si no hay nada guardado,
 * es de otro usuario o venció el TTL. `null` significa "hay que preguntarle a
 * Supabase", nunca "no hace falta MFA".
 */
export function leerMfaCache(usuario: string | undefined | null): boolean | null {
  if (!usuario) return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const e = JSON.parse(raw) as EntradaMfa
    if (!e || e.usuario !== usuario) return null
    if (Date.now() - e.t > TTL_MS) return null
    return e.pendiente === true
  } catch {
    return null
  }
}

/** Guarda el resultado de la comprobación contra Supabase. */
export function guardarMfaCache(usuario: string | undefined | null, pendiente: boolean): void {
  if (!usuario) return
  try {
    const e: EntradaMfa = { usuario, pendiente, t: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(e))
  } catch {
    // Sin espacio o en modo privado: se sigue preguntando cada carga.
  }
}

/**
 * Tira la caché. Se llama cuando el estado pudo cambiar (enrolar, verificar o
 * desactivar TOTP) o cuando la sesión se cierra, para que el próximo usuario
 * que entre en este navegador no herede el dato de otro.
 */
export function limpiarMfaCache(): void {
  // Se marca ANTES de tirar el dato: aunque localStorage falle, a partir de
  // acá cualquier cálculo previo se considera viejo.
  generacion += 1
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Sin localStorage no hay nada que tirar.
  }
}