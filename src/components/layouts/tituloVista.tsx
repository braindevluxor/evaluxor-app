import { createContext, useContext, useEffect } from 'react'

export interface TituloVista {
  titulo: string
  subtitulo?: string
}

export const TituloVistaContext = createContext<{
  setTitulo: (t: TituloVista | null) => void
} | null>(null)

export function useTituloVista(titulo: string, subtitulo?: string) {
  const ctx = useContext(TituloVistaContext)
  useEffect(() => {
    if (!ctx) return
    ctx.setTitulo({ titulo, subtitulo })
    return () => ctx.setTitulo(null)
  }, [titulo, subtitulo, ctx])
}