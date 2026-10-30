import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Lleva una acción de una página a la barra superior de la consola, junto al
 * botón «Filtros».
 *
 * La barra la pinta `ConsoleLayout` y no conoce las páginas que cuelgan
 * debajo, así que deja un hueco (`#acciones-vista`) y cada vista se cuelga de
 * él por portal —el mismo truco que `DashboardFiltersPortal` con el panel de
 * filtros. Hoy lo usan el Historial (aperturar evaluación) y Unidades (selector
 * de Sucursales/Departamentos y el botón «+ Nueva», que viven en páginas
 * distintas y aun así quedan en ese orden: el padre se monta antes que el
 * hijo).
 *
 * Los modales no hace falta portalar: `Modal` ya se monta solo en
 * `document.body`.
 */
export function PortalCabecera({ children }: { children: ReactNode }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setDestino(document.getElementById('acciones-vista'))
  }, [])

  if (!destino) return null
  return createPortal(children, destino)
}
