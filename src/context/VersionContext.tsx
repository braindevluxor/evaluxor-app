import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { RefreshCw, X } from 'lucide-react'
import { useOffline } from './OfflineContext'
import { cn } from '../components/ui'
import { limpiarCacheCatalogo } from '../lib/offline/db'
import {
  consultarVersionRemota,
  esBuildDistinta,
  esPantallaDeTrabajo,
  versionCorta,
  type VersionBuild
} from '../lib/version'

/** Cada cuánto se le pregunta al servidor si hay una build nueva. */
const INTERVALO_CHECQUEO = 10 * 60_000

interface VersionContextValue {
  /** Build publicada en el servidor, si se pudo leer. */
  versionRemota: VersionBuild | null
  /** Hay una build distinta a la que está corriendo este dispositivo. */
  hayActualizacion: boolean
  actualizando: boolean
  /** El usuario pateó la actualización por ahora. */
  descartada: boolean
  /** Pide la build nueva, limpia el catálogo y recarga. */
  actualizarAhora: () => Promise<void>
  descartar: () => void
}

const VersionContext = createContext<VersionContextValue | null>(null)

const SIN_PROVEEDOR: VersionContextValue = {
  versionRemota: null,
  hayActualizacion: false,
  actualizando: false,
  descartada: false,
  actualizarAhora: async () => undefined,
  descartar: () => undefined
}

export function VersionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { pendientes } = useOffline()
  const [versionRemota, setVersionRemota] = useState<VersionBuild | null>(null)
  const [actualizando, setActualizando] = useState(false)
  const [descartada, setDescartada] = useState(false)

  const chequear = useCallback(async () => {
    const v = await consultarVersionRemota()
    if (v) setVersionRemota(v)
  }, [])

  useEffect(() => {
    void chequear()
    const iv = window.setInterval(() => void chequear(), INTERVALO_CHECQUEO)
    // Volver a la app (el teléfono saliendo de segundo plano) es el mejor momento
    // para enterarse de que hay versión nueva.
    const alVolver = () => {
      if (document.visibilityState === 'visible') void chequear()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.clearInterval(iv)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [chequear])

  const hayActualizacion = esBuildDistinta(versionRemota)

  const actualizarAhora = useCallback(async () => {
    if (actualizando) return
    setActualizando(true)
    try {
      // Pide el service worker nuevo y espera a que tome el control. Con
      // `skipWaiting` + `clientsClaim` (vite-plugin-pwa) el cambio es inmediato.
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.()
        if (regs?.length) {
          await Promise.all(regs.map((r) => r.update().catch(() => undefined)))
          await new Promise<void>((resolve) => {
            let listo = false
            const fin = () => {
              if (listo) return
              listo = true
              navigator.serviceWorker.removeEventListener('controllerchange', fin)
              resolve()
            }
            navigator.serviceWorker.addEventListener('controllerchange', fin)
            // Si el worker no cambia (ya estaba al día), no se espera mucho más.
            window.setTimeout(fin, 4000)
          })
        }
      } catch {
        // Sin service worker: se recarga igual y el navegador toma lo nuevo.
      }
      // El catálogo cacheado es de la build anterior y puede no servir: se tira
      // para que se vuelva a bajar. Los borradores y la cola NO se tocan.
      try {
        await limpiarCacheCatalogo()
      } catch {
        // Si no se pudo limpiar, la app refresca el catálogo al iniciar.
      }
    } finally {
      window.location.reload()
    }
  }, [actualizando])

  // Automático solo si no hay nada en riesgo: nada pendiente de subir y no
  // estamos en plena evaluación (ahí una recarga cortaría al evaluador).
  const trabajando = esPantallaDeTrabajo(pathname)
  const puedeAuto = hayActualizacion && !descartada && pendientes === 0 && !trabajando
  useEffect(() => {
    if (!puedeAuto) return
    const t = window.setTimeout(() => void actualizarAhora(), 4000)
    return () => window.clearTimeout(t)
  }, [puedeAuto, actualizarAhora])

  const descartar = useCallback(() => setDescartada(true), [])

  const value = useMemo<VersionContextValue>(
    () => ({ versionRemota, hayActualizacion, actualizando, descartada, actualizarAhora, descartar }),
    [versionRemota, hayActualizacion, actualizando, descartada, actualizarAhora, descartar]
  )

  return (
    <VersionContext.Provider value={value}>
      {hayActualizacion && !descartada ? (
        <div className="flex items-start gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-900">
          <RefreshCw className={cn('mt-px h-4 w-4 shrink-0', actualizando && 'animate-spin')} />
          <span className="min-w-0 flex-1">
            Hay una versión nueva{versionRemota ? ` (${versionCorta(versionRemota)})` : ''}.{' '}
            {trabajando || pendientes > 0
              ? 'Actualizás cuando termines de subir el avance.'
              : 'Se va a actualizar sola en un momento.'}
          </span>
          <button
            type="button"
            onClick={() => void actualizarAhora()}
            disabled={actualizando}
            className="shrink-0 rounded-full bg-blue-700 px-3 py-1 text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {actualizando ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
          {!trabajando && pendientes === 0 ? (
            <button
              type="button"
              onClick={descartar}
              aria-label="Ahora no"
              title="Ahora no"
              className="shrink-0 p-1 text-blue-400 hover:text-blue-700"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </VersionContext.Provider>
  )
}

export function useVersion(): VersionContextValue {
  return useContext(VersionContext) ?? SIN_PROVEEDOR
}
