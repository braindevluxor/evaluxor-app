import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Modulo, Item, Sucursal, Asignacion, Departamento } from '../lib/types'
import { obtenerCacheLocal, refrescarCatalogo } from '../lib/data/catalog'
import { useAuth } from './AuthContext'

interface CatalogContextValue {
  modulos: Modulo[]
  items: Item[]
  sucursales: Sucursal[]
  departamentos: Departamento[]
  asignaciones: Asignacion[]
  cargado: boolean
  cacheFecha: number | null
  refresh: () => Promise<void>
}

const CatalogContext = createContext<CatalogContextValue | null>(null)

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [departamentos, setDepartamentos] = useState<Departamento[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [cargado, setCargado] = useState(false)
  const [cacheFecha, setCacheFecha] = useState<number | null>(null)

  async function refresh() {
    if (!profile) return
    try {
      const data = await refrescarCatalogo(profile.id)
      setModulos(data.modulos)
      setItems(data.items)
      setSucursales(data.sucursales)
      setDepartamentos(data.departamentos)
      setAsignaciones(data.asignaciones)
      setCacheFecha(data.updated_at)
      setCargado(true)
    } catch {
      const local = await obtenerCacheLocal()
      if (local) {
        setModulos(local.modulos)
        setItems(local.items)
        setSucursales(local.sucursales)
        setDepartamentos(local.departamentos ?? [])
        setAsignaciones(local.asignaciones)
        setCacheFecha(local.updated_at)
      }
      setCargado(true)
    }
  }

  useEffect(() => {
    if (!profile) return
    void (async () => {
      const local = await obtenerCacheLocal()
      if (local) {
        setModulos(local.modulos)
        setItems(local.items)
        setSucursales(local.sucursales)
        setDepartamentos(local.departamentos ?? [])
        setAsignaciones(local.asignaciones)
        setCacheFecha(local.updated_at)
        setCargado(true)
      }
      void refresh()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const value: CatalogContextValue = {
    modulos,
    items,
    sucursales,
    departamentos,
    asignaciones,
    cargado,
    cacheFecha,
    refresh
  }

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog debe usarse dentro de CatalogProvider')
  return ctx
}

export function useModulosActivos(): { modulosActivos: Modulo[]; itemsDe: (m: Modulo) => Item[] } {
  const { modulos, items } = useCatalog()
  const activos = modulos.filter((m) => m.activo)
  return {
    modulosActivos: activos,
    itemsDe: (m) => items.filter((i) => i.modulo_id === m.id && i.activo).sort((a, b) => a.orden - b.orden)
  }
}