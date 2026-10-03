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
 * Nunca es 100. Ese número solo puede ponerlo la consulta que terminó de
 * verdad, y para entonces la barra ya se fue: si el automático llegara al 100%
 * antes, el usuario vería "listo" y la lista sin aparecer, que es peor que una
 * barra que se queda cerca del final.
 */
export const TECHO_INDETERMINADO = 88

/** Arranque bajo a propósito. Arrancar en 40% se lee como que algo ya pasó. */
export const INICIO_INDETERMINADO = 14

/**
 * El siguiente punto del avance automático.
 *
 * Crece con el 6% de lo que falta, así que se frena solo al acercarse: si
 * avanzara parejo se notaría el frenazo de golpe. El mínimo de 0.7 es lo que
 * termina posando la barra en el techo, donde queda esperando — que es lo
 * buscado, porque el techo está por debajo de 100 justamente para que quedarse
 * ahí no parezca que terminó.
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

/** El mensaje que corresponde al avance. */
export function mensajeDe(avance: number, techo?: number): string {
  return PASOS_CARGA[indicePaso(avance, techo)] ?? PASOS_CARGA[0]
}

/**
 * Avance animado para una espera de duración desconocida.
 *
 * `activo` en true hace correr el reloj; en false, el avance vuelve al inicio
 * para que la próxima espera no arranque en el punto donde quedó la anterior.
 */
export function useProgresoCarga(activo: boolean, opciones?: { inicio?: number; techo?: number; cadaMs?: number }) {
  const inicio = opciones?.inicio ?? INICIO_INDETERMINADO
  const techo = opciones?.techo ?? TECHO_INDETERMINADO
  const cadaMs = opciones?.cadaMs ?? 110
  const [avance, setAvance] = useState(inicio)

  useEffect(() => {
    if (!activo) {
      // Al apagar también se reinicia. Si no, la espera siguiente arrancaría en
      // el 80% en el que quedó esta y parecería que ya venía casi hecha.
      setAvance(inicio)
      return
    }
    const t = setInterval(() => setAvance((v) => avanceSiguiente(v, techo)), cadaMs)
    return () => clearInterval(t)
  }, [activo, inicio, techo, cadaMs])

  return { avance, mensaje: mensajeDe(avance, techo) }
}