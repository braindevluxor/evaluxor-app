/**
 * Avisos flotantes, en un canal aparte de cualquier pantalla.
 *
 * No hay provider: quien avisa puede estar en el fondo de un `useCallback` o en
 * un helper plano, y el cartel lo pinta un único host montado en `App`. Así
 * ninguna pantalla tiene que saber que los avisos existen.
 *
 * Un aviso reemplaza al anterior —dos toques seguidos nunca apilan dos
 * carteles— y cada uno lleva su `clave` para que el host sepa cuándo se pintó
 * y cuándo apagarlo sin que un aviso viejo apague a uno nuevo.
 */
export type TonoAviso = 'ok' | 'error'

export interface Aviso {
  clave: number
  texto: string
  tono: TonoAviso
}

type Oyente = (aviso: Aviso) => void

const oyentes = new Set<Oyente>()
let ultimaClave = 0

/**
 * Muestra un aviso. Si no hay nadie escuchando (p. ej. en una prueba que sólo
 * renderiza un componente) no pasa nada: avisar nunca es motivo de error.
 */
export function avisar(texto: string, tono: TonoAviso = 'ok'): void {
  ultimaClave += 1
  const aviso: Aviso = { clave: ultimaClave, texto, tono }
  // Se itera sobre una copia: un oyente que se dé de baja a sí mismo dentro del
  // callback no debería tumbar la vuelta.
  for (const oyente of [...oyentes]) oyente(aviso)
}

/** Deja de recibir avisos. Devuelve la baja para usarla en un `useEffect`. */
export function suscribirAvisos(oyente: Oyente): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}
