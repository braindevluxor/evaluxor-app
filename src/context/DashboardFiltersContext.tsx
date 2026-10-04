import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'

interface DashboardFiltersContextValue {
  abierto: boolean
  alternar: () => void
}

const DashboardFiltersContext = createContext<DashboardFiltersContextValue | null>(null)

export function DashboardFiltersProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    setAbierto(false)
  }, [pathname])

  const value = {
    abierto,
    alternar: () => setAbierto((actual) => !actual)
  }

  return <DashboardFiltersContext.Provider value={value}>{children}</DashboardFiltersContext.Provider>
}

export function useDashboardFilters(): DashboardFiltersContextValue {
  const contexto = useContext(DashboardFiltersContext)
  if (!contexto) throw new Error('useDashboardFilters debe usarse dentro de DashboardFiltersProvider')
  return contexto
}

export function DashboardFiltersPortal({ children }: { children: ReactNode }) {
  const { abierto } = useDashboardFilters()
  const [destino, setDestino] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setDestino(document.getElementById('dashboard-filters-panel'))
  }, [])

  if (!abierto || !destino) return null
  return createPortal(<div className="mx-auto max-h-[70vh] max-w-7xl overflow-y-auto px-4 py-4 lg:px-8">{children}</div>, destino)
}
