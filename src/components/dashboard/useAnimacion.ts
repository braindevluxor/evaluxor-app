import { useEffect, useState } from 'react'

/**
 * true después del primer frame en el navegador, para disparar transiciones CSS
 * (los elementos se pintan en su estado inicial y luego animan hacia el final).
 * Durante renderizado fuera del navegador (tests / SSR) devuelve true, de modo
 * que el marcado ya incluya los valores finales.
 */
export function useAnimacionActiva(): boolean {
  const [activa, setActiva] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setActiva(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return typeof window === 'undefined' ? true : activa
}

/** Duración y curva compartidas por las animaciones de los medidores. */
export const TRANSICION = `900ms cubic-bezier(0.22, 1, 0.36, 1)`

/**
 * Número que anima de 0 hasta `valor` (ease-out, 900ms). Fuera del navegador
 * queda directamente en `valor`; con `valor === null` devuelve null.
 */
export function useNumeroAnimado(valor: number | null, ms = 900): number | null {
  const [numero, setNumero] = useState<number | null>(
    valor == null ? null : typeof window === 'undefined' ? valor : 0
  )
  useEffect(() => {
    if (valor == null) {
      setNumero(null)
      return
    }
    let raf = 0
    let terminado = false
    const inicio = performance.now()
    const paso = (t: number) => {
      if (terminado) return
      const p = Math.min(1, (t - inicio) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setNumero(valor * eased)
      if (p < 1 && typeof window !== 'undefined') raf = requestAnimationFrame(paso)
    }
    raf = typeof window !== 'undefined' ? requestAnimationFrame(paso) : 0
    return () => {
      terminado = true
      if (raf) cancelAnimationFrame(raf)
    }
  }, [valor, ms])
  return valor == null ? null : numero
}