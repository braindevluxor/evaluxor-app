import { useEffect, useState } from 'react'

/** Claves de icono soportadas por la franja azul de KPIs (BarraKpis). */
export type IconoKpi = 'calendario' | 'check' | 'store' | 'target' | 'alerta' | 'lista' | 'badge'

export interface ItemKpi {
  etiqueta: string
  valor: string | number | null
  icono: IconoKpi
}

export interface EstadoKpis {
  global: number | null
  completadas: number
  cobertura: number
  incumplimientos: number
  /** Cuando viene definido, la franja azul muestra estos ítems en lugar de los 4 KPIs estándar. */
  items?: ItemKpi[]
}

let actual: EstadoKpis | null = null
const suscriptores = new Set<(e: EstadoKpis | null) => void>()

export function setKpisGlobal(e: EstadoKpis | null): void {
  actual = e
  for (const f of suscriptores) f(e)
}

export function useKpisGlobal(): EstadoKpis | null {
  const [estado, setEstado] = useState<EstadoKpis | null>(actual)
  useEffect(() => {
    suscriptores.add(setEstado)
    return () => {
      suscriptores.delete(setEstado)
    }
  }, [])
  return estado
}