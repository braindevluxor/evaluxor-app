import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Modulo, Item, Sucursal, Departamento, Asignacion, AsignacionModulo, SucursalModulo, SucursalItem, SucursalOpcion, DepartamentoModulo, DepartamentoItem, DepartamentoOpcion } from '../lib/types'
import { obtenerCacheLocal, refrescarCatalogo } from '../lib/data/catalog'
import { useAuth } from './AuthContext'

interface CatalogContextValue {
  modulos: Modulo[]
  items: Item[]
  sucursales: Sucursal[]
  /** Departamentos centralizados activos (Mercadeo, Taller, Talento Humano…). */
  departamentos: Departamento[]
  asignaciones: Asignacion[]
  asignacionesModulos: AsignacionModulo[]
  sucursalModulos: SucursalModulo[]
  sucursalItems: SucursalItem[]
  sucursalOpciones: SucursalOpcion[]
  /** Config de módulos/ítems/opciones por departamento: mismas reglas que las de sucursal. */
  departamentoModulos: DepartamentoModulo[]
  departamentoItems: DepartamentoItem[]
  departamentoOpciones: DepartamentoOpcion[]
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
  const [asignacionesModulos, setAsignacionesModulos] = useState<AsignacionModulo[]>([])
  const [sucursalModulos, setSucursalModulos] = useState<SucursalModulo[]>([])
  const [sucursalItems, setSucursalItems] = useState<SucursalItem[]>([])
  const [sucursalOpciones, setSucursalOpciones] = useState<SucursalOpcion[]>([])
  const [departamentoModulos, setDepartamentoModulos] = useState<DepartamentoModulo[]>([])
  const [departamentoItems, setDepartamentoItems] = useState<DepartamentoItem[]>([])
  const [departamentoOpciones, setDepartamentoOpciones] = useState<DepartamentoOpcion[]>([])
  const [cargado, setCargado] = useState(false)
  const [cacheFecha, setCacheFecha] = useState<number | null>(null)

  async function refresh() {
    if (!profile) return
    try {
      const data = await refrescarCatalogo(profile.id)
      setModulos(data.modulos)
      setItems(data.items)
      setSucursales(data.sucursales)
      setDepartamentos(data.departamentos ?? [])
      setAsignaciones(data.asignaciones)
      setAsignacionesModulos(data.asignacionesModulos)
      setSucursalModulos(data.sucursalModulos)
      setSucursalItems(data.sucursalItems)
      setSucursalOpciones(data.sucursalOpciones)
      setDepartamentoModulos(data.departamentoModulos ?? [])
      setDepartamentoItems(data.departamentoItems ?? [])
      setDepartamentoOpciones(data.departamentoOpciones ?? [])
      setCacheFecha(data.updated_at)
      setCargado(true)
    } catch {
      try {
        const local = await obtenerCacheLocal()
        if (local) {
          setModulos(local.modulos)
          setItems(local.items)
          setSucursales(local.sucursales)
          setDepartamentos(local.departamentos ?? [])
          setAsignaciones(local.asignaciones)
          setAsignacionesModulos(local.asignacionesModulos ?? [])
          setSucursalModulos(local.sucursalModulos ?? [])
          setSucursalItems(local.sucursalItems ?? [])
          setSucursalOpciones(local.sucursalOpciones ?? [])
          setDepartamentoModulos(local.departamentoModulos ?? [])
          setDepartamentoItems(local.departamentoItems ?? [])
          setDepartamentoOpciones(local.departamentoOpciones ?? [])
          setCacheFecha(local.updated_at)
        }
      } catch {
        // Sin cache legible: la app sigue con listas vacías hasta la próxima.
      }
      setCargado(true)
    }
  }

