import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { listQueue } from '../lib/offline/db'
import { procesarCola } from '../lib/offline/sync'

interface OfflineContextValue {
  online: boolean
  pendientes: number
  sincronizando: boolean
  ultimoResultado: { ok: number; fail: number } | null
  sync: () => Promise<{ ok: number; fail: number }>
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine)
  const [pendientes, setPendientes] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)
  const [ultimoResultado, setUltimoResultado] = useState<{ ok: number; fail: number } | null>(null)

  const contar = useCallback(async () => {
    const jobs = await listQueue()
    setPendientes(jobs.length)
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
      const res = await procesarCola()
      setUltimoResultado(res)
      await contar()
      return res
    } finally {
      setSincronizando(false)
    }
  }, [contar])

  useEffect(() => {
    if (online && pendientes > 0) {
      const t = window.setTimeout(() => void sync(), 1200)
      return () => window.clearTimeout(t)
    }
  }, [online, pendientes, sync])

  const value: OfflineContextValue = {
    online,
    pendientes,
    sincronizando,
    ultimoResultado,
    sync
  }

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext)
  if (!ctx) throw new Error('useOffline debe usarse dentro de OfflineProvider')
  return ctx
}