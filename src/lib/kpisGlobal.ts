import { useEffect, useState } from 'react'

export interface EstadoKpis {
  global: number | null
  completadas: number
  cobertura: number
  incumplimientos: number
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