  useEffect(() => {
    if (!profile) return
    void (async () => {
      try {
        const local = await obtenerCacheLocal()
        if (local) {
          setModulos(local.modulos)
          setItems(local.items)
          setSucursales(local.sucursales)
          setDepartamentos(local.departamentos ?? [])
          setAsignaciones(local.asignaciones)
          setAsignacionesModulos(local.asignacionesModulos ?? [])
          setSucursalModulos(local.sucursalModulos ?? [])
          setSucursalItems(local.sucursalItems ?? [])
          setSucursalOpciones(local.sucursalOpciones ?? [])
          setDepartamentoModulos(local.departamentoModulos ?? [])
          setDepartamentoItems(local.departamentoItems ?? [])
          setDepartamentoOpciones(local.departamentoOpciones ?? [])
          setCacheFecha(local.updated_at)
          setCargado(true)
        }
      } catch {
        // Cache ilegible (p. ej. VersionError de IndexedDB): no bloquea la app;
        // seguimos y baja el catálogo del servidor.
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
    asignacionesModulos,
    sucursalModulos,
    sucursalItems,
    sucursalOpciones,
    departamentoModulos,
    departamentoItems,
    departamentoOpciones,
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

/**
 * Módulo-herramienta por su marca (`modulos.herramienta`), ej.
 * `useModuloHerramienta('REVISION_PRE_ENTREGA')`.
 *
 * Vive aparte de `useModulosActivos` a propósito: la herramienta no forma parte
 * de la evaluación ni puntúa, pero sí se configura desde Ítems de evaluación.
 * Devuelve `modulo: null` mientras el catálogo no lo trae (o si el Líder no lo
 * ha creado todavía).
 */
export function useModuloHerramienta(clave: string): { modulo: Modulo | null; items: Item[] } {
  const { modulos, items } = useCatalog()
  const modulo = modulos.find((m) => m.herramienta === clave && m.activo) ?? null
  if (!modulo) return { modulo: null, items: [] }
  return {
    modulo,
    items: items
      .filter((i) => i.modulo_id === modulo.id && i.activo)
      .sort((a, b) => a.orden - b.orden)
  }
}

/**
 * Módulos/ítems/puntos que aplican en una UNIDAD: una sucursal o un
 * departamento centralizado.
 *
 * Las dos unidades tienen su propia configuración (`sucursal_modulos/_items/
 * _opciones` y `departamento_*`) y la misma regla: si la unidad no tiene filas
 * activas le aplican todas; si tiene, solo las marcadas. Por eso el hook toma
 * los dos ids y lee las tablas que correspondan.
 */
export function useModulosActivos(
  sucursalId?: string | null,
  departamentoId?: string | null
): { modulosActivos: Modulo[]; itemsDe: (m: Modulo) => Item[] } {
  const {
    modulos, items, asignacionesModulos,
    sucursalModulos, sucursalItems, sucursalOpciones,
    departamentoModulos, departamentoItems, departamentoOpciones
  } = useCatalog()
  const { profile } = useAuth()
  const activos = modulos.filter((m) => m.activo && !m.herramienta)
  const idsAsignados = asignacionesModulos.filter((a) => a.activa).map((a) => a.modulo_id)
  let visibles = profile?.rol === 'EVALUADOR' ? activos.filter((m) => idsAsignados.includes(m.id)) : activos
  // La unidad que se está evaluando, y su configuración (una u otra tabla).
  const unidad = departamentoId ?? sucursalId ?? null
  const idsModulosConf = departamentoId
    ? departamentoModulos.filter((a) => a.activa && a.departamento_id === departamentoId).map((a) => a.modulo_id)
    : sucursalId
      ? sucursalModulos.filter((a) => a.activa && a.sucursal_id === sucursalId).map((a) => a.modulo_id)
      : []
  const idsItemsConf = departamentoId
    ? departamentoItems.filter((a) => a.activa && a.departamento_id === departamentoId).map((a) => a.item_id)
    : sucursalId
      ? sucursalItems.filter((a) => a.activa && a.sucursal_id === sucursalId).map((a) => a.item_id)
      : []
  const opcionesUnidad = departamentoId
    ? departamentoOpciones.filter((a) => a.activa && a.departamento_id === departamentoId)
    : sucursalId
      ? sucursalOpciones.filter((a) => a.activa && a.sucursal_id === sucursalId)
      : []
  if (idsModulosConf.length) {
    if (profile?.rol === 'EVALUADOR') {
      visibles = visibles.filter((m) => idsModulosConf.includes(m.id))
    } else {
      const validos = idsModulosConf.filter((id) => activos.some((m) => m.id === id))
      visibles = validos.length ? visibles.filter((m) => validos.includes(m.id)) : visibles
    }
  }
  return {
    modulosActivos: visibles,
    itemsDe: (m) => {
      const base = items.filter((i) => i.modulo_id === m.id && i.activo).sort((a, b) => a.orden - b.orden)
      if (!unidad) return base
      let filtrados = base
      if (idsItemsConf.length) {
        if (profile?.rol === 'EVALUADOR') {
          filtrados = base.filter((i) => idsItemsConf.includes(i.id))
        } else {
          const validos = idsItemsConf.filter((id) => base.some((i) => i.id === id))
          filtrados = validos.length ? base.filter((i) => validos.includes(i.id)) : base
        }
      }
      const setItems = new Set(idsItemsConf)
      return filtrados.map((i) => {
        if (!setItems.has(i.id)) return i
        const aplicaId = opcionesUnidad.filter((o) => o.item_id === i.id).map((o) => o.opcion_id)
        if (!i.opciones?.length || !aplicaId.length) return i
        return { ...i, opciones: i.opciones.filter((o) => aplicaId.includes(o.id)) }
      })
    }
  }
}