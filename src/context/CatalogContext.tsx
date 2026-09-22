import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Modulo, Item, Sucursal, Asignacion, AsignacionModulo, SucursalModulo, SucursalItem } from '../lib/types'
import { obtenerCacheLocal, refrescarCatalogo } from '../lib/data/catalog'
import { useAuth } from './AuthContext'

interface CatalogContextValue {
  modulos: Modulo[]
  items: Item[]
  sucursales: Sucursal[]
  asignaciones: Asignacion[]
  asignacionesModulos: AsignacionModulo[]
  sucursalModulos: SucursalModulo[]
  sucursalItems: SucursalItem[]
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
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [asignacionesModulos, setAsignacionesModulos] = useState<AsignacionModulo[]>([])
  const [sucursalModulos, setSucursalModulos] = useState<SucursalModulo[]>([])
  const [sucursalItems, setSucursalItems] = useState<SucursalItem[]>([])
  const [cargado, setCargado] = useState(false)
  const [cacheFecha, setCacheFecha] = useState<number | null>(null)

  async function refresh() {
    if (!profile) return
    try {
      const data = await refrescarCatalogo(profile.id)
      setModulos(data.modulos)
      setItems(data.items)
      setSucursales(data.sucursales)
      setAsignaciones(data.asignaciones)
      setAsignacionesModulos(data.asignacionesModulos)
      setSucursalModulos(data.sucursalModulos)
      setSucursalItems(data.sucursalItems)
      setCacheFecha(data.updated_at)
      setCargado(true)
    } catch {
      const local = await obtenerCacheLocal()
      if (local) {
        setModulos(local.modulos)
        setItems(local.items)
        setSucursales(local.sucursales)
        setAsignaciones(local.asignaciones)
        setAsignacionesModulos(local.asignacionesModulos ?? [])
        setSucursalModulos(local.sucursalModulos ?? [])
        setSucursalItems(local.sucursalItems ?? [])
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
        setAsignaciones(local.asignaciones)
        setAsignacionesModulos(local.asignacionesModulos ?? [])
        setSucursalModulos(local.sucursalModulos ?? [])
        setSucursalItems(local.sucursalItems ?? [])
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
    asignaciones,
    asignacionesModulos,
    sucursalModulos,
    sucursalItems,
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

export function useModulosActivos(sucursalId?: string | null): { modulosActivos: Modulo[]; itemsDe: (m: Modulo) => Item[] } {
  const { modulos, items, asignacionesModulos, sucursalModulos, sucursalItems } = useCatalog()
  const { profile } = useAuth()
  const activos = modulos.filter((m) => m.activo)
  const idsAsignados = asignacionesModulos.filter((a) => a.activa).map((a) => a.modulo_id)
  let visibles = profile?.rol === 'EVALUADOR' ? activos.filter((m) => idsAsignados.includes(m.id)) : activos
  if (sucursalId) {
    const idsConfig = sucursalModulos.filter((a) => a.activa && a.sucursal_id === sucursalId).map((a) => a.modulo_id)
    if (idsConfig.length) visibles = visibles.filter((m) => idsConfig.includes(m.id))
  }
  return {
    modulosActivos: visibles,
    itemsDe: (m) => {
      const base = items.filter((i) => i.modulo_id === m.id && i.activo).sort((a, b) => a.orden - b.orden)
      if (!sucursalId) return base
      const idsConfig = sucursalItems.filter((a) => a.activa && a.sucursal_id === sucursalId).map((a) => a.item_id)
      return idsConfig.length ? base.filter((i) => idsConfig.includes(i.id)) : base
    }
  }
}