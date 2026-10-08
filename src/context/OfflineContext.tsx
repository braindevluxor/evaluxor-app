import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { incidentesPendientes, listQueue } from '../lib/offline/db'
import { procesarCola, sincronizarIncidentes } from '../lib/offline/sync'

export interface ResultadoSync {
  ok: number
  fail: number
  /** Lo que se le muestra a la persona: el motivo, no la interna del servidor. */
  error?: string
  /** Código y mensaje crudo, para que el Líder lo pueda mandar si hace falta. */
  detalle?: string
}

interface OfflineContextValue {
  online: boolean
  /** Evaluaciones (cola) esperando subir al servidor. */
  pendientes: number
  /** Incidencias reportadas que todavía no llegaron al servidor. */
  incidentesPendientes: number
  sincronizando: boolean
  ultimoResultado: ResultadoSync | null
  /** Ítems borrados del catálogo que impiden subir parte de un avance. */
  descartes: string[]
  sync: () => Promise<ResultadoSync>
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine)
  const [pendientes, setPendientes] = useState(0)
  const [incidentes, setIncidentes] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoSync | null>(null)
  const [descartes, setDescartes] = useState<string[]>([])

  const contar = useCallback(async () => {
    try {
      const [jobs, incs] = await Promise.all([listQueue(), incidentesPendientes()])
      setPendientes(jobs.length)
      setIncidentes(incs.length)
    } catch {
      // Base local no abierta todavía (p. ej. VersionError): se reintenta en el próximo tick.
    }
  }, [])

  useEffect(() => {
    void contar()
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const iv = window.setInterval(() => void contar(), 10000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.clearInterval(iv)
    }
  }, [contar])

  const sync = useCallback(async () => {
    if (!navigator.onLine) return { ok: 0, fail: 0 }
    setSincronizando(true)
    try {
      // Cola de evaluaciones e incidencias por separado, en paralelo: cada una
      // reporta sus fallos y las incidencias se reintentan igual que las respuestas.
      const [eva, inc] = await Promise.all([procesarCola(), sincronizarIncidentes()])
      const res: ResultadoSync = {
        ok: eva.ok + inc.ok,
        fail: eva.fail + inc.fail,
        // `mensajes` es lo que puede leer quien está en el local; `errores` es
        // la interna del servidor, que va aparte para el detalle.
        ...(eva.mensajes[0] ? { error: eva.mensajes[0] } : {}),
        ...(eva.errores[0] ? { detalle: eva.errores[0] } : {})
      }
      setUltimoResultado(res)
      // Lo que no se pudo subir por ítems que ya no existen, para poder avisar
      // en vez de dejar que parezca que todo entró.
      setDescartes((prev) => [...new Set([...prev, ...eva.descartes.flatMap((d) => d.item_ids)])])
      await contar()
      return res
    } finally {
      setSincronizando(false)
    }
  }, [contar])

  useEffect(() => {
    if (online && pendientes + incidentes > 0) {
      const t = window.setTimeout(() => void sync(), 1200)
      return () => window.clearTimeout(t)
    }
  }, [online, pendientes, incidentes, sync])

  const value: OfflineContextValue = {
    online,
    pendientes,
    incidentesPendientes: incidentes,
    sincronizando,
    ultimoResultado,
    descartes,
    sync
  }

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext)
  if (!ctx) throw new Error('useOffline debe usarse dentro de OfflineProvider')
  return ctx
}