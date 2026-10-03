import { useEffect, useState } from 'react'

/**
 * Los mensajes de la barra mientras se arma la lista de trabajadores.
 *
 * Un texto fijo ("Consultando colaboradores…") dice que algo pasa pero no que
 * esté avanzando. Estos tres van marcando por dónde va la carga, que es lo que
 * hace que una espera de medio segundo no se sienta como que la app se clavó.
 *
 * No son literales de lo que el código hace: son los tres tramos en que se puede
 * partir la espera, que es lo único que se puede decir sin conocer de antemano
 * cuánto va a tardar la consulta.
 */
export const PASOS_CARGA = [
  'Creando la consulta…',
  'Depurando los registros…',
  'Validando los ajustes finales…'
] as const

/**
 * Techo del avance automático.
 *
 * No es 100. Mientras hay trabajo real de verdad, el automático no puede llegar
 * al final: si lo hiciera, el usuario vería la barra completa con la lista sin
 * aparecer, que se lee como que la app terminó y no terminó. El 100 lo pone
 * `AVANCE_FINAL`, y solo cuando la consulta ya terminó.
 */
export const TECHO_INDETERMINADO = 88

/** Arranque bajo a propósito. Arrancar en 40% se lee como que algo ya pasó. */
export const INICIO_INDETERMINADO = 14

/** El 100% de verdad: solo lo alcanza la barra cuando el trabajo terminó. */
export const AVANCE_FINAL = 100

/** Cuánto se queda la barra llena antes de dar lugar a la lista. */
export const PAUSA_FINAL_MS = 300

/**
 * El siguiente punto del avance automático.
 *
 * Crece con el 6% de lo que falta, así que se frena solo al acercarse: si
 * avanzara parejo se notaría el frenazo de golpe. El mínimo de 0.7 es lo que
 * termina posando la barra en el techo, donde queda esperando. Ahí no dice
 * nada: solo espera a que la consulta responda.
 */
export function avanceSiguiente(actual: number, techo: number = TECHO_INDETERMINADO): number {
  if (actual >= techo) return techo
  const falta = techo - actual
  return actual + Math.min(Math.max(falta * 0.06, 0.7), falta)
}

/** En qué tramo del recorrido cae el avance: los tres mensajes se lo reparten. */
export function indicePaso(avance: number, techo: number = TECHO_INDETERMINADO): number {
  if (techo <= 0) return 0
  const pct = avance / techo
  if (pct < 0.34) return 0
  if (pct < 0.72) return 1
  return 2
}

/**
 * Las tres fases de la barra.
 *
 * - `inactiva`: no hay nada que esperar. No se muestra.
 * - `corriendo`: el trabajo real está en vuelo y el avance es automático.
 * - `terminando`: el trabajo real ya terminó; la barra se llenó y espera un
 *   instante antes de dejar lugar a la lista.
 */
export type FaseBarra = 'inactiva' | 'corriendo' | 'terminando'

export interface EstadoBarra {
  fase: FaseBarra
  avance: number
}

/** Tick del reloj. No hace nada fuera de `corriendo`. */
export function avanzar(estado: EstadoBarra, techo: number): EstadoBarra {
  if (estado.fase !== 'corriendo') return estado
  const siguiente = avanceSiguiente(estado.avance, techo)
  if (siguiente === estado.avance) return estado
  return { ...estado, avance: siguiente }
}

/**
 * Cambio de `activo`.
 *
 * Acá es donde el 100% aparece, y solo aparece por el camino de `activo === false`:
 * el trabajo real ya terminó, así que la barra llena de verdad. Si el reloj
 * llegara al 100 antes, el usuario vería "listo" con la lista sin aparecer.
 *
 * Vuelve el mismo objeto cuando no hay cambio, para no ensuciar el render.
 */
export function cambiarActivo(estado: EstadoBarra, activo: boolean, inicio: number): EstadoBarra {
  if (activo) {
    if (estado.fase === 'corriendo') return estado
    // Se vuelve a arrancar desde el principio: si veníamos de una barra llena,
    // seguir desde 100% haría que la espera siguiente arranque terminada.
    return { fase: 'corriendo', avance: inicio }
  }
  if (estado.fase !== 'corriendo') return estado
  return { fase: 'terminando', avance: AVANCE_FINAL }
}

/** Se pasó la pausa final: la barra se va y la lista entra. */
export function terminar(estado: EstadoBarra, inicio: number): EstadoBarra {
  if (estado.fase !== 'terminando') return estado
  return { fase: 'inactiva', avance: inicio }
}

/** El mensaje que corresponde al avance. */
export function mensajeDe(avance: number, techo?: number): string {
  return PASOS_CARGA[indicePaso(avance, techo)] ?? PASOS_CARGA[0]
}

/**
 * Avance animado para una espera de duración desconocida.
 *
 * `visible` es lo que hay que mirar para decidir si se dibuja la barra. No es
 * `activo`: cuando el trabajo termina, `activo` ya es falso pero la barra sigue
 * visible un instante, llena, antes de que entre la lista.
 *
 * El estado inicial sale de `activo` en el inicializador del `useState` y no en
 * un efecto a propósito. Con un efecto, el primer render de la lista guardada
 * sería la lista entera —el flash que esto vino a tapar—, porque el efecto
 * todavía no corrió.
 */
export function useProgresoCarga(activo: boolean, opciones?: { inicio?: number; techo?: number; cadaMs?: number; pausaMs?: number }) {
  const inicio = opciones?.inicio ?? INICIO_INDETERMINADO
  const techo = opciones?.techo ?? TECHO_INDETERMINADO
  const cadaMs = opciones?.cadaMs ?? 110
  const pausaMs = opciones?.pausaMs ?? PAUSA_FINAL_MS
  const [estado, setEstado] = useState<EstadoBarra>(() => ({
    fase: activo ? 'corriendo' : 'inactiva',
    avance: inicio
  }))

  useEffect(() => {
    setEstado((e) => cambiarActivo(e, activo, inicio))
  }, [activo, inicio])

  useEffect(() => {
    if (estado.fase === 'corriendo') {
      const t = setInterval(() => setEstado((e) => avanzar(e, techo)), cadaMs)
      return () => clearInterval(t)
    }
    if (estado.fase === 'terminando') {
      // Sin mensaje en la fase final: ya no hay nada que ir contando y una
      // etiqueta "validando…" mientras ya terminó sería mentira.
      const t = setTimeout(() => setEstado((e) => terminar(e, inicio)), pausaMs)
      return () => clearTimeout(t)
    }
    return undefined
  }, [estado.fase, techo, cadaMs, pausaMs, inicio])

  return {
    avance: estado.avance,
    visible: estado.fase !== 'inactiva',
    mensaje: estado.fase === 'terminando' ? null : mensajeDe(estado.avance, techo)
  }
